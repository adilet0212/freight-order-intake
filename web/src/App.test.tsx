import { act, screen } from '@testing-library/react';
import { App } from './App.js';
import { PRODUCT_NAME } from './brand.js';
import { fakeLive } from './test/fakes.js';
import { renderWithServices } from './test/render.js';

describe('App shell', () => {
  it('shows the product name and the two navigation links', () => {
    renderWithServices(<App />);

    expect(screen.getByText(PRODUCT_NAME)).toBeInTheDocument();
    expect(PRODUCT_NAME).toBe('Freight Order Intake');
    expect(screen.getByRole('link', { name: 'Queue' })).toHaveAttribute(
      'href',
      '#/',
    );
    expect(
      screen.getByRole('link', { name: 'Paste an email' }),
    ).toHaveAttribute('href', '#/paste');
  });

  it('marks the current screen in the navigation and follows the address', () => {
    renderWithServices(<App />);
    expect(screen.getByRole('link', { name: 'Queue' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    act(() => {
      window.location.hash = '#/paste';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(
      screen.getByRole('link', { name: 'Paste an email' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Queue' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('shows in the header whether live updates are arriving', () => {
    const live = fakeLive('connecting');
    renderWithServices(<App />, { live });
    const header = screen.getByRole('banner');

    expect(header).toHaveTextContent('Connecting');
    act(() => live.setState('live'));
    expect(header).toHaveTextContent('Live');
    act(() => live.setState('reconnecting'));
    expect(header).toHaveTextContent('Reconnecting');
    act(() => live.setState('offline'));
    expect(header).toHaveTextContent('Offline');
  });

  it('opens the queue on the status named in the address', async () => {
    window.location.hash = '#/?status=approved';
    renderWithServices(<App />);
    expect(
      await screen.findByRole('link', { name: 'Approved 0' }),
    ).toHaveAttribute('aria-current', 'true');
  });

  it('says so when the address matches no screen', () => {
    window.location.hash = '#/settings';
    renderWithServices(<App />);
    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
  });
});
