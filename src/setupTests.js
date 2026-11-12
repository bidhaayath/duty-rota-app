// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Smart Roster remembers the step each department was on. One test's step
// must not carry into the next, so this browser's storage starts empty each time.
afterEach(() => {
  try { window.localStorage.clear(); } catch (e) { /* no storage in this environment */ }
});
