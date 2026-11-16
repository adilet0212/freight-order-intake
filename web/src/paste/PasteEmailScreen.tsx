import { useId, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client.js';
import type { Order } from '../api/types.js';
import { localInputToIso, toLocalInputValue } from '../format.js';
import { StatusChip } from '../queue/StatusChip.js';
import { paths } from '../route.js';
import { useServices } from '../services.js';
import { inboundEmailSchema, type InboundEmail } from '../shared.js';

type State =
  | { phase: 'idle' }
  | { phase: 'invalid'; problems: string[] }
  | { phase: 'sending' }
  | { phase: 'done'; order: Order; created: boolean }
  | { phase: 'failed'; status: number; message: string };

const FIELD_NAMES: Record<string, string> = {
  subject: 'Subject',
  body: 'Email text',
  receivedAt: 'Received',
  messageId: 'Message-ID',
};

/**
 * Checks the email with the schema the API itself uses for POST /emails, so the limits
 * are the API's limits and are written down in one place only.
 */
function problemsWith(email: Partial<InboundEmail>): string[] {
  const checked = inboundEmailSchema.safeParse(email);
  if (checked.success) return [];
  return checked.error.issues.map((issue) => {
    const name = FIELD_NAMES[String(issue.path[0])] ?? 'The email';
    if (issue.code === 'too_big') {
      return `${name} is too long. The limit is ${Number(issue.maximum).toLocaleString('en-US')} characters.`;
    }
    if (issue.code === 'too_small' || issue.code === 'invalid_type') {
      return `${name} is required.`;
    }
    return `${name}: ${issue.message}`;
  });
}

/** A form that sends one email to POST /emails, for trying the pipeline by hand. */
export function PasteEmailScreen() {
  const { api, store } = useServices();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [receivedAt, setReceivedAt] = useState(() =>
    toLocalInputValue(new Date()),
  );
  const [messageId, setMessageId] = useState('');
  const [state, setState] = useState<State>({ phase: 'idle' });
  const sendingRef = useRef(false);
  const ids = {
    subject: useId(),
    body: useId(),
    received: useId(),
    message: useId(),
  };
  const sending = state.phase === 'sending';

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (sendingRef.current) return;

    const email: Partial<InboundEmail> = {
      subject: subject.trim(),
      // The text is sent as pasted. Only an all-blank body counts as empty.
      body: body.trim() === '' ? '' : body,
      receivedAt: localInputToIso(receivedAt) ?? undefined,
    };
    if (messageId.trim() !== '') email.messageId = messageId.trim();

    const problems = problemsWith(email);
    if (problems.length > 0) {
      setState({ phase: 'invalid', problems });
      return;
    }

    sendingRef.current = true;
    setState({ phase: 'sending' });
    try {
      const result = await api.ingestEmail(email as InboundEmail);
      // The queue learns of it from the answer too, not only from the live event.
      store.put(result.order);
      setState({ phase: 'done', ...result });
    } catch (error) {
      setState({
        phase: 'failed',
        status: error instanceof ApiError ? error.status : 0,
        message:
          error instanceof ApiError
            ? error.message
            : 'Something went wrong while sending the email.',
      });
    } finally {
      sendingRef.current = false;
    }
  }

  function clear(): void {
    setSubject('');
    setBody('');
    setMessageId('');
    setReceivedAt(toLocalInputValue(new Date()));
    setState({ phase: 'idle' });
  }

  return (
    <div className="paste">
      <div className="page-head">
        <h1>Paste an email</h1>
      </div>
      <p className="muted paste-intro">
        Sends one email through the pipeline: extraction by the model, then
        normalization and the review gate. The result is stored as an order.
      </p>

      <form
        className="panel paste-form"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <div className="field">
          <label htmlFor={ids.subject}>Subject</label>
          <input
            id={ids.subject}
            value={subject}
            disabled={sending}
            onChange={(event) => setSubject(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={ids.body}>Email text</label>
          <textarea
            id={ids.body}
            rows={14}
            value={body}
            disabled={sending}
            onChange={(event) => setBody(event.target.value)}
          />
        </div>
        <div className="paste-row">
          <div className="field">
            <label htmlFor={ids.received}>Received</label>
            <input
              id={ids.received}
              type="datetime-local"
              value={receivedAt}
              disabled={sending}
              aria-describedby={`${ids.received}-hint`}
              onChange={(event) => setReceivedAt(event.target.value)}
            />
            <span id={`${ids.received}-hint`} className="hint">
              Your local time. The model uses it to work out dates such as
              "tomorrow".
            </span>
          </div>
          <div className="field">
            <label htmlFor={ids.message}>Message-ID (optional)</label>
            <input
              id={ids.message}
              value={messageId}
              disabled={sending}
              aria-describedby={`${ids.message}-hint`}
              onChange={(event) => setMessageId(event.target.value)}
            />
            <span id={`${ids.message}-hint`} className="hint">
              Identifies the email. Without it, the same text with a different
              received time is treated as a new email.
            </span>
          </div>
        </div>

        {state.phase === 'invalid' && (
          <div className="notice error" role="alert">
            <div>
              Nothing was sent.
              <ul>
                {state.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {state.phase === 'failed' && (
          <div className="notice error" role="alert">
            <div>
              {state.status === 400
                ? 'The API refused the email. '
                : 'The email was not stored. '}
              {state.message}
              {state.status !== 400 && (
                <> Nothing was saved, so it is safe to send it again.</>
              )}
            </div>
          </div>
        )}
        {state.phase === 'sending' && (
          <div className="notice info" role="status">
            Reading the email. The model usually answers in a few seconds and
            can take up to a minute and a half.
          </div>
        )}
        {state.phase === 'done' && (
          <div className="notice success" role="status">
            <span>
              {state.created
                ? 'Order created.'
                : 'This email was already stored. No new order was created.'}
            </span>
            <StatusChip status={state.order.status} />
            <span className="spacer" />
            <a href={paths.order(state.order.id)}>Open the order</a>
          </div>
        )}

        <div className="paste-actions">
          <button type="submit" className="button primary" disabled={sending}>
            {sending ? 'Extracting' : 'Extract order'}
          </button>
          <button
            type="button"
            className="button"
            disabled={sending}
            onClick={clear}
          >
            Clear
          </button>
        </div>
      </form>
    </div>
  );
}
