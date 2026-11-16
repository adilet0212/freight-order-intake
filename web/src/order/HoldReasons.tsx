import type { Order } from '../api/types.js';
import {
  explainReason,
  type ReasonItem,
  type ReasonState,
} from './hold-reasons.js';

const STATE_LABELS: Record<ReasonState, string> = {
  open: 'Open',
  fixed: 'Fixed',
  check: 'Check the email',
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The top of a held order: why it was held, in plain words, and where each reason
 * stands now. Nothing here blocks approving; it tells the reviewer what is left.
 */
export function HoldReasons({ items }: { items: ReasonItem[] }) {
  const open = items.filter((item) => item.state === 'open').length;
  const check = items.filter((item) => item.state === 'check').length;
  const fixed = items.filter((item) => item.state === 'fixed').length;

  return (
    <section className="reasons panel" aria-labelledby="reasons-title">
      <header>
        <h2 id="reasons-title">Held for review</h2>
        <span className="muted">
          {[
            `${open} open`,
            check > 0 ? `${check} to check against the email` : null,
            fixed > 0 ? `${fixed} fixed` : null,
          ]
            .filter((part) => part !== null)
            .join(', ')}
        </span>
      </header>
      {items.length === 0 ? (
        <p className="reasons-none">No reason was recorded for this order.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.key} className={`reason-${item.state}`}>
              <span className="reason-state">{STATE_LABELS[item.state]}</span>
              <span className="reason-text">
                {item.text}
                {item.detail && (
                  <details>
                    <summary>Technical detail</summary>
                    <pre>{item.detail}</pre>
                  </details>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && open === 0 && (
        <p className="reasons-none">
          {check > 0
            ? `Nothing is left open. Read the email for the ${plural(check, 'item', 'items')} marked "Check the email", then approve.`
            : 'Nothing is left open. The order can be approved.'}
        </p>
      )}
    </section>
  );
}

/** The same place on an order that is not held: one line on how it got its status. */
export function StatusNote({ order }: { order: Order }) {
  if (order.status === 'auto_accepted') {
    return (
      <p className="notice success">
        Accepted automatically. It passed every check at intake.
      </p>
    );
  }
  if (order.status === 'not_an_order') {
    return (
      <p className="notice">
        The model read this email as not being a shipment request, so no order
        was extracted.
      </p>
    );
  }
  if (order.status === 'approved') {
    return (
      <section className="reasons panel" aria-labelledby="reasons-title">
        <header>
          <h2 id="reasons-title">Approved by a reviewer</h2>
        </header>
        {order.reviewReasons.length > 0 && (
          <>
            <p className="reasons-none">It had been held because:</p>
            <ul>
              {order.reviewReasons.map((reason) => (
                <li key={reason} className="reason-past">
                  <span className="reason-text">
                    {explainReason(reason).text}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    );
  }
  return null;
}
