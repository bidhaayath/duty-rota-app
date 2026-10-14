/* Starts a month build in a background worker, so the page stays usable for
   the several seconds a month takes. Kept apart from monthBuild.js because
   this is the one piece that only works in a browser (and the tests read
   monthBuild.js directly).

   If the browser cannot start a worker, the build runs on the page instead,
   the way Smart Roster runs a week: after a short pause so the "Building…"
   message is on screen first. The page is busy until it finishes, but the
   result is the same.

   Returns { promise, cancel }. Cancelling (a different department, the
   panel closing) stops the worker and the promise never settles.       */

import { runEngine } from "./monthBuild";

export function startMonthBuild(config, chosenCodes) {
  let worker = null;
  let cancelled = false;
  let timer = null;

  const promise = new Promise((resolve, reject) => {
    const onMainThread = () => {
      timer = setTimeout(() => {
        if (cancelled) return;
        try { resolve({ ...runEngine(config, chosenCodes), inBackground: false }); } catch (e) { reject(e); }
      }, 30);
    };
    try {
      worker = new Worker(new URL("./rosterWorker.js", import.meta.url));
    } catch (e) {
      worker = null;
    }
    if (!worker) { onMainThread(); return; }
    worker.onmessage = (e) => {
      const out = e.data || {};
      worker.terminate(); worker = null;
      if (cancelled) return;
      if (out.crashed) reject(new Error(out.message));
      else resolve({ ...out, inBackground: true });
    };
    // A worker that fails to load is not a reason to give up: run it here.
    worker.onerror = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (worker) { worker.terminate(); worker = null; }
      if (!cancelled) onMainThread();
    };
    worker.postMessage({ config, chosenCodes });
  });

  const cancel = () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    if (worker) { worker.terminate(); worker = null; }
  };
  return { promise, cancel };
}
