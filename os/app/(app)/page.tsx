import Link from 'next/link';
import { requirePermission } from '@/server/auth/current-actor';
import { requestSnapshot } from '@/server/services/snapshot';
import { getToday, type TodayView } from '@/server/services/today';
import { senderStatus } from '@/server/services/sender';
import { dayLabel } from '@/server/services/operator';
import { AsOf, Banner, Chip, EmptyNote, PageHead } from './components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Today' };

/**
 * TODAY — "what needs me?" (docs/OPERATOR_EXPERIENCE.md §4.1).
 *
 * Order is urgency, not data source: things that stop outreach, then people waiting on a reply, then what is due, then
 * what can wait. Each item is one plain sentence built from the stored facts core selected it with, and one button
 * named for what happens next. Nothing here sends anything.
 */
type Item = TodayView['items'][number];

const GROUPS: Array<{ urgency: Item['line']['urgency']; title: string; empty?: string; show: number }> = [
  { urgency: 'now', title: 'Needs you now', show: 20 },
  { urgency: 'today', title: 'Due today', show: 10 },
  { urgency: 'later', title: 'When you have time', show: 5 },
];

function WorkRow({ item, today }: { item: Item; today: string }) {
  const company = item.company || 'Suggested company';
  const companyHref = item.leadId ? `/leads/${item.targetNumber}` : item.href;
  return (
    <li className="work">
      <div style={{ minWidth: 0 }}>
        <div className="who-line">
          <Link className="company" href={companyHref}>
            {company}
          </Link>
          <span className="where">{item.line.what}</span>
        </div>
        <p className="sentence">{item.line.sentence}</p>
      </div>
      <div className="aside">
        {item.overdue && item.due ? <Chip tone="act">Overdue · {dayLabel(item.due)}</Chip> : item.due && item.due >= today ? <Chip>Due {dayLabel(item.due)}</Chip> : null}
        <Link className="btn btn-sm" href={item.href}>
          {item.line.action}
        </Link>
      </div>
    </li>
  );
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const actor = await requirePermission('lead.view');
  const { who } = await searchParams;
  const mine = who !== 'all';
  const snap = await requestSnapshot();
  const work = await getToday(actor, { mine, snapshot: snap });
  const seesEmail = actor.permissions.has('email.view_ledger');
  const sender = seesEmail ? senderStatus(snap, actor, work.today) : null;

  const first = actor.name.split(' ')[0];
  const hour = Number(new Date().toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const counts = work.byUrgency;
  const summary = [
    counts.now ? `${counts.now} ${counts.now === 1 ? 'thing needs' : 'things need'} you now` : null,
    counts.today ? `${counts.today} due today` : null,
    counts.later ? `${counts.later} when you have time` : null,
  ].filter(Boolean);

  return (
    <>
      <PageHead
        label={dayLabel(work.today)}
        title="Today"
        sub={`${greeting}, ${first}. ${summary.length ? `${summary.join(' · ')}.` : 'Nothing needs you right now.'}`}
        aside={
          work.me ? (
            <span className="small muted">
              {mine ? (
                <>
                  Showing your work · <Link href="/?who=all">everyone’s</Link>
                </>
              ) : (
                <>
                  Showing everyone’s work · <Link href="/">only yours</Link>
                </>
              )}
            </span>
          ) : null
        }
      />

      {sender && (sender.state === 'ON_HOLD' || sender.state === 'STUCK') ? (
        <div style={{ marginBottom: 'var(--s5)' }}>
          <Banner tone={sender.state === 'ON_HOLD' ? 'stop' : 'act'} chip={sender.state === 'ON_HOLD' ? 'Email on hold' : 'Email stuck'}>
            <p>
              <strong>{sender.headline}</strong>
            </p>
            {sender.explanation.slice(0, 2).map(e => (
              <p key={e} className="small muted">
                {e}
              </p>
            ))}
            <p className="small" style={{ marginTop: 'var(--s2)' }}>
              <Link href="/email">See the scheduled emails</Link> · <AsOf iso={sender.asOf} />
            </p>
          </Banner>
        </div>
      ) : null}

      {work.items.length === 0 ? (
        <EmptyNote title="Nothing needs you today." action={{ href: '/leads', label: 'Browse companies' }}>
          {sender && sender.state === 'SENDING' ? `${sender.queued.length} scheduled email${sender.queued.length === 1 ? '' : 's'} will go out automatically. ` : ''}
          New work appears here as replies come in, follow-ups fall due and research is needed.
        </EmptyNote>
      ) : (
        GROUPS.map(g => {
          const items = work.items.filter(i => i.line.urgency === g.urgency);
          if (!items.length) return null;
          const shown = items.slice(0, g.show);
          const rest = items.slice(g.show);
          return (
            <section key={g.urgency} aria-labelledby={`g-${g.urgency}`}>
              <div className="group-head">
                <h2 id={`g-${g.urgency}`}>{g.title}</h2>
                <span className="label">{items.length}</span>
              </div>
              <ul className="rows">
                {shown.map(i => (
                  <WorkRow key={`${i.kind}-${i.ref ?? i.targetNumber}`} item={i} today={work.today} />
                ))}
              </ul>
              {rest.length ? (
                <details className="disclose" style={{ marginTop: 'var(--s2)' }}>
                  <summary>
                    <span className="title">Show {rest.length} more</span>
                  </summary>
                  <ul className="rows" style={{ margin: '0 var(--s4) var(--s4)' }}>
                    {rest.map(i => (
                      <WorkRow key={`${i.kind}-${i.ref ?? i.targetNumber}`} item={i} today={work.today} />
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>
          );
        })
      )}

      {sender && sender.state === 'SENDING' ? (
        <p className="small muted" style={{ marginTop: 'var(--s6)' }}>
          {sender.headline} <Link href="/email">See them</Link>.
        </p>
      ) : null}
    </>
  );
}
