import React from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  style?: React.CSSProperties;
}

export function EmptyState({ title, description, action, style }: EmptyStateProps) {
  return (
    <div className="empty-state panel" style={style}>
      <p className="empty-title">{title}</p>
      {description ? <p className="empty-description muted small">{description}</p> : null}
      {action ? <div className="empty-action" style={{ marginTop: 12 }}>{action}</div> : null}
    </div>
  );
}
