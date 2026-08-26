import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";

// Testing Library's 1s default for waitFor/findBy* is comfortable for a single
// file but not when all 56 test files run in parallel and contend for CPU — the
// heavier page tests (Survey's 13-question submit, the Radix-dialog flows) then
// miss the window and fail in ways that move between runs instead of pointing
// at real bugs. Raising the async window fixes that class of flake; it does not
// slow down passing assertions, which resolve as soon as the DOM settles.
configure({ asyncUtilTimeout: 5000 });

// Polyfill ResizeObserver for Radix UI components in JSDOM
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// motion's useInView (performance-benchmark-card.tsx) calls `new
// IntersectionObserver(...)` unguarded — JSDOM has none, so without this
// stub the effect throws on every render. Firing the callback synchronously
// as "always intersecting" lets scroll-triggered animations settle
// immediately under test instead of hanging forever.
class IntersectionObserverMock {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as globalThis.IntersectionObserver);
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
global.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver;

// Radix Select probes these to manage its popper; JSDOM implements none of them,
// so without the stubs the listbox never opens under test.
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
Element.prototype.scrollIntoView = () => {};

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
