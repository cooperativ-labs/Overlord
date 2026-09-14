import { Window } from 'happy-dom';

const testWindow = new Window({ url: 'http://localhost' });

const globals = {
  window: testWindow,
  document: testWindow.document,
  navigator: testWindow.navigator,
  location: testWindow.location,
  history: testWindow.history,
  HTMLElement: testWindow.HTMLElement,
  Node: testWindow.Node,
  Event: testWindow.Event,
  EventTarget: testWindow.EventTarget,
  CustomEvent: testWindow.CustomEvent,
  MutationObserver: testWindow.MutationObserver,
  getComputedStyle: testWindow.getComputedStyle.bind(testWindow),
  requestAnimationFrame: testWindow.requestAnimationFrame.bind(testWindow),
  cancelAnimationFrame: testWindow.cancelAnimationFrame.bind(testWindow)
};

for (const [name, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
