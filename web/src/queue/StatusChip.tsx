import type { OrderStatus } from '../shared.js';
import { STATUS_LABELS } from './queue-order.js';

/** A status, always written out. The colour repeats it; it never stands alone. */
export function StatusChip({ status }: { status: OrderStatus }) {
  return (
    <span className={`chip chip-${status}`}>
      <span className="chip-mark" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}
