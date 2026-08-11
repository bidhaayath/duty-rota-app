/* ─────────────── Undo / redo ───────────────
   Every edit in the app already flows through one update() function, and
   that function replaces the rota rather than changing it in place. That is
   what makes this possible: each previous version of the rota is still a
   complete, untouched object. Undo is not a matter of reversing an action —
   it is a matter of putting an earlier version back.

   Nothing else in the app has to know about any of this. The hook watches
   the rota for changes and records what it sees, so an edit made anywhere —
   the rota grid, the Staff tab, Settings, Smart Roster, a tab written next
   year — is undoable without a line of code being added to it.

   What is NOT covered, and deliberately so: creating, renaming and deleting
   departments. Those write straight to the database rather than into the
   rota, and an undo button that silently failed to bring a deleted
   department back would be worse than no button at all.                  */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Undo2, Redo2 } from "lucide-react";

const LIMIT = 20;

/* ── Keeping the memory honest ──
   A snapshot is a whole rota, and twenty of them held at once could be a
   sizeable amount of memory on a phone — especially with a logo, which is
   an image encoded as a very long string.

   So before a version is filed away, anything in it that is identical to
   the current version is replaced by the current version's own copy. The
   old copy is then unreferenced and the browser reclaims it. Days nobody
   touched cost nothing; only what actually changed is kept twice.        */
const sameShallow = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
};

const shareUnchanged = (older, current) => {
  if (!older || !current) return older;
  const out = { ...older };
  // The logo is one long string. If it has not changed, keep one copy.
  if (older.logo && older.logo === current.logo) out.logo = current.logo;
  for (const key of ["cells", "cellMeta"]) {
    const oldMap = older[key], curMap = current[key];
    if (!oldMap || !curMap) continue;
    const merged = {};
    for (const date of Object.keys(oldMap)) {
      const a = oldMap[date], b = curMap[date];
      merged[date] = sameShallow(a, b) ? b : a;
    }
    out[key] = merged;
  }
  return out;
};

/* ── Saying what will be undone ──
   "Undo" alone asks the person to remember what they just did, which is
   precisely what they came here because they could not. So the two versions
   are compared and the difference described in the words they would use.

   Only the first difference found is reported, in rough order of how
   noticeable it is. One edit rarely changes two things at once, and when it
   does — deleting a staff member also clears their duties — the headline is
   the one worth saying.                                                  */
const nameOf = (rota, staffId) =>
  (rota.staff || []).find((s) => s.id === staffId)?.name || "a staff member";

const prettyDate = (iso) => {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

const countCellChanges = (before, after) => {
  const dates = new Set([...Object.keys(before.cells || {}), ...Object.keys(after.cells || {})]);
  const changed = [];
  for (const date of dates) {
    const a = (before.cells || {})[date] || {};
    const b = (after.cells || {})[date] || {};
    if (a === b) continue;
    for (const sid of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[sid] !== b[sid]) changed.push({ date, sid, from: a[sid], to: b[sid] });
    }
  }
  return changed;
};

