/* ─────────────── Smart Roster: build the whole month ───────────────
   The same month build Ini's panel offers, on the Make the roster step, for
   a manager who would rather not build week by week. Nothing new happens
   here: monthBuild.js prepares the month with the very configuration Smart
   Roster uses for a week, monthBuildRunner.js runs the engine in the
   background, and MonthPreview.js shows the month and applies it in one
   Undo step. Building runs in the browser and uses none of Ini's monthly
   allowance.

   Fairness looks back as far as Smart Roster's own setting does, counted
   from the 1st of the month. Duties already on the rota are kept unless the
   manager unticks the box.                                               */

import React, { useEffect, useRef, useState } from "react";
import { Wand2, AlertTriangle } from "lucide-react";
import { prepareBuild, finishMonth, plainProblems, lookbackOptions, lookbackSentence, monthBounds, periodLabel } from "./monthBuild";
import MonthPreview from "./MonthPreview";

// The runner is loaded when a month is first built: it starts a browser
// worker, which only a browser can do.
const loadRunner = () => import("./monthBuildRunner");

const pad2 = (n) => String(n).padStart(2, "0");
// The month after the one holding `iso` ("YYYY-MM-DD"), as "YYYY-MM".
const monthAfter = (iso) => {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};

export default function MonthBuildCard({ data, update, T, Card, Btn, Field, inputStyle, editable, staffEditable, today, onMonthApplied }) {
  const [month, setMonth] = useState(() => monthAfter(today));
  const [keepExisting, setKeepExisting] = useState(true);
  const [building, setBuilding] = useState(false);
  const [problems, setProblems] = useState(null);
  const [preview, setPreview] = useState(null);
  const job = useRef(null);

  // A build still running when the page goes away is stopped, never applied.
  useEffect(() => () => { if (job.current) job.current.cancel(); }, []);

  const okMonth = /^\d{4}-\d{2}$/.test(month || "");
  const { from, to } = okMonth ? monthBounds(month) : { from: "", to: "" };
  const label = okMonth ? periodLabel(from, to) : "";
  const look = okMonth ? lookbackOptions(from, data.rosterRules)[0] : null;

  const build = () => {
    if (!okMonth || building) return;
    setProblems(null);
    let prep;
    try {
      prep = prepareBuild({
        data, from, to, lookFrom: look ? look.from : null, keepExisting,
        // View-only staff cannot have their cells changed, so they are planned around as they stand.
        lockedStaffIds: typeof staffEditable === "function"
          ? (data.staff || []).filter((s) => !staffEditable(s.id)).map((s) => s.id) : [],
      });
    } catch (e) {
      console.error("Smart Roster: could not prepare the month", e);
      setProblems(["Something went wrong while getting the month ready. Nothing has been changed."]);
      return;
    }
    if (job.current) job.current.cancel();
    setBuilding(true);
    // A placeholder until the runner has loaded, so a second press or leaving the page cancels it.
    const mine = { cancel: () => { mine.off = true; if (mine.run) mine.run.cancel(); }, run: null, off: false };
    job.current = mine;
    loadRunner().then(({ startMonthBuild }) => {
      if (job.current !== mine || mine.off) return undefined;
      mine.run = startMonthBuild(prep.config, prep.chosenCodes);
      return mine.run.promise;
    }).then(
      (out) => {
        if (job.current !== mine || !out) return;
        job.current = null;
        setBuilding(false);
        if (!out.ok) { setProblems(plainProblems(prep, out.problems)); return; }
        setPreview({
          prep, builtFrom: data, shown: 0, next: 1, noMore: false, busy: false,
          options: [{ proposal: { ...finishMonth(prep, out, data), ms: out.ms }, cells: out.cells }],
        });
      },
      (e) => {
        if (job.current !== mine) return;
        console.error("Smart Roster: month build failed", e);
        job.current = null;
        setBuilding(false);
        setProblems(["Something went wrong while building. Nothing has been changed."]);
      },
    );
  };

  /* "Show another option": the same month built again with every random
     choice moved along, as Smart Roster's week does it. Up to three options
     are kept to page through. Built from the rota as it was when the month
     was first built, so every option is checked against the same rota. */
  const MAX_OPTIONS = 3;
  const another = () => {
    const p = preview;
    if (!p || p.busy || p.noMore) return;
    if (p.shown < p.options.length - 1) { setPreview({ ...p, shown: p.shown + 1 }); return; }
    if (p.options.length >= MAX_OPTIONS) { setPreview({ ...p, noMore: true }); return; }
    setPreview({ ...p, busy: true });
    const mine = { cancel: () => { mine.off = true; if (mine.run) mine.run.cancel(); }, run: null, off: false };
    job.current = mine;
    loadRunner().then(({ startMonthBuild }) => {
      if (job.current !== mine || mine.off) return undefined;
      mine.run = startMonthBuild(p.prep.config, p.prep.chosenCodes, { keptCells: p.options.map((o) => o.cells), next: p.next });
      return mine.run.promise;
    }).then(
      (out) => {
        if (job.current !== mine || !out) return;
        job.current = null;
        setPreview((cur) => {
          if (!cur || cur.prep !== p.prep) return cur;
          if (!out.ok) return { ...cur, busy: false, noMore: true, next: out.next };
          const options = [...cur.options, { proposal: { ...finishMonth(cur.prep, out, cur.builtFrom), ms: out.ms }, cells: out.cells }];
          return { ...cur, busy: false, options, shown: options.length - 1, next: out.next,
            noMore: options.length >= MAX_OPTIONS };
        });
      },
      (e) => {
        if (job.current !== mine) return;
        console.error("Smart Roster: another option failed", e);
        job.current = null;
        setPreview((cur) => (cur ? { ...cur, busy: false, noMore: true } : cur));
      },
    );
  };
  const discard = () => {
    if (job.current) { job.current.cancel(); job.current = null; }
    setPreview(null);
  };

  const hint = { fontSize: 12.5, color: T.inkSoft, lineHeight: 1.6 };
  return (
    <Card>
      <h3 style={{ fontFamily: "'Plus Jakarta Sans', Inter, sans-serif", fontSize: 16, margin: 0 }}>Or build the whole month</h3>
      <p style={{ ...hint, margin: "4px 0 12px" }}>
        Every week of the month at once, with the same settings, rules and approved requests. Nothing changes on
        the rota until you have checked it and pressed Apply, and Undo takes the whole month back in one step.
      </p>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "end" }}>
        <Field label="Month">
          <input type="month" value={month} disabled={!editable || building} aria-label="Month to build"
            onChange={(e) => { setMonth(e.target.value); setProblems(null); }}
            style={{ ...inputStyle, width: "auto", minHeight: 44, boxSizing: "border-box" }} />
        </Field>
        <Btn onClick={build} disabled={!editable || building || !okMonth} style={{ minHeight: 44 }}>
          <Wand2 size={15} /> {building ? "Building…" : "Generate this month"}
        </Btn>
        {building && <div style={{ ...hint, paddingBottom: 9 }}>Building {label}… this can take a few seconds.</div>}
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: T.ink, lineHeight: 1.45,
                      cursor: "pointer", marginTop: 12 }}>
        <input type="checkbox" checked={keepExisting} disabled={!editable || building}
          onChange={(e) => setKeepExisting(e.target.checked)}
          style={{ width: 16, height: 16, marginTop: 2, accentColor: T.lagoon, flexShrink: 0 }} />
        <span>
          Keep duties already on the rota (only fill empty days)
          {!keepExisting && (
            <span style={{ display: "block", fontSize: 12, color: "#8A5A0F", marginTop: 2 }}>
              Duties already in this month will be replaced. You will see how many before anything is written.
            </span>
          )}
        </span>
      </label>
      {look && <p style={{ ...hint, fontSize: 12, margin: "8px 0 0" }}>{lookbackSentence(look, from)}</p>}
      {problems && problems.length > 0 && (
        <div role="alert" style={{ background: "#FBEAE7", border: "1px solid #F1B8AE", borderRadius: 10, padding: "11px 13px",
                                    marginTop: 12, fontSize: 13, color: "#8A2E1E", lineHeight: 1.6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 3 }} />
            <div>
              <strong>{label || "The month"} could not be built. Nothing has been changed.</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {problems.map((p, i) => <li key={i} style={{ marginBottom: 3 }}>{p}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* The built month, full screen. Discard comes back here; Apply writes it and shows it on the rota. */}
      {preview && (
        <MonthPreview
          key={preview.shown}
          proposal={preview.options[preview.shown].proposal}
          data={data}
          update={update}
          T={T}
          onDiscard={discard}
          onApplied={(f, t) => { setPreview(null); if (onMonthApplied) onMonthApplied(f, t); }}
          paging={{
            index: preview.shown, count: preview.options.length, busy: preview.busy,
            noMore: preview.noMore, onAnother: another,
            onShow: (i) => setPreview((cur) => (cur ? { ...cur, shown: i } : cur)),
          }}
        />
      )}
    </Card>
  );
}
