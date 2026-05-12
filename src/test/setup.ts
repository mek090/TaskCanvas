import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

Object.defineProperty(window, 'crypto', {
  value: {
    randomUUID: vi.fn(() => `test-${Math.random().toString(16).slice(2)}`),
  },
  configurable: true,
});

Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(),
  },
});
