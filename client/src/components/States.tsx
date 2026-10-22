import type { ReactNode } from 'react';
import { CircularProgress } from './Material';

export function Loading({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="state">
      <CircularProgress />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state-error">
      <span>{message}</span>
      {onRetry && (
        <button className="btn btn-tonal btn-small" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}
