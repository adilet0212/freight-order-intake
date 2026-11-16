import { act, render, screen } from '@testing-library/react';
import { App } from './App.js';
import { PRODUCT_NAME } from './brand.js';

describe('App shell', () => {
  it('shows the product name and the two navigation links', () => {
    render(<App />);

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
    render(<App />);
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

  it('says so when the address matches no screen', () => {
    window.location.hash = '#/settings';
    render(<App />);
    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
  });
});
