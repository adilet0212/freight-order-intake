import { useMemo, useSyncExternalStore } from 'react';

/**
 * The three screens, addressed by the part of the URL after `#`. Hash routes need no
 * server setup (any static host serves them) and three screens do not justify a router
 * dependency.
 */
export type Route =
  | { name: 'queue'; status: string | null }
  | { name: 'order'; id: string }
  | { name: 'paste' }
  | { name: 'not-found' };

export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const segments = path.split('/').filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return { name: 'queue', status: new URLSearchParams(query).get('status') };
  }
  if (segments.length === 1 && segments[0] === 'paste') {
    return { name: 'paste' };
  }
  if (segments.length === 2 && segments[0] === 'orders') {
    try {
      return { name: 'order', id: decodeURIComponent(segments[1]) };
    } catch {
      // A broken escape such as "%E0%A4%A" makes decodeURIComponent throw.
      return { name: 'not-found' };
    }
  }
  return { name: 'not-found' };
}

export const paths = {
  queue: (status?: string | null) =>
    status ? `#/?status=${encodeURIComponent(status)}` : '#/',
  order: (id: string) => `#/orders/${encodeURIComponent(id)}`,
  paste: () => '#/paste',
};

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return useMemo(() => parseRoute(hash), [hash]);
}

export function navigate(path: string): void {
  window.location.hash = path.replace(/^#/, '');
}