export function describeChange(before, after) {
  if (!before || !after) return "the last change";

  // Duties first: it is what the app is mostly used for.
  const cellChanges = countCellChanges(before, after);
  if (cellChanges.length === 1) {
    const c = cellChanges[0];
    const codeName = (rota, id) => (rota.codes || []).find((x) => x.id === id)?.code;
    const to = codeName(after, c.to), from = codeName(before, c.from);
    const who = nameOf(after, c.sid);
    if (to && from) return `${who}'s duty on ${prettyDate(c.date)} changed from ${from} to ${to}`;
    if (to) return `${to} given to ${who} on ${prettyDate(c.date)}`;
    if (from) return `${from} cleared for ${who} on ${prettyDate(c.date)}`;
    return `a duty changed on ${prettyDate(c.date)}`;
  }
  if (cellChanges.length > 1) {
    const days = new Set(cellChanges.map((c) => c.date));
    return `${cellChanges.length} duties changed across ${days.size} day${days.size === 1 ? "" : "s"}`;
  }

  // Staff
  const sBefore = before.staff || [], sAfter = after.staff || [];
  if (sAfter.length > sBefore.length) {
    const added = sAfter.find((s) => !sBefore.some((x) => x.id === s.id));
    return `${added ? added.name : "a staff member"} added`;
  }
  if (sAfter.length < sBefore.length) {
    const gone = sBefore.find((s) => !sAfter.some((x) => x.id === s.id));
    return `${gone ? gone.name : "a staff member"} deleted`;
  }
  if (sBefore !== sAfter) {
    const order = sBefore.map((s) => s.id).join() !== sAfter.map((s) => s.id).join();
    if (order) return "the staff order changed";
    const edited = sAfter.find((s, i) => JSON.stringify(s) !== JSON.stringify(sBefore[i]));
    if (edited) {
      const was = sBefore.find((x) => x.id === edited.id) || {};
      if ((was.leavePeriods || []).length !== (edited.leavePeriods || []).length) {
        return `a leave period changed for ${edited.name}`;
      }
      if (was.endDate !== edited.endDate) {
        return edited.endDate ? `${edited.name} marked as left` : `${edited.name} reactivated`;
      }
      return `${edited.name}'s details changed`;
    }
  }

  // Duty codes
  const cBefore = before.codes || [], cAfter = after.codes || [];
  if (cAfter.length > cBefore.length) {
    const added = cAfter.find((c) => !cBefore.some((x) => x.id === c.id));
    return `duty code ${added ? added.code : ""} added`.trim();
  }
  if (cAfter.length < cBefore.length) {
    const gone = cBefore.find((c) => !cAfter.some((x) => x.id === c.id));
    return `duty code ${gone ? gone.code : ""} deleted`.trim();
  }
  if (cBefore !== cAfter) {
    const edited = cAfter.find((c, i) => JSON.stringify(c) !== JSON.stringify(cBefore[i]));
    if (edited) return `duty code ${edited.code} changed`;
  }

  // Everything else
  const noBefore = before.nonOfficial || [], noAfter = after.nonOfficial || [];
  if (noBefore.length !== noAfter.length) {
    const added = noAfter.length > noBefore.length;
    const diff = Math.abs(noAfter.length - noBefore.length);
    return `${diff} non-official day${diff === 1 ? "" : "s"} ${added ? "added" : "removed"}`;
  }
  if (before.title !== after.title) return "the ward name changed";
  if (before.logo !== after.logo) return after.logo ? "the logo changed" : "the logo removed";
  if (before.fridayRule !== after.fridayRule) return "the Friday rule changed";
  if (before.eveningEnabled !== after.eveningEnabled) return "the evening shift setting changed";
  /* Compared by content, not by identity. Every edit hands back a fresh deep
     copy of the rota, so `before.cellMeta !== after.cellMeta` is true even
     when nothing in it moved — which labelled unrelated changes as notes,
     and filed an entry for the "try saving again" button, quietly pushing a
     real edit off the end of the trail. */
  if (JSON.stringify(before.cellMeta) !== JSON.stringify(after.cellMeta)) {
    return "a note or exchange mark changed";
  }
  if (JSON.stringify(before.dutyRequests) !== JSON.stringify(after.dutyRequests)) return "a duty request changed";
  if (JSON.stringify(before.rosterRules) !== JSON.stringify(after.rosterRules)) return "a Smart Roster setting changed";
  /* Nothing found. That can mean a real change this function does not know
     how to name, or a new rota object holding identical content — which is
     exactly what "Try saving again" produces. Only the second is worth
     filtering out, and the only way to tell them apart is to compare. It
     costs a moment, and only on the rare change nothing else matched. */
  try {
    if (JSON.stringify(before) === JSON.stringify(after)) return null;
  } catch (e) { /* enormous or circular: treat as a real change */ }
  return "the last change";
}

/* ── The hook ──
   Watches the rota. Whenever it becomes a different object, the version
   before it is filed. Undo puts a filed version back; redo moves forward
   again. Making any fresh edit after an undo clears the redo trail, which
   is what every other program does and therefore what people expect.    */
