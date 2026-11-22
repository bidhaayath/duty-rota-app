import React, { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Upload, X, FileSpreadsheet, AlertTriangle, Check } from "lucide-react";
import { readSheets, readGrid, planImport, defaultChoices, applyImport, summaryLine } from "./rosterImport";
import { LEAVE_STYLES } from "./leaveTypes";

/* ────────────────────────────────────────────────────────────────────────
   "Import a roster": the screen around rosterImport.js.

   1. Pick a file    .xlsx or .csv, read entirely in the browser. Nothing is
                     uploaded anywhere.
   2. Preview        what was found, and only the questions that need an
                     answer: names not on the Staff list, codes the
                     department doesn't have, and — when the dates already
                     hold duties — Replace or Only fill empty days.
   3. Add to rota    ONE update() call, so it is one save and one Undo step,
                     and it is refused exactly where every other edit is
                     (view-only, lapsed or locked departments).

   Opened only from the Rota toolbar, and only for people who can edit.
   ──────────────────────────────────────────────────────────────────────── */

const C = {
  ink: "#0E3A47", soft: "#3A5F6B", line: "#D3E5EC", lagoon: "#0D4F61",
  amberBg: "#FFF6E0", amberLine: "#E6C27A", amberInk: "#7A4F00",
  okBg: "#E8F5EE", okInk: "#2F7A50",
};
const MAX_BYTES = 10 * 1024 * 1024;
const COUNTS = [
  ["morning", "Morning duty"], ["afternoon", "Afternoon duty"], ["evening", "Evening duty"], ["night", "Night duty"],
  ["other", "Other duty"], ["release", "Release duty"], ["off", "Off day"],
  ["sl", "Sick leave (SL)"], ["frl", "Family related leave (FRL)"], ["ml", "Medical leave (ML)"], ["leave", "Other leave"],
];

