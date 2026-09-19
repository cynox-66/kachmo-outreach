import React from 'react';
import { presentStatus, presentTone, type StatusTone } from '@/server/services/presentation';

interface StatusBadgeProps {
  status?: string | null;
  label?: string;
  tone?: StatusTone;
  className?: string;
  style?: React.CSSProperties;
}

export function StatusBadge({ status, label, tone, className = '', style }: StatusBadgeProps) {
  const displayLabel = label ?? presentStatus(status);
  const resolvedTone = tone ?? presentTone(status);
  const toneClass = resolvedTone && resolvedTone !== 'neutral' ? `badge ${resolvedTone}` : 'badge';

  return (
    <span className={`${toneClass} ${className}`.trim()} style={style}>
      {displayLabel}
    </span>
  );
}
