import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';

// Unmount whatever a test rendered, so one test's screen never leaks into the next.
afterEach(() => {
  cleanup();
  window.location.hash = '';
});
