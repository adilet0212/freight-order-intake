import type { ReactNode } from 'react';

/** Shown while a screen's first request is in flight. */
export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="state" role="status">
      {label}
    </div>
  );
}

/** Shown when a request succeeded and there is nothing to list. */
export function EmptyBlock({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="state">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

/** Shown when a screen could not load at all. `onRetry` adds a button. */
export function ErrorBlock({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state error" role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
