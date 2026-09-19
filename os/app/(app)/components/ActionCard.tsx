import React from 'react';
import Link from 'next/link';
import { StatusBadge } from './StatusBadge';

interface ActionCardProps {
  title: string;
  targetNumber?: string;
  subtitle?: string;
  what: string;
  why?: string;
  owner?: string | null;
  due?: string | null;
  statusBadge?: string;
  actionHref: string;
  actionLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  severity?: 'critical' | 'warn' | 'info' | 'normal';
}

export function ActionCard({
  title,
  targetNumber,
  subtitle,
  what,
  why,
  owner,
  due,
  statusBadge,
  actionHref,
  actionLabel,
  secondaryHref,
  secondaryLabel,
  severity = 'normal',
}: ActionCardProps) {
  const borderTone =
    severity === 'critical' ? 'action-card critical' : severity === 'warn' ? 'action-card warn' : severity === 'info' ? 'action-card info' : 'action-card';

  return (
    <div className={borderTone}>
      <div className="action-card-header">
        <div>
          <div className="action-card-company">
            {targetNumber ? <span className="action-card-tn">{targetNumber}</span> : null}
            {secondaryHref ? (
              <Link href={secondaryHref} className="action-card-title-link">
                <strong>{title}</strong>
              </Link>
            ) : (
              <strong>{title}</strong>
            )}
            {statusBadge ? <StatusBadge status={statusBadge} /> : null}
          </div>
          {subtitle ? <p className="action-card-sub muted small">{subtitle}</p> : null}
        </div>
        <div className="action-card-actions">
          {secondaryHref && secondaryLabel ? (
            <Link href={secondaryHref} className="badge ghost">
              {secondaryLabel}
            </Link>
          ) : null}
          <Link href={actionHref} className="action-card-btn">
            {actionLabel}
          </Link>
        </div>
      </div>

      <div className="action-card-body">
        <p className="action-card-what">
          <span className="action-tag">ACTION:</span> {what}
        </p>
        {why ? (
          <p className="action-card-why muted small">
            <span className="action-tag-muted">WHY:</span> {why}
          </p>
        ) : null}
      </div>

      {(owner || due) ? (
        <div className="action-card-footer small muted">
          {owner ? <span>Owner: <strong>{owner}</strong></span> : null}
          {owner && due ? <span> · </span> : null}
          {due ? <span>Due: <strong>{due}</strong></span> : null}
        </div>
      ) : null}
    </div>
  );
}
