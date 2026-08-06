import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

const nativeGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = (element: Element, pseudoElement?: string | null) =>
  nativeGetComputedStyle(element, pseudoElement ? null : undefined);
