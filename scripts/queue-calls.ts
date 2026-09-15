import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { safeWriteJson } from './lib/safe-io.js';
import type { KachmoLead, CallingCard, SuppressionEntry } from './lib/schema.js';
import { loadLeads, loadSuppression, paths } from './lib/store.js';
import { phoneEligibility, outreachBlock, isUrl } from './lib/contact.js';
import { parseTracker } from './lib/email-state.js';
import { todayIst } from './lib/geo.js';
import { short, greetName, lowerFirst, priorityLabel, signalSummary } from './lib/text.js';
import { runCli } from './lib/cli.js';

export const MAX_UNANSWERED_ATTEMPTS = 3;
export const MIN_HOURS_BETWEEN_ATTEMPTS = 20;
const NO_CONNECT = new Set(['NO_ANSWER', 'VOICEMAIL', 'GATEKEEPER']);
/** After these outcomes the lead leaves the cold-call queue (follow-up happens via pipeline, not redialling). */
const LEAVES_CALL_QUEUE = new Set(['WRONG_NUMBER', 'INTERESTED', 'NOT_INTERESTED', 'MEETING_BOOKED', 'DO_NOT_CONTACT']);

export function callEligibility(
  lead: KachmoLead,
  suppression: SuppressionEntry[],
  ledgerStatus: string | null,
  today: string,
  now: number = Date.now()
): { ok: boolean; reason: string; callback: boolean } {
  const no = (reason: string) => ({ ok: false, reason, callback: false });
  if (lead.research_state === 'DISQUALIFIED') return no('disqualified');
  const block = outreachBlock(lead, suppression, ledgerStatus);
  if (block.blocked) return no(`suppressed: ${block.reason}`);
  const phone = phoneEligibility(lead);
  if (!phone.ok) return no(phone.reason);
  if (lead.meeting_status || lead.proposal_status || lead.deal_stage) return no('already in the sales pipeline');

  if (['REPLIED_POSITIVE', 'NOT_INTERESTED', 'REPLIED'].includes(lead.response_status ?? '')) return no(`already responded (${lead.response_status})`);
  if (lead.response_status === 'REPLIED_NOT_NOW' && (!lead.next_action_date || lead.next_action_date > today)) {
    return no(`asked to be contacted later (${lead.next_action_date ?? 'no date'})`);
  }

  const attempts = lead.call_attempts ?? [];
  const last = attempts[attempts.length - 1];
  // Any terminal outcome in the history counts, so a stray later NO_ANSWER can't put the lead back in the queue.
  const closed = attempts.find(a => a.outcome !== 'WRONG_NUMBER' && LEAVES_CALL_QUEUE.has(a.outcome));
  if (closed) return no(`earlier call outcome ${closed.outcome}`);
  if (last) {
    if (last.outcome === 'WRONG_NUMBER' && (lead.research_last_verified_at ?? '') <= last.at) return no('last call reached a wrong number; record the correct one first');
    if ((now - Date.parse(last.at)) / 36e5 < MIN_HOURS_BETWEEN_ATTEMPTS) return no(`called within the last ${MIN_HOURS_BETWEEN_ATTEMPTS}h`);
    if (last.outcome === 'CALLBACK' || last.outcome === 'NOT_NOW') {
      return lead.next_action_date && lead.next_action_date <= today
        ? { ok: true, reason: 'callback due', callback: true }
        : no(`callback scheduled for ${lead.next_action_date ?? 'an unspecified date'}`);
    }
    const unanswered = attempts.filter(a => NO_CONNECT.has(a.outcome)).length;
    if (unanswered >= MAX_UNANSWERED_ATTEMPTS) return no(`${unanswered} unanswered attempts — stop calling`);
    if (lead.next_action_date && lead.next_action_date > today) return no(`next attempt on ${lead.next_action_date}`);
    return { ok: true, reason: `retry (${unanswered} unanswered)`, callback: false };
  }
  if (lead.research_state !== 'QUALIFIED' && lead.research_state !== 'OUTREACH_READY') return no(`research_state ${lead.research_state}`);
  return { ok: true, reason: 'first call', callback: false };
}

