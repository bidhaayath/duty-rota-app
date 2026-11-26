/* Runs the roster engine off the main page, so building a month (several
   seconds) never freezes the screen. Started by monthBuildRunner.js; given
   an engine configuration, it answers with the engine's result and the
   cells in the ward's own codes. Never imported by the page itself. */
/* eslint-disable no-restricted-globals */
import { runEngine, runAnotherOption } from "./monthBuild";

self.onmessage = (e) => {
  const { config, chosenCodes, another } = e.data || {};
  try {
    self.postMessage(another
      ? runAnotherOption(config, chosenCodes, another.keptCells, another.next)
      : runEngine(config, chosenCodes));
  } catch (err) {
    self.postMessage({ crashed: true, message: String((err && err.message) || err) });
  }
};
