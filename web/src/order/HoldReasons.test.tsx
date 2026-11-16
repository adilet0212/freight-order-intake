import { render, screen, within } from '@testing-library/react';
import { makeOrder } from '../test/fakes.js';
import { reasonItems } from './hold-reasons.js';
import { HoldReasons, StatusNote } from './HoldReasons.js';
import { orderContent } from './order-form.js';

const complete = orderContent(makeOrder());
const noDelivery = { ...complete, stops: [complete.stops[0]] };

describe('HoldReasons', () => {
  it('lists each reason in plain words with where it stands', () => {
    const stored = [
      'No delivery stop',
      'Model flagged: Two PO numbers are given.',
    ];
    render(<HoldReasons items={reasonItems(stored, noDelivery, noDelivery)} />);

    const panel = within(
      screen.getByRole('region', { name: 'Held for review' }),
    );
    const [first, second] = panel.getAllByRole('listitem');
    expect(first).toHaveTextContent('Open');
    expect(first).toHaveTextContent(
      'There is no delivery stop. Add where the freight is going.',
    );
    expect(second).toHaveTextContent('Check the email');
    expect(second).toHaveTextContent(
      'The email is unclear: Two PO numbers are given.',
    );
    expect(
      panel.getByText('1 open, 1 to check against the email'),
    ).toBeInTheDocument();
    // The stored wording is replaced, not shown beside the plain one.
    expect(panel.queryByText('No delivery stop')).not.toBeInTheDocument();
    expect(panel.queryByText(/Model flagged/)).not.toBeInTheDocument();
  });

  it('shows a reason as fixed once the edited order no longer breaks the rule', () => {
    const stored = [
      'No delivery stop',
      'Model flagged: Two PO numbers are given.',
    ];
    render(<HoldReasons items={reasonItems(stored, noDelivery, complete)} />);

    const [first] = screen.getAllByRole('listitem');
    expect(first).toHaveTextContent('Fixed');
    expect(first).not.toHaveTextContent('Open');
    expect(
      screen.getByText('0 open, 1 to check against the email, 1 fixed'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Nothing is left open. Read the email for the 1 item marked "Check the email", then approve.',
      ),
    ).toBeInTheDocument();
  });

  it('says the order can be approved when every reason is fixed and none needs the email', () => {
    render(
      <HoldReasons
        items={reasonItems(['No delivery stop'], noDelivery, complete)}
      />,
    );
    expect(
      screen.getByText('Nothing is left open. The order can be approved.'),
    ).toBeInTheDocument();
    expect(screen.getByText('0 open, 1 fixed')).toBeInTheDocument();
  });

  it('explains a failed extraction and keeps the technical message out of the way', () => {
    const empty = { ...complete, stops: [], commodities: [] };
    render(
      <HoldReasons
        items={reasonItems(
          [
            'Model output did not match the schema: expected boolean, received string',
          ],
          empty,
          empty,
        )}
      />,
    );

    expect(
      screen.getByText(/The model’s answer could not be read/),
    ).toBeInTheDocument();
    expect(screen.getByText('Technical detail')).toBeInTheDocument();
    expect(
      screen.getByText('expected boolean, received string'),
    ).toBeInTheDocument();
    // What the empty order still needs is listed as open.
    expect(
      screen.getByText('3 open, 1 to check against the email'),
    ).toBeInTheDocument();
  });

  it('shows a reason it has no wording for exactly as stored', () => {
    render(
      <HoldReasons
        items={reasonItems(['Hazmat class missing'], complete, complete)}
      />,
    );
    expect(screen.getByText('Hazmat class missing')).toBeInTheDocument();
  });

  it('says so when a held order has no recorded reason', () => {
    render(<HoldReasons items={[]} />);
    expect(
      screen.getByText('No reason was recorded for this order.'),
    ).toBeInTheDocument();
  });
});

describe('StatusNote', () => {
  it('says an auto-accepted order passed every check', () => {
    render(<StatusNote order={makeOrder({ status: 'auto_accepted' })} />);
    expect(
      screen.getByText(
        'Accepted automatically. It passed every check at intake.',
      ),
    ).toBeInTheDocument();
  });

  it('says why an email that is not an order has no order', () => {
    render(<StatusNote order={makeOrder({ status: 'not_an_order' })} />);
    expect(
      screen.getByText(/not being a shipment request/),
    ).toBeInTheDocument();
  });

  it('shows what an approved order had been held for, in plain words', () => {
    render(
      <StatusNote
        order={makeOrder({
          status: 'approved',
          reviewReasons: ['Pickup date missing'],
        })}
      />,
    );
    const panel = within(
      screen.getByRole('region', { name: 'Approved by a reviewer' }),
    );
    expect(panel.getByText('It had been held because:')).toBeInTheDocument();
    expect(
      panel.getByText(
        'The first pickup has no date, so it cannot be scheduled.',
      ),
    ).toBeInTheDocument();
  });

  it('shows nothing for a held order, which has the reasons panel instead', () => {
    const { container } = render(
      <StatusNote order={makeOrder({ status: 'needs_review' })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