function playbook(lead: KachmoLead): { questions: string[]; objections: Array<{ objection: string; response: string }> } {
  const universal = [
    { objection: 'Just send me an email.', response: 'Happy to. What’s the best address? I’ll send one page specific to your site, not a brochure.' },
    { objection: 'How much does it cost?', response: 'It depends on scope; we work in fixed-price sprints. I’d rather understand what you need first. Can I send a short idea and book 15 minutes?' },
  ];
  const byArchetype: Record<string, { questions: string[]; objections: Array<{ objection: string; response: string }> }> = {
    '1': {
      questions: ['When client launches collide, who builds the interactive / front-end side?', 'Do motion-heavy ideas ever get simplified because of dev capacity?', 'How do you usually work with outside developers, if at all?'],
      objections: [{ objection: 'We have in-house developers.', response: 'That makes sense. Teams usually bring in outside help when launches overlap or a project needs heavy WebGL/motion work. Could we stay on your list for those moments?' }],
    },
    '2': {
      questions: ['Who owns the marketing site today: an engineer, a designer, or an agency?', 'Is the site keeping up with how the product has changed?', 'Is there a launch or raise coming where the site matters?'],
      objections: [{ objection: 'Our engineers will handle it.', response: 'Totally fair. Often they’d rather stay on product. If the site ever competes with the roadmap for their time, we could take that off their plate.' }],
    },
    '5': {
      questions: ['How do new customers find you today?', 'Do people ever ask for your website?', 'What would a good enquiry look like for you?'],
      objections: [{ objection: 'We get enough work from word of mouth.', response: 'Great position to be in. A simple site mostly helps referrals check you out before calling. No pressure, just an idea.' }],
    },
  };
  const service = {
    questions: ['Where do most high-value enquiries come from today: referrals, Instagram, Google, or the website?', 'What happens after someone lands on the site: do they call, WhatsApp, or fill a form?', 'If you could change one thing about the website this year, what would it be?'],
    objections: [{ objection: 'We already have a web person / agency.', response: 'No problem. We wouldn’t replace them. If there’s a specific piece they don’t do (interactive showcase, booking flow), we could help with just that.' }],
  };
  const pb = byArchetype[lead.archetype_id] ?? service;
  return { questions: pb.questions, objections: [...pb.objections, ...universal] };
}

export function buildCallCard(lead: KachmoLead): CallingCard {
  const greet = greetName(lead.decision_maker_name);
  const commercialVerified = isUrl(lead.commercial_signal_source);
  const frictionVerified = isUrl(lead.website_friction_source);
  const pb = playbook(lead);
  const verify: string[] = [];
  if (!frictionVerified) verify.push(`Open ${lead.website_url} on your phone. Is this true today: "${short(lead.observable_friction)}"? If not, skip the bridge.`);
  if (!commercialVerified) verify.push(`Unverified claim, don't quote it as fact: "${short(lead.commercial_validation_signal)}"`);
  if (!isUrl(lead.decision_maker_source)) verify.push(`Check LinkedIn / site that ${lead.decision_maker_name} is still ${lead.decision_maker_title}.`);
  if (lead.timezone) verify.push(`Their local timezone is ${lead.timezone}. Avoid early morning, lunch and evenings.`);

  const attempts = lead.call_attempts ?? [];
  return {
    lead_id: lead.lead_id,
    target_number: lead.target_number,
    company_name: lead.company_name,
    website_url: lead.website_url,
    decision_maker_name: lead.decision_maker_name,
    decision_maker_title: lead.decision_maker_title,
    phone_number: lead.decision_maker_phone ?? '',
    phone_status: lead.phone_status,
    phone_source: lead.phone_source,
    location_city: lead.location_city,
    timezone: lead.timezone,
    priority: lead.lead_priority,
    priority_confidence: lead.priority_confidence ?? null,
    kachmo_score: lead.kachmo_score,
    score_signals: lead.score_signals ?? [],
    research_completeness_score: lead.research_completeness_score,
    archetype: lead.archetype_label,
    commercial_signal: lead.commercial_validation_signal,
    commercial_signal_verified: commercialVerified,
    observable_friction: lead.observable_friction,
    friction_verified: frictionVerified,
    kachmo_angle: lead.kachmo_solution_angle,
    why_now: lead.why_now ?? (lead.trigger_event && lead.trigger_event !== 'NO_CLEAR_TRIGGER' ? lead.trigger_event : null),
    call_objective: 'Learn whether the website matters to how they win customers. Success = permission to send a one-page idea, or a 15-minute follow-up.',
    recommended_opening: `Hi, is this ${greet}? This is Aadi from Kachmo Studios, a small web and interactive design studio in Pune. I had one specific idea for ${lead.company_name}'s website. Do you have two minutes, or is there a better time?`,
    bridge: `I was looking at your site and noticed ${lowerFirst(short(lead.observable_friction, 18))}. We'd ${lowerFirst(short(lead.kachmo_solution_angle, 18))}. Is the website something that matters for how you win customers?`,
    discovery_questions: pb.questions,
    objections: pb.objections,
    what_not_to_say: [
      'Don’t claim past clients, results or partners we don’t have.',
      'Don’t state anything marked unverified as fact.',
      'Don’t quote a price on the first call.',
      'Don’t criticise their current site, agency or team.',
      'If they ask not to be contacted: apologise, end the call, log --outcome=DO_NOT_CONTACT.',
    ],
    verify_before_call: verify,
    previous_attempts: attempts.length,
    log_command: `npm run calls:log -- --lead=${lead.target_number} --outcome=<NO_ANSWER|VOICEMAIL|GATEKEEPER|CALLBACK|INTERESTED|NOT_NOW|NOT_INTERESTED|MEETING_BOOKED|WRONG_NUMBER|DO_NOT_CONTACT> [--notes="..."] [--objection-category=...] [--whatsapp-ok] [--confirmed-identity]`,
  };
}

