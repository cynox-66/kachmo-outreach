import React from 'react';
import Link from 'next/link';
import type { OperatorStatus, ClaimView, Tone } from '@/server/services/operator';
import { VERIFICATION, momentLabel } from '@/server/services/operator';
import type { QueuedEmailView } from '@/server/services/sender';

/**
 * The Outbound OS component vocabulary (docs/DESIGN_LANGUAGE.md §5). Presentational only: every value arrives already
 * decided and translated by a service; nothing here computes, and nothing here needs client-side JavaScript.
 */

export function PageHead({ label, title, sub, aside }: { label?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div className="row between">
        <div style={{ minWidth: 0 }}>
          {label ? <span className="label">{label}</span> : null}
          <h1>{title}</h1>
        </div>
        {aside ? <div className="row">{aside}</div> : null}
      </div>
      {sub ? <p className="sub">{sub}</p> : null}
    </header>
  );
}

const TONE_CLASS: Record<Tone, string> = { stop: 'chip stop', act: 'chip act', done: 'chip done', neutral: 'chip' };

export function Chip({ tone = 'neutral', children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span className={TONE_CLASS[tone]} title={title}>
      {children}
    </span>
  );
}

export function StatusChip({ status }: { status: OperatorStatus }) {
  return (
    <Chip tone={status.tone} title={status.sentence}>
      {status.label}
    </Chip>
  );
}

/** A banner for what stops outreach (vermilion rule) or needs a person (act chip). */
export function Banner({ tone, chip, children }: { tone: 'stop' | 'act'; chip: string; children: React.ReactNode }) {
  return (
    <div className={`plate banner ${tone}`} role={tone === 'stop' ? 'alert' : 'status'}>
      <Chip tone={tone}>{chip}</Chip>
      <div className="body">{children}</div>
    </div>
  );
}

/** A research claim with how far it has been verified — never stated more strongly than the evidence allows. */
export function Claim({ claim }: { claim: ClaimView }) {
  const v = VERIFICATION[claim.verification];
  return (
    <div className={`claim ${claim.verification === 'UNSOURCED' || claim.verification === 'CONTRADICTED' ? 'unsourced' : ''}`}>
      <span className="label what">{claim.label}</span>
      <p className="value">{claim.value}</p>
      <span className="verify" title={v.note}>
        <span className="mark" aria-hidden="true">
          {v.mark}
        </span>
        {v.label}
        {claim.verification === 'UNSOURCED' ? ' — don’t quote it as fact' : claim.verification === 'CONTRADICTED' ? ' — treat as wrong' : ''}
      </span>
    </div>
  );
}

/** Progressive disclosure: native, keyboard- and screen-reader-accessible, and works without JavaScript. */
export function Disclosure({ title, meta, id, open, children }: { title: React.ReactNode; meta?: React.ReactNode; id?: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="disclose" id={id} open={open}>
      <summary>
        <span>
          <span className="title">{title}</span>
          {meta ? <span className="muted small"> · {meta}</span> : null}
        </span>
      </summary>
      <div className="inner">{children}</div>
    </details>
  );
}

/** A queued email exactly as it will be sent (plain text). The HTML part is never read into the app. */
export function EmailPreview({ email, open = false }: { email: QueuedEmailView; open?: boolean }) {
  return (
    <div className="email">
      <div className="head">
        <div>
          <span>To</span>
          <code>{email.to}</code>
        </div>
        <div>
          <span>Subject</span>
          {email.subject || <em className="muted">no subject</em>}
        </div>
      </div>
      {open ? <pre className="body">{email.body || 'No plain-text version.'}</pre> : null}
    </div>
  );
}

/** When the email records shown were captured. They are only as fresh as the deployment (audit A5). */
export function AsOf({ iso }: { iso: string | null }) {
  return (
    <span className="label" style={{ margin: 0 }} title="The email records are updated each time the app is deployed.">
      Email records as of {iso ? momentLabel(iso) : 'the last deploy'}
    </span>
  );
}

export function EmptyNote({ title, children, action }: { title: string; children?: React.ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="plate empty-state">
      <p className="empty-title">{title}</p>
      {children ? <p className="muted small" style={{ margin: 0 }}>{children}</p> : null}
      {action ? (
        <p style={{ margin: 'var(--s3) 0 0' }}>
          <Link className="btn btn-sm" href={action.href}>
            {action.label}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
