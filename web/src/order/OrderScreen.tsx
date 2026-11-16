import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import type { Order } from '../api/types.js';
import { isHeld } from '../queue/queue-order.js';
import { StatusChip } from '../queue/StatusChip.js';
import { paths } from '../route.js';
import { useServices } from '../services.js';
import { ORDER_APPROVED, type OrderStatus } from '../shared.js';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../ui/states.js';
import { EmailPane } from './EmailPane.js';
import { reasonItems } from './hold-reasons.js';
import { HoldReasons, StatusNote } from './HoldReasons.js';
import {
  draftFrom,
  orderContent,
  toForm,
  totalWeightLbs,
  type OrderForm as OrderFormState,
} from './order-form.js';
import { OrderForm } from './OrderForm.js';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; order: Order };

type Notice = 'approved' | 'approved-elsewhere' | 'already-reviewed' | null;

const NOTICES: Record<Exclude<Notice, null>, { tone: string; text: string }> = {
  approved: {
    tone: 'success',
    text: 'Approved. The order is saved as shown.',
  },
  'approved-elsewhere': {
    tone: 'info',
    text: 'This order was just approved in another window. It is shown here as approved. Any edits you had made were not saved.',
  },
  'already-reviewed': {
    tone: 'warning',
    text: 'This order had already been reviewed, so your approval was not saved. It is shown here as it is now.',
  },
};

/** One order: the email on the left, the extracted order on the right. */
export function OrderScreen({ id }: { id: string }) {
  const { api, live, store } = useServices();
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [form, setForm] = useState<OrderFormState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  // Read by the event listener below, which must see the latest values without being
  // re-subscribed on every keystroke.
  const savingRef = useRef(false);
  const statusRef = useRef<OrderStatus | null>(null);

  useEffect(() => {
    let current = true;
    api.getOrder(id).then(
      (order) => {
        if (!current) return;
        statusRef.current = order.status;
        setLoad({ phase: 'ready', order });
        setForm(toForm(order));
        store.put(order);
      },
      (error: unknown) => {
        if (!current) return;
        // 404: no such order. 400: the id in the address is not a UUID at all.
        if (
          error instanceof ApiError &&
          (error.status === 404 || error.status === 400)
        ) {
          setLoad({ phase: 'missing' });
        } else {
          setLoad({
            phase: 'error',
            message:
              error instanceof ApiError
                ? error.message
                : 'Something went wrong while loading the order.',
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [api, store, id, attempt]);

  useEffect(
    () =>
      live.onOrderEvent((event) => {
        if (event.id !== id || event.type !== ORDER_APPROVED) return;
        // Approving here sends this same event back. The answer to the request has
        // updated the screen already, or is about to.
        if (savingRef.current || statusRef.current === 'approved') return;
        setNotice('approved-elsewhere');
        setAttempt((count) => count + 1);
      }),
    [live, id],
  );

  const draft = useMemo(() => (form ? draftFrom(form) : null), [form]);

  if (load.phase === 'loading') return <LoadingBlock label="Loading order" />;
  if (load.phase === 'missing') {
    return (
      <EmptyBlock title="Order not found">
        <p>
          No order has this address. <a href={paths.queue()}>Go to the queue</a>
        </p>
      </EmptyBlock>
    );
  }
  if (load.phase === 'error') {
    return (
      <div className="panel">
        <ErrorBlock
          title="Could not load the order"
          message={load.message}
          onRetry={() => {
            setLoad({ phase: 'loading' });
            setAttempt((count) => count + 1);
          }}
        />
      </div>
    );
  }
  if (!form || !draft) return null;

  const { order } = load;
  const held = isHeld(order.status);
  const items = held
    ? reasonItems(order.reviewReasons, orderContent(order), draft.order)
    : [];
  const openCount = items.filter((item) => item.state === 'open').length;

  async function approve(): Promise<void> {
    if (!draft || savingRef.current) return;
    if (draft.errors.length > 0) {
      setBlocked(true);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setBlocked(false);
    setSaveError(null);
    try {
      const approved = await api.approveOrder(id, draft.order);
      statusRef.current = approved.status;
      setLoad({ phase: 'ready', order: approved });
      setForm(toForm(approved));
      store.put(approved);
      setNotice('approved');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Someone reviewed it first. Show the order as it is now.
        setNotice('already-reviewed');
        setAttempt((count) => count + 1);
      } else {
        setSaveError(
          error instanceof ApiError
            ? error.message
            : 'Something went wrong while saving.',
        );
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <a href={paths.queue()}>Back to queue</a>
        <h1>{order.customerName ?? order.emailSubject}</h1>
        <StatusChip status={order.status} />
        {order.referenceNumber && (
          <span className="muted">{order.referenceNumber}</span>
        )}
      </div>

      {notice && (
        <div className={`notice ${NOTICES[notice].tone}`} role="status">
          {NOTICES[notice].text}
        </div>
      )}
      {held ? <HoldReasons items={items} /> : <StatusNote order={order} />}

      <div className="order-layout">
        <EmailPane order={order} />
        <div className="order-side">
          <OrderForm
            form={form}
            onChange={setForm}
            editable={held && !saving}
            errors={draft.errors}
            totalWeightLbs={totalWeightLbs(draft.order)}
          />
          {held && (
            <div className="approve-bar panel">
              {blocked && draft.errors.length > 0 && (
                <p className="approve-message error" role="alert">
                  {draft.errors.length === 1
                    ? 'One field has a value that cannot be saved.'
                    : `${draft.errors.length} fields have values that cannot be saved.`}{' '}
                  Correct what is marked above. Nothing was sent.
                </p>
              )}
              {saveError && (
                <p className="approve-message error" role="alert">
                  Could not approve the order. {saveError}
                </p>
              )}
              <div className="approve-row">
                <span className="muted">
                  {openCount === 0
                    ? 'No check is open.'
                    : `${openCount} ${openCount === 1 ? 'check is' : 'checks are'} still open. Approving saves the order as it is.`}
                </span>
                <button
                  type="button"
                  className="button primary"
                  disabled={saving}
                  onClick={() => void approve()}
                >
                  {saving ? 'Approving' : 'Approve order'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
