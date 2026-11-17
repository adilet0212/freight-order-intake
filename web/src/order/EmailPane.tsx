import type { Order } from '../api/types.js';
import { formatInstant } from '../format.js';

/** The email exactly as it was received, for the reviewer to read the order against. */
export function EmailPane({ order }: { order: Order }) {
  return (
    <section className="email panel" aria-labelledby="email-title">
      <header>
        <h2 id="email-title">Original email</h2>
      </header>
      <dl>
        <dt>Subject</dt>
        <dd>{order.emailSubject}</dd>
        <dt>Received</dt>
        <dd title={order.emailReceivedAt}>
          {formatInstant(order.emailReceivedAt)}
        </dd>
      </dl>
      {/* The body is shown as text: nothing in an email is ever treated as markup. */}
      <pre className="email-body">{order.emailBody}</pre>
    </section>
  );
}
