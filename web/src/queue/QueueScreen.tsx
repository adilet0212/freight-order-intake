import { useEffect } from 'react';
import { useUpdatesPaused } from '../ConnectionIndicator.js';
import { formatInstant, formatLocalMinute } from '../format.js';
import { firstPickupStart, formatLane, laneOf } from '../orders/lane.js';
import type { QueueEntry } from '../orders/order-store.js';
import { paths } from '../route.js';
import { useOrders, useServices } from '../services.js';
import type { OrderStatus } from '../shared.js';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../ui/states.js';
import {
  countByStatus,
  filterQueue,
  FILTER_ORDER,
  isHeld,
  parseStatusFilter,
  sortQueue,
  STATUS_LABELS,
} from './queue-order.js';
import { StatusChip } from './StatusChip.js';

export function QueueScreen({ status }: { status: string | null }) {
  const { store } = useServices();
  const { phase, error, refreshing, entries } = useOrders();
  const updatesPaused = useUpdatesPaused();
  const filter = parseStatusFilter(status);

  // Orders that arrived while this screen was open are marked "New". Leaving the
  // screen clears the marks, so coming back does not announce them a second time.
  useEffect(() => () => store.markSeen(), [store]);

  const reload = () => void store.load();
  const counts = countByStatus(entries);
  const heldCount = counts.needs_review + counts.extraction_failed;
  const visible = sortQueue(filterQueue(entries, filter));

  return (
    <>
      <div className="page-head">
        <h1>Queue</h1>
        {phase === 'ready' && (
          <span className="muted">
            {heldCount} held, {entries.length} in total
          </span>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="button"
          onClick={reload}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      {updatesPaused && (
        <div className="notice warning" role="status">
          Live updates are paused while the connection is down. This list may be
          out of date.
        </div>
      )}
      {phase === 'ready' && error && (
        <div className="notice error" role="alert">
          <span>Could not refresh the list. {error}</span>
        </div>
      )}

      {phase === 'loading' && <LoadingBlock label="Loading orders" />}
      {phase === 'error' && (
        <div className="panel">
          <ErrorBlock
            title="Could not load the queue"
            message={error ?? ''}
            onRetry={reload}
          />
        </div>
      )}
      {phase === 'ready' && (
        <>
          <StatusFilter
            active={filter}
            counts={counts}
            total={entries.length}
          />
          <div className="panel">
            {entries.length === 0 ? (
              <EmptyBlock title="No orders yet">
                <p>
                  Orders appear here as emails come in.{' '}
                  <a href={paths.paste()}>Paste an email</a> to create one.
                </p>
              </EmptyBlock>
            ) : visible.length === 0 ? (
              <EmptyBlock
                title={`No orders with the status "${STATUS_LABELS[filter!]}"`}
              >
                <p>
                  <a href={paths.queue()}>Show all orders</a>
                </p>
              </EmptyBlock>
            ) : (
              <QueueTable entries={visible} />
            )}
          </div>
        </>
      )}
    </>
  );
}

function StatusFilter({
  active,
  counts,
  total,
}: {
  active: OrderStatus | null;
  counts: Record<OrderStatus, number>;
  total: number;
}) {
  return (
    <nav className="filter" aria-label="Filter by status">
      <a
        href={paths.queue()}
        aria-current={active === null ? 'true' : undefined}
      >
        All <span className="count">{total}</span>
      </a>
      {FILTER_ORDER.map((status) => (
        <a
          key={status}
          href={paths.queue(status)}
          aria-current={active === status ? 'true' : undefined}
        >
          {STATUS_LABELS[status]}{' '}
          <span className="count">{counts[status]}</span>
        </a>
      ))}
    </nav>
  );
}

function QueueTable({ entries }: { entries: QueueEntry[] }) {
  return (
    <table className="queue">
      <caption className="visually-hidden">Orders</caption>
      <thead>
        <tr>
          <th scope="col">Status</th>
          <th scope="col">Customer</th>
          <th scope="col">Lane</th>
          <th scope="col">Pickup</th>
          <th scope="col">Received</th>
          <th scope="col">Held because</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <QueueRow key={entry.order.id} entry={entry} />
        ))}
      </tbody>
    </table>
  );
}

function QueueRow({ entry }: { entry: QueueEntry }) {
  const { order, stops, stopsFailed, arrivedLive } = entry;
  const held = isHeld(order.status);
  const [firstReason, ...otherReasons] = order.reviewReasons;

  return (
    <tr
      className={[held ? 'held' : '', arrivedLive ? 'arrived' : '']
        .join(' ')
        .trim()}
    >
      <td>
        <StatusChip status={order.status} />
        {arrivedLive && <span className="new-tag">New</span>}
      </td>
      <td className="customer">
        <a href={paths.order(order.id)}>
          {order.customerName ?? (
            <span className="from-subject">{order.emailSubject}</span>
          )}
        </a>
        {order.referenceNumber && (
          <span className="muted"> {order.referenceNumber}</span>
        )}
      </td>
      {stops === null ? (
        stopsFailed ? (
          <td colSpan={2} className="muted" title="Open the order to try again">
            Could not load stops
          </td>
        ) : (
          <td colSpan={2} aria-busy="true">
            <span className="skeleton" />
            <span className="visually-hidden">Loading stops</span>
          </td>
        )
      ) : (
        <>
          <td>{formatLane(laneOf(stops)) || <Dash />}</td>
          <td>{formatLocalMinute(firstPickupStart(stops)) || <Dash />}</td>
        </>
      )}
      <td title={order.emailReceivedAt}>
        {formatInstant(order.emailReceivedAt)}
      </td>
      <td className="reason">
        {held && firstReason ? (
          <>
            {firstReason}
            {otherReasons.length > 0 && (
              <span className="muted"> +{otherReasons.length} more</span>
            )}
          </>
        ) : (
          <Dash />
        )}
      </td>
    </tr>
  );
}

/** An empty cell. The dash is decoration; a screen reader hears "none". */
function Dash() {
  return (
    <>
      <span aria-hidden="true" className="muted">
        –
      </span>
      <span className="visually-hidden">none</span>
    </>
  );
}