export function generateCallingQueue(): { total: number; cards: CallingCard[]; excluded: Array<{ target_number: string; company: string; reason: string }> } {
  const p = paths();
  const leads = loadLeads();
  const suppression = loadSuppression();
  const tracker = parseTracker(p.tracker);
  const today = todayIst();

  const eligible: Array<{ lead: KachmoLead; callback: boolean }> = [];
  const excluded: Array<{ target_number: string; company: string; reason: string }> = [];
  for (const lead of leads) {
    const e = callEligibility(lead, suppression, tracker.get(lead.target_number)?.status ?? null, today);
    if (e.ok) eligible.push({ lead, callback: e.callback });
    else if (lead.decision_maker_phone) excluded.push({ target_number: lead.target_number, company: lead.company_name, reason: e.reason });
  }
  eligible.sort(
    (a, b) =>
      Number(b.callback) - Number(a.callback) ||
      (b.lead.kachmo_score ?? -1) - (a.lead.kachmo_score ?? -1) ||
      b.lead.research_completeness_score - a.lead.research_completeness_score
  );

  const cards = eligible.map(e => buildCallCard(e.lead));
  const generatedAt = new Date().toISOString();
  safeWriteJson(p.callingQueue, { generated_at: generatedAt, cards, excluded });

  const md: string[] = [
    '# Aadi: Calls',
    '',
    `> Generated ${generatedAt} (IST date ${today}). **Regenerate before calling** (\`npm run queue:calls\`); an old copy can include someone who has since opted out.`,
    `> Only phones with a recorded public source or a verified basis are listed. ${cards.length} to call.`,
    '',
  ];
  if (!cards.length) md.push('**No callable leads right now.** See the exclusions below: most need a phone source recorded first (RESEARCH_QUEUE.md).', '');
  for (const c of cards) {
    md.push(
      `## ${c.target_number} · ${c.company_name}: ${c.decision_maker_name} (${c.decision_maker_title})`,
      `📞 \`${c.phone_number}\` · ${c.phone_status} (${c.phone_source}) · ${c.location_city}${c.previous_attempts ? ` · ${c.previous_attempts} previous attempt(s)` : ''}`,
      `Priority ${priorityLabel(c.priority, c.priority_confidence)} · signals: ${signalSummary(c.score_signals)} · research ${c.research_completeness_score}% · ${c.archetype}`,
      '',
      `**Why them:** ${short(c.commercial_signal, 30)}${c.commercial_signal_verified ? '' : ' _(unverified)_'}`,
      `**Friction:** ${short(c.observable_friction, 30)}${c.friction_verified ? '' : ' _(unverified: check first)_'}`,
      `**Angle:** ${short(c.kachmo_angle, 30)}`,
      c.why_now ? `**Why now:** ${c.why_now}` : '**Why now:** none known (fine, don’t invent one)',
      `**Goal:** ${c.call_objective}`,
      '',
      `**Before dialling:**`,
      ...c.verify_before_call.map(v => `- [ ] ${v}`),
      '',
      `**Open:** "${c.recommended_opening}"`,
      `**Bridge:** "${c.bridge}"`,
      `**Ask:**`,
      ...c.discovery_questions.map((q, i) => `${i + 1}. ${q}`),
      `**If they say…**`,
      ...c.objections.map(o => `- "${o.objection}" → "${o.response}"`),
      `**Don’t:** ${c.what_not_to_say.join(' · ')}`,
      '',
      `**Log it:** \`${c.log_command}\``,
      '',
      '---',
      ''
    );
  }
  if (excluded.length) {
    md.push('## Not callable (phone on file but excluded)', '', '| Target | Company | Why |', '| :-- | :-- | :-- |');
    for (const x of excluded) md.push(`| ${x.target_number} | ${x.company} | ${x.reason} |`);
    md.push('');
  }
  writeFileSync(resolve(process.cwd(), 'AADI_DAILY_CALLS.md'), md.join('\n'), 'utf-8');

  console.log(`\n📞 Calling queue: ${cards.length} callable, ${excluded.length} with a phone but excluded → AADI_DAILY_CALLS.md`);
  return { total: cards.length, cards, excluded };
}

if (process.argv[1]?.endsWith('queue-calls.ts')) {
  runCli(() => {
    generateCallingQueue();
  });
}