const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
const nice = (s) => {
  if (!s) return "";
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

const input = {
  fontFamily: "inherit", fontSize: 13, padding: "6px 8px", borderRadius: 8,
  border: `1px solid ${C.line}`, background: "#fff", color: C.ink, boxSizing: "border-box",
};
const btn = (primary, disabled) => ({
  fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, borderRadius: 10, padding: "9px 16px",
  cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
  display: "inline-flex", alignItems: "center", gap: 6,
  ...(primary ? { background: C.lagoon, color: "#fff", border: "none" } : { background: "#fff", color: C.ink, border: `1px solid ${C.line}` }),
});
const Section = ({ title, children, note }) => (
  <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
      <div style={{ fontWeight: 800, fontSize: 13.5, color: C.ink }}>{title}</div>
      {note && <div style={{ fontSize: 12, color: C.soft }}>{note}</div>}
    </div>
    {children}
  </div>
);
const Amber = ({ children }) => (
  <div style={{ background: C.amberBg, border: `1px solid ${C.amberLine}`, color: C.amberInk, borderRadius: 10, padding: "8px 10px", fontSize: 12.5, display: "flex", gap: 8, alignItems: "flex-start" }}>
    <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /><div>{children}</div>
  </div>
);

export default function RosterImportDialog({ data, update, staffLimit = null, onClose, onDone }) {
  const [step, setStep] = useState("pick");       // pick | preview | done
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [grid, setGrid] = useState(null);
  const [plan, setPlan] = useState(null);
  const [choices, setChoices] = useState(null);
  const [report, setReport] = useState(null);
  const [showAllStaff, setShowAllStaff] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  const staffSorted = useMemo(() => [...(data.staff || [])].sort((a, b) => (a.name || "").localeCompare(b.name || "")), [data.staff]);
  const staffName = (id) => (data.staff.find((s) => s.id === id) || {}).name || "";

  const openFile = async (file) => {
    if (!file) return;
    setError("");
    if (file.size > MAX_BYTES) { setError("That file is over 10 MB. A roster is usually much smaller — check it's the right file."); return; }
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { setError("Please choose an Excel file (.xlsx) or a CSV file (.csv)."); return; }
    setBusy(true);
    try {
      const sheets = await readSheets(file, file.name);
      const g = readGrid(sheets, { fileName: file.name });
      const p = planImport(g, data);
      setFileName(file.name);
      setGrid(g); setPlan(p); setChoices(defaultChoices(p));
      setStep("preview");
    } catch (e) {
      setError(e && e.message ? e.message : "I couldn't read that file.");
    } finally {
      setBusy(false);
    }
  };

  /* Choices, changed one at a time. */
  const setPerson = (index, v) => setChoices((c) => ({ ...c, people: { ...c.people, [index]: v } }));
  const setCode = (key, v) => setChoices((c) => ({ ...c, codes: { ...c.codes, [key]: v } }));
  const editNewCode = (key, field, v) => setChoices((c) => ({ ...c, codes: { ...c.codes, [key]: { ...c.codes[key], [field]: v } } }));
  const setPost = (key, v) => setChoices((c) => ({ ...c, posts: { ...c.posts, [key]: v } }));

  /* The plan's staff limit, before anything is pressed. */
  const limitInfo = useMemo(() => {
    if (!plan || !choices || staffLimit == null) return null;
    const today = todayStr();
    const active = data.staff.filter((s) => !s.endDate || s.endDate >= today).length;
    const wanted = plan.people.filter((p) => choices.people[p.index] === "new");
    const room = Math.max(0, staffLimit - active);
    return wanted.length > room ? { room, left: wanted.slice(room).map((p) => p.name) } : null;
  }, [plan, choices, staffLimit, data.staff]);

  /* Evening duties only count when Evening shift is on. Say so before
     the import switches it on. */
  const eveningNeeded = !!plan && !!choices && !data.eveningEnabled && plan.codes.some((c) => {
    const v = choices.codes[c.key];
    if (v && typeof v === "object") return v.counts === "evening";
    return (data.codes.find((x) => x.id === v) || {}).counts === "evening";
  });
  const hoursFor = plan ? plan.codes.filter((c) => c.fillHours && choices && choices.codes[c.key] === c.existingId) : [];

  const hasEmails = !!grid && (grid.people.some((p) => p.details.email) || (grid.staffSheet || []).some((s) => s.email));
  const needsMode = !!plan && plan.existing > 0;
  const canAdd = !!choices && (!needsMode || !!choices.mode);

  const add = () => {
    if (!canAdd) return;
    const opts = { staffLimit, today: todayStr() };
    // A dry run on a copy gives the report; the real write happens in update().
    const dry = applyImport(structuredClone(data), grid, plan, choices, opts);
    update((d) => applyImport(d, grid, plan, choices, opts).data);
    setReport(dry.report);
    setStep("done");
    if (onDone) onDone({ from: plan.from, to: plan.to });
  };

  /* ── Pick ── */
  const pickBody = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ margin: 0, fontSize: 13, color: C.soft, lineHeight: 1.5 }}>
        Bring in a roster you already have: an Easy Duty Rota Excel export, or your own spreadsheet with a row of dates
        across the top and one row per person. Staff, duties, posts, breaks and leave are read from it.
        You'll see everything before anything is added.
      </p>
      <div
        role="button" tabIndex={0}
        onClick={() => fileRef.current && fileRef.current.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current && fileRef.current.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); openFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}
        style={{
          border: `2px dashed ${dragOver ? C.lagoon : C.line}`, borderRadius: 14, padding: "28px 16px",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8, cursor: "pointer",
          background: dragOver ? "#F1F8FB" : "#FAFDFE", color: C.ink, textAlign: "center",
        }}>
        <Upload size={26} color={C.lagoon} />
        <div style={{ fontWeight: 700, fontSize: 14 }}>{busy ? "Reading…" : "Choose a file, or drop it here"}</div>
        <div style={{ fontSize: 12, color: C.soft }}>Excel (.xlsx) or CSV · read on this device, never uploaded</div>
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; openFile(f); }} />
      {error && <Amber>{error}</Amber>}
    </div>
  );

  /* ── Preview ── */
  const previewBody = plan && choices && (() => {
    const attention = plan.people.filter((p) => p.status !== "exact");
    const shownPeople = showAllStaff ? plan.people : attention;
    const newCodes = plan.codes.filter((c) => !c.existingId);
    const knownCodes = plan.codes.filter((c) => c.existingId);
    const newPosts = plan.posts.filter((p) => !p.existingId);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ background: "#F1F8FB", borderRadius: 12, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.soft, marginBottom: 4 }}>
            <FileSpreadsheet size={14} /> {fileName}{(grid.sheetNames || []).length > 1 ? ` · ${grid.sheetNames.length} sheets` : (grid.sheetName ? ` · sheet "${grid.sheetName}"` : "")}
          </div>
          <div style={{ fontWeight: 800, fontSize: 14.5, color: C.ink }}>{nice(plan.from)} – {nice(plan.to)}</div>
          <div style={{ fontSize: 13, color: C.ink, marginTop: 2 }}>{summaryLine(plan)}</div>
        </div>
        {grid.issues.length > 0 && (
          <Amber>
            {grid.issues.length === 1 ? grid.issues[0] : (
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {grid.issues.slice(0, 8).map((t) => <li key={t}>{t}</li>)}
                {grid.issues.length > 8 && <li>…and {grid.issues.length - 8} more</li>}
              </ul>
            )}
          </Amber>
        )}
        {plan.days > 45 && (
          <div style={{ fontSize: 12, color: C.soft }}>
            That's {plan.days} days. Everything is added in one go; afterwards the rota opens at the first 45 days, and the rest is a date change away.
          </div>
        )}

        <Section title="Staff" note={attention.length
          ? `${plan.people.length - attention.length} of ${plan.people.length} found on your Staff list. Check the rest:`
          : `All ${plan.people.length} found on your Staff list.`}>
          {shownPeople.map((p) => {
            const v = choices.people[p.index];
            return (
              <div key={p.index} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 160px", fontSize: 13, color: C.ink }}>
                  <strong>{p.name}</strong>{p.designation ? <span style={{ color: C.soft }}> · {p.designation}</span> : null}
                  {p.status === "close" && <div style={{ fontSize: 11.5, color: C.amberInk }}>Looks like {staffName(p.staffId)} — please check</div>}
                  {!p.duties && !p.leaveDays && <div style={{ fontSize: 11.5, color: C.soft }}>No duties in this file</div>}
                </div>
                <select aria-label={`Who is ${p.name}?`} style={{ ...input, flex: "1 1 180px" }} value={v}
                  onChange={(e) => setPerson(p.index, e.target.value)}>
                  <option value="new">Add as new staff</option>
                  <optgroup label="Same person as">
                    {staffSorted.map((s) => <option key={s.id} value={s.id}>{s.name}{s.designation ? ` — ${s.designation}` : ""}</option>)}
                  </optgroup>
                  <option value="skip">Don't import this person</option>
                </select>
              </div>
            );
          })}
          {attention.length < plan.people.length && (
            <button type="button" onClick={() => setShowAllStaff((x) => !x)}
              style={{ alignSelf: "flex-start", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, color: C.lagoon, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              {showAllStaff ? "Show only the ones to check" : `Show all ${plan.people.length}`}
            </button>
          )}
          {limitInfo && (
            <Amber>
              Your plan includes {staffLimit} staff. {limitInfo.room ? `Only ${plural(limitInfo.room, "new person", "new people")} can be added` : "No new staff can be added"},
              so these won't be imported: {limitInfo.left.join(", ")}. Match them to existing staff above, or upgrade on the plan page.
            </Amber>
          )}
        </Section>

        {plan.codes.length > 0 && (
          <Section title="Duty codes" note={knownCodes.length ? `Already in your codes: ${knownCodes.map((c) => c.text).join(", ")}` : ""}>
            {newCodes.length === 0 && <div style={{ fontSize: 12.5, color: C.okInk }}>Every code in the file is already in your Duty Codes.</div>}
            {hoursFor.length > 0 && (
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", fontSize: 13, color: C.ink }}>
                <input type="checkbox" checked={!!choices.codeHours} onChange={(e) => setChoices((c) => ({ ...c, codeHours: e.target.checked }))} style={{ marginTop: 3 }} />
                <span>Add the file's hours to {hoursFor.map((c) => `${c.text} (${c.fillHours.start}–${c.fillHours.end})`).join(", ")}
                  <br /><span style={{ fontSize: 12, color: C.soft }}>These codes have no hours yet. Codes that already have hours are never changed.</span></span>
              </label>
            )}
            {eveningNeeded && (
              <div style={{ fontSize: 12.5, color: C.ink, background: "#F1F8FB", borderRadius: 8, padding: "6px 8px" }}>
                The file has Evening duties, so <strong>Evening shift</strong> will be switched on for this department. Otherwise they wouldn't be counted in the totals.
              </div>
            )}
            {newCodes.map((c) => {
              const v = choices.codes[c.key];
              const creating = v && typeof v === "object";
              return (
                <div key={c.key} style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 6, borderBottom: `1px dashed ${C.line}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, fontSize: 13, padding: "2px 8px", borderRadius: 6, background: creating ? v.color : "#EEF4F6", color: C.ink }}>{c.text}</span>
                    <span style={{ fontSize: 12, color: C.soft, flex: "1 1 100px" }}>used {plural(c.count, "time")} · not in your codes</span>
                    <select aria-label={`What is ${c.text}?`} style={{ ...input, flex: "1 1 180px" }}
                      value={creating ? "create" : v}
                      onChange={(e) => setCode(c.key, e.target.value === "create" ? { create: true, ...c.proposal } : e.target.value)}>
                      <option value="create">Create it as a new code</option>
                      <optgroup label="Same as my code">
                        {data.codes.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.label}</option>)}
                      </optgroup>
                      <option value="skip">Don't import these days</option>
                    </select>
                  </div>
                  {creating && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: C.soft }}>
                      <input aria-label="Name" style={{ ...input, flex: "1 1 140px" }} value={v.label} onChange={(e) => editNewCode(c.key, "label", e.target.value)} placeholder="Name, e.g. Day duty" />
                      <select aria-label="Counts as" style={{ ...input, flex: "1 1 150px" }} value={v.counts} onChange={(e) => editNewCode(c.key, "counts", e.target.value)}>
                        {COUNTS.map(([k, label]) => <option key={k} value={k}>Counts as: {label}</option>)}
                      </select>
                      <input aria-label="Starts" type="time" style={{ ...input, width: 100 }} value={v.start || ""} onChange={(e) => editNewCode(c.key, "start", e.target.value)} />
                      <span>–</span>
                      <input aria-label="Ends" type="time" style={{ ...input, width: 100 }} value={v.end || ""} onChange={(e) => editNewCode(c.key, "end", e.target.value)} />
                    </div>
                  )}
                </div>
              );
            })}
          </Section>
        )}

        {plan.posts.length > 0 && (
          <Section title="Posts" note={newPosts.length
            ? `${plural(newPosts.length, "new post")}${data.postsEnabled ? "" : " — Posts will be switched on for this department"}`
            : "All already in your posts."}>
            {newPosts.map((p) => (
              <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 160px", fontSize: 13, color: C.ink }}><strong>{p.name}</strong> <span style={{ color: C.soft }}>· {plural(p.count, "duty", "duties")}</span></div>
                <select aria-label={`Post ${p.name}`} style={{ ...input, flex: "1 1 180px" }} value={choices.posts[p.key]} onChange={(e) => setPost(p.key, e.target.value)}>
                  <option value="new">Create this post</option>
                  {(data.posts || []).length > 0 && (
                    <optgroup label="Same as my post">
                      {data.posts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </optgroup>
                  )}
                  <option value="skip">Leave the post out</option>
                </select>
              </div>
            ))}
          </Section>
        )}

        {plan.leave.length > 0 && (
          <Section title="Leave" note="Added as leave periods, as in the Leave tab">
            {plan.leave.slice(0, 12).map((lv, i) => (
              <div key={i} style={{ fontSize: 13, color: C.ink }}>
                <strong>{plan.people[lv.index].name}</strong> · {lv.label || (LEAVE_STYLES[lv.type] || {}).label || lv.type} · {nice(lv.start)}{lv.end !== lv.start ? ` – ${nice(lv.end)}` : ""}
              </div>
            ))}
            {plan.leave.length > 12 && <div style={{ fontSize: 12, color: C.soft }}>…and {plan.leave.length - 12} more</div>}
          </Section>
        )}

        {plan.unclear.length > 0 && (
          <Section title={`${plural(plan.unclear.length, "cell")} I couldn't read`} note="These days will be left as they are">
            {plan.unclear.slice(0, 8).map((u, i) => (
              <div key={i} style={{ fontSize: 12.5, color: C.ink }}>{plan.people[u.index].name} · {nice(u.date)} · <em>"{u.text}"</em></div>
            ))}
            {plan.unclear.length > 8 && <div style={{ fontSize: 12, color: C.soft }}>…and {plan.unclear.length - 8} more</div>}
          </Section>
        )}

        {needsMode && (
          <Section title="These dates already have duties">
            <div style={{ fontSize: 12.5, color: C.soft }}>
              {plural(plan.existing, "day")} for the staff above already {plan.existing === 1 ? "has" : "have"} a duty between {nice(plan.from)} and {nice(plan.to)}. Choose one:
            </div>
            {[
              ["replace", "Replace", `Where the file has a duty, it replaces what's there (up to ${plural(plan.existing, "duty", "duties")}). Days the file leaves blank are not touched.`],
              ["fill", "Only fill empty days", "Keep every duty already in the rota. The file only fills days that are empty."],
            ].map(([k, label, sub]) => (
              <label key={k} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", fontSize: 13, color: C.ink }}>
                <input type="radio" name="import-mode" checked={choices.mode === k} onChange={() => setChoices((c) => ({ ...c, mode: k }))} style={{ marginTop: 3 }} />
                <span><strong>{label}</strong><br /><span style={{ fontSize: 12, color: C.soft }}>{sub}</span></span>
              </label>
            ))}
          </Section>
        )}

        <Section title="Staff details">
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", fontSize: 13, color: C.ink }}>
            <input type="checkbox" checked={!!choices.staffDetails} onChange={(e) => setChoices((c) => ({ ...c, staffDetails: e.target.checked }))} style={{ marginTop: 3 }} />
            <span>Fill in blank details from the file (designation, contact, Employee ID, employment dates). Details you've already entered are never changed.</span>
          </label>
          {hasEmails && (
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", fontSize: 13, color: C.ink }}>
              <input type="checkbox" checked={!!choices.emails} onChange={(e) => setChoices((c) => ({ ...c, emails: e.target.checked }))} style={{ marginTop: 3 }} />
              <span>Also copy email addresses<br /><span style={{ fontSize: 12, color: C.soft }}>An email on a staff row links that person's Easy Duty Rota login to their duties. Only tick this if you're sure the emails are right.</span></span>
            </label>
          )}
        </Section>
      </div>
    );
  })();

  /* ── Done ── */
  const doneBody = report && (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ background: C.okBg, color: C.okInk, borderRadius: 12, padding: 12, display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5 }}>
        <Check size={18} style={{ flexShrink: 0 }} />
        <div>
          <strong>Added to the rota.</strong> {plural(report.duties, "duty", "duties")} and days off
          {report.breaks ? `, ${plural(report.breaks, "break")}` : ""}
          {report.leavePeriods ? `, ${plural(report.leavePeriods, "leave period")}` : ""}
          {" "}for {plural(report.staffMatched + report.staffAdded, "person", "people")}
          {report.staffAdded ? ` (${report.staffAdded} new)` : ""}.
          {report.codesAdded ? ` ${plural(report.codesAdded, "new code")}.` : ""}
          {report.postsAdded ? ` ${plural(report.postsAdded, "new post")}.` : ""}
        </div>
      </div>
      {report.overwritten > 0 && <div style={{ fontSize: 12.5, color: C.soft }}>{plural(report.overwritten, "existing duty", "existing duties")} replaced.</div>}
      {report.keptExisting > 0 && <div style={{ fontSize: 12.5, color: C.soft }}>{plural(report.keptExisting, "day")} kept as they were, because they already had a duty.</div>}
      {report.leaveSkipped > 0 && <div style={{ fontSize: 12.5, color: C.soft }}>{plural(report.leaveSkipped, "leave period")} not added: the person already has leave on those dates.</div>}
      {report.eveningOn && <div style={{ fontSize: 12.5, color: C.soft }}>Evening shift switched on, so Evening duties are counted.</div>}
      {report.hoursAdded.length > 0 && <div style={{ fontSize: 12.5, color: C.soft }}>Hours added to {report.hoursAdded.join(", ")}.</div>}
      {report.nonOfficialAdded > 0 && <div style={{ fontSize: 12.5, color: C.soft }}>{plural(report.nonOfficialAdded, "day")} marked non-official, as in the file.</div>}
      {report.staffOverLimit.length > 0 && <Amber>Not added because of your plan's staff limit: {report.staffOverLimit.join(", ")}.</Amber>}
      <div style={{ fontSize: 12.5, color: C.soft }}>Changed your mind? Press <strong>Undo</strong> at the top — it takes the whole import back in one step.</div>
    </div>
  );

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Import a roster"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(14,58,71,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: "min(680px, 100%)", maxHeight: "calc(100vh - 24px)", display: "flex", flexDirection: "column", boxShadow: "0 20px 50px rgba(14,58,71,0.25)", fontFamily: "Inter, system-ui, sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", borderBottom: `1px solid ${C.line}` }}>
          <Upload size={17} color={C.lagoon} />
          <div style={{ flex: 1, fontWeight: 800, fontSize: 15.5, color: C.ink }}>Import a roster</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: C.soft, padding: 4 }}><X size={18} /></button>
        </div>
        <div style={{ padding: 16, overflowY: "auto" }}>
          {step === "pick" && pickBody}
          {step === "preview" && previewBody}
          {step === "done" && doneBody}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderTop: `1px solid ${C.line}`, flexWrap: "wrap" }}>
          {step === "preview" && (
            <>
              <div style={{ flex: "1 1 220px", fontSize: 11.5, color: C.soft }}>
                {needsMode && !choices.mode ? "Choose Replace or Only fill empty days first." : "Nothing is saved until you press Add to rota. Undo takes it all back."}
              </div>
              <button type="button" style={btn(false)} onClick={() => { setStep("pick"); setPlan(null); setGrid(null); setChoices(null); }}>Choose another file</button>
              <button type="button" style={btn(true, !canAdd)} disabled={!canAdd} onClick={add}><Check size={15} /> Add to rota</button>
            </>
          )}
          {step !== "preview" && (
            <>
              <div style={{ flex: 1 }} />
              <button type="button" style={btn(step === "done")} onClick={onClose}>{step === "done" ? "Done" : "Cancel"}</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