export function useRotaHistory(data, setData, scopeKey, options = {}) {
  const limit = options.limit ?? LIMIT;
  const disabled = !!options.disabled;
  const store = useRef({ past: [], future: [], last: undefined, scope: scopeKey, replacing: false });
  const [, tick] = useState(0);
  const refresh = useCallback(() => tick((n) => n + 1), []);

  useEffect(() => {
    const h = store.current;

    /* Switching department loads a different rota entirely. Undoing across
       that boundary would write one ward's duties into another's, so the
       trail is dropped at the border. */
    if (scopeKey !== h.scope) {
      h.scope = scopeKey; h.past = []; h.future = []; h.last = data;
      refresh();
      return;
    }
    if (!data) { h.last = undefined; return; }      // still loading
    if (h.last === undefined) { h.last = data; return; }
    if (h.last === data) return;

    if (h.replacing) {                              // this change WAS an undo
      h.replacing = false; h.last = data; refresh(); return;
    }
    const label = describeChange(h.last, data);
    // A new rota object holding identical content is not something anybody
    // needs to undo, and filing it would push a real edit off the end.
    if (label === null) { h.last = data; return; }
    h.past.push({ rota: shareUnchanged(h.last, data), label });
    if (h.past.length > limit) h.past.shift();
    h.future = [];
    h.last = data;
    refresh();
  }, [data, scopeKey, limit, refresh]);

  const undo = useCallback(() => {
    const h = store.current;
    if (disabled || !h.past.length) return;
    const entry = h.past.pop();
    h.future.push({ rota: shareUnchanged(h.last, entry.rota), label: entry.label });
    h.replacing = true;
    setData(entry.rota);
    refresh();
  }, [disabled, setData, refresh]);

  const redo = useCallback(() => {
    const h = store.current;
    if (disabled || !h.future.length) return;
    const entry = h.future.pop();
    h.past.push({ rota: shareUnchanged(h.last, entry.rota), label: entry.label });
    h.replacing = true;
    setData(entry.rota);
    refresh();
  }, [disabled, setData, refresh]);

  /* Ctrl+Z and Ctrl+Shift+Z, or ⌘ on a Mac — but never while somebody is
     typing. Inside a text box those keys are the browser's own undo, and
     stealing them would rewind the whole rota when the person only meant to
     take back a mistyped letter. */
  useEffect(() => {
    const onKey = (e) => {
      const key = (e.key || "").toLowerCase();
      if (!(e.ctrlKey || e.metaKey) || (key !== "z" && key !== "y")) return;
      const el = e.target;
      const tag = el && el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el && el.isContentEditable)) return;
      e.preventDefault();
      if (key === "y" || e.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const h = store.current;
  return {
    undo, redo,
    canUndo: !disabled && h.past.length > 0,
    canRedo: !disabled && h.future.length > 0,
    undoLabel: h.past.length ? h.past[h.past.length - 1].label : "",
    redoLabel: h.future.length ? h.future[h.future.length - 1].label : "",
    depth: h.past.length,
    limit,
  };
}

/* Two buttons for the dark header. The tooltip says what will be undone, so
   nobody has to press it to find out — which, with an undo button, is the
   one way of finding out that cannot be taken back. */
export function UndoRedoButtons({ history, style }) {
  /* Sized to sit beside the save status rather than below it. On a phone the
     word "Undo" is hidden by the stylesheet and only the arrow remains — two
     small buttons on the same line as everything else, instead of a row of
     their own pushing the rota further down the screen.

     The redo arrow keeps a label for screen readers even when the word is
     hidden, because an icon-only button that is usually greyed out is
     otherwise indistinguishable from an empty box. */
  const base = {
    fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 5,
    background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: 8, padding: "4px 9px", fontSize: 12.5, fontWeight: 600, lineHeight: 1.4,
  };
  const btn = (on) => ({
    ...base,
    color: on ? "#DDEBE8" : "rgba(221,235,232,0.35)",
    cursor: on ? "pointer" : "not-allowed",
  });
  return (
    <span className="dr-undo-wrap" style={{ display: "inline-flex", gap: 6, ...style }}>
      <button className="dr-undo" onClick={history.undo} disabled={!history.canUndo}
        aria-label={history.canUndo ? `Undo ${history.undoLabel}` : "Nothing to undo"}
        style={btn(history.canUndo)}
        title={history.canUndo ? `Undo — ${history.undoLabel}` : "Nothing to undo"}>
        <Undo2 size={13} /> <span className="dr-undo-text">Undo</span>
      </button>
      <button className="dr-undo" onClick={history.redo} disabled={!history.canRedo}
        aria-label={history.canRedo ? `Redo ${history.redoLabel}` : "Nothing to redo"}
        style={btn(history.canRedo)}
        title={history.canRedo ? `Redo — ${history.redoLabel}` : "Nothing to redo"}>
        <Redo2 size={13} />
      </button>
    </span>
  );
}