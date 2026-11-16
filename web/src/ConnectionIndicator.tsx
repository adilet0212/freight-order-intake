import type { ConnectionState } from './live/connection.js';
import { useConnectionState } from './services.js';

const LABELS: Record<ConnectionState, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
};

const HINTS: Record<ConnectionState, string> = {
  connecting: 'Connecting to the API for live updates.',
  live: 'New and approved orders appear without a refresh.',
  reconnecting:
    'The connection dropped. Retrying. What you see may be out of date.',
  offline:
    'Could not connect to the API for live updates. Retrying. What you see may be out of date.',
};

/** Shows in the header whether live updates are arriving. */
export function ConnectionIndicator() {
  const state = useConnectionState();
  return (
    <span
      className={`connection connection-${state}`}
      role="status"
      title={HINTS[state]}
    >
      <span className="connection-mark" aria-hidden="true" />
      {LABELS[state]}
    </span>
  );
}

/** True when updates are not arriving, so a list on screen may have gone stale. */
export function useUpdatesPaused(): boolean {
  const state = useConnectionState();
  return state === 'reconnecting' || state === 'offline';
}
