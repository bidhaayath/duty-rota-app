/* ─────────────── Ini's actions: build ───────────────
   build { from, to, historyFrom }

   The one action that is not saved with the others. It is carried out by
   the panel AFTER every other ticked line has been saved, from the rota
   that includes them: monthBuild.js prepares it, monthBuildRunner.js runs
   the engine and MonthPreview.js shows the result and applies it. So this
   entry only reads the server's item; it has no apply. */

import { isISO } from "./shared";

export const build = {
  type: "build",
  group: "build",
  afterSave: true,
  // from/to are the planning period when the note gave no dates of its own.
  fromServer: (a, { from, to }) => {
    const own = isISO(a.from) && isISO(a.to) && a.from <= a.to;
    return {
      from: own ? a.from : from,
      to: own ? a.to : to,
      historyFrom: isISO(a.historyFrom) ? a.historyFrom : null,
    };
  },
};
