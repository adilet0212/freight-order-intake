import { reviewGate, type NormalizedOrder } from '../shared.js';

/**
 * open:  a rule of the review gate that fires for the order as it is now.
 * fixed: a rule that fired at intake and no longer does.
 * check: something code cannot re-check from the order alone (the model said the email
 *        was unclear, or a value it returned could not be used). A person has to read
 *        the email.
 */
export type ReasonState = 'open' | 'fixed' | 'check';

export interface ReasonItem {
  key: string;
  /** The reason in plain words. */
  text: string;
  /** Technical detail worth keeping but not worth leading with. */
  detail: string | null;
  state: ReasonState;
}

function lbs(value: string): string {
  return Number(value).toLocaleString('en-US');
}

/**
 * Says a stored hold reason in plain words.
 *
 * The API stores reasons as short strings written by review-gate.ts, normalize.ts and
 * orders.service.ts. Each pattern below matches one of them. A reason that matches none
 * is shown as it is, so a new rule is never hidden; hold-reasons.test.ts fails when a
 * rule in those files has no wording here.
 */
export function explainReason(reason: string): {
  text: string;
  detail: string | null;
} {
  const plain = (text: string, detail: string | null = null) => ({
    text,
    detail,
  });
  let match: RegExpExecArray | null;

  if (reason === 'No pickup stop') {
    return plain(
      'There is no pickup stop. Add where the freight is collected.',
    );
  }
  if (reason === 'No delivery stop') {
    return plain('There is no delivery stop. Add where the freight is going.');
  }
  if ((match = /^Stop (\d+): city or region missing$/.exec(reason))) {
    return plain(
      `Stop ${match[1]} has no city or no state/province, so it cannot be routed.`,
    );
  }
  if (reason === 'Pickup date missing') {
    return plain('The first pickup has no date, so it cannot be scheduled.');
  }
  if (reason === 'Delivery is before pickup') {
    return plain(
      'The last delivery is dated before the first pickup. One of the dates was probably misread.',
    );
  }
  if (reason === 'No commodities') {
    return plain(
      'No freight is listed. Add what is being shipped and its weight.',
    );
  }
  if (reason === 'Commodity weight missing') {
    return plain('At least one freight line has no weight.');
  }
  if (
    (match =
      /^Total weight (\d+) lbs is over one truckload \((\d+) lbs\)$/.exec(
        reason,
      ))
  ) {
    return plain(
      `The total weight is ${lbs(match[1])} lbs, more than one truckload (${lbs(match[2])} lbs). Check for a typo, or confirm the load is meant to be split.`,
    );
  }
  if ((match = /^Model flagged: (.+)$/s.exec(reason))) {
    return plain(`The email is unclear: ${match[1]}`);
  }
  if (
    (match =
      /^Stop (\d+): window (start|end) "(.*)" is not a valid date$/s.exec(
        reason,
      ))
  ) {
    return plain(
      `Stop ${match[1]}: the window ${match[2]} was read as "${match[3]}", which is not a real date and time. Enter it from the email.`,
    );
  }
  if (
    (match = /^Commodity (\d+): weight (.+) has no usable unit$/.exec(reason))
  ) {
    return plain(
      `Freight line ${match[1]}: the weight ${match[2]} came without a usable unit (lbs or kg), so it was left empty.`,
    );
  }
  if (
    (match = /^Commodity (\d+): quantity (.+) is not a whole number$/.exec(
      reason,
    ))
  ) {
    return plain(
      `Freight line ${match[1]}: the quantity ${match[2]} is not a whole number, so it was left empty.`,
    );
  }
  if ((match = /^Model output did not match the schema: (.*)$/s.exec(reason))) {
    return plain(
      'The model’s answer could not be read, so nothing was filled in. Enter the order from the email.',
      match[1],
    );
  }
  return plain(reason);
}

/** The gate's rules for an order a person is editing: no model input, only the order. */
export function gateReasons(order: NormalizedOrder): string[] {
  return reviewGate({
    isOrderRequest: true,
    order,
    normalizeIssues: [],
    ambiguities: [],
  }).reasons;
}

/**
 * Two reasons are the same rule when their text is equal, with one exception: the
 * total-weight reason contains the weight, so it changes text while staying one rule.
 */
function ruleOf(reason: string): string {
  return reason.startsWith('Total weight ') ? 'Total weight' : reason;
}

/**
 * What to show at the top of a held order while it is being edited.
 *
 * @param stored  the reasons the API stored at intake
 * @param atLoad  the order as it was loaded
 * @param draft   the order as the form reads now
 *
 * A stored reason that the gate also gives for `atLoad` is one of the gate's own rules,
 * so it can be re-checked against `draft` and is either still open or fixed. A stored
 * reason the gate does not give came from the model or from normalize.ts, and only a
 * person can settle it. A rule that fires for `draft` but was not stored is a problem
 * the edit introduced, and is listed as open too.
 */
export function reasonItems(
  stored: string[],
  atLoad: NormalizedOrder,
  draft: NormalizedOrder,
): ReasonItem[] {
  const checkable = new Set(gateReasons(atLoad).map(ruleOf));
  const now = new Map(
    gateReasons(draft).map((reason) => [ruleOf(reason), reason]),
  );
  const storedRules = new Set(stored.map(ruleOf));
  const items: ReasonItem[] = [];

  for (const reason of stored) {
    const rule = ruleOf(reason);
    if (!checkable.has(rule)) {
      items.push({ key: reason, ...explainReason(reason), state: 'check' });
    } else if (now.has(rule)) {
      // Worded from the current reason, so a changed weight shows the current number.
      items.push({
        key: rule,
        ...explainReason(now.get(rule)!),
        state: 'open',
      });
    } else {
      items.push({ key: rule, ...explainReason(reason), state: 'fixed' });
    }
  }
  for (const [rule, reason] of now) {
    if (!storedRules.has(rule)) {
      items.push({ key: rule, ...explainReason(reason), state: 'open' });
    }
  }
  return items;
}
