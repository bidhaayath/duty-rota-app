/* ─────────────── Duty Requests tab ───────────────
   Where requests for a particular duty on a particular date are recorded,
   and where the manager approves the ones the auto-roster must honour.

   Approving is deliberately a separate step from recording. A request that
   is written down but not approved is just a note; only an approved one is
   treated by the generator as a rule it cannot break. That keeps the
   manager in charge of what the automation is allowed to promise.

   Because an approved request outranks every other rule, it is also the
   easiest way to make a week impossible without meaning to. So this page
   does the arithmetic where the decision is made: which dates would be left
   short, and which individual requests cannot be honoured at all. Finding
   that out here takes a second; finding it out in a generated week means
   coming back and starting again.

   Requests live inside the rota's own data, alongside notes and exchange
   marks, so no new database table or security rule is needed.

   Each record carries who entered it and its approval state. When employee
   logins arrive, staff entering their own requests becomes a second way to
   create the same record rather than a redesign — an employee-created
   request simply arrives with approved: false and enteredBy: "staff".    */

import React, { useState, useMemo } from "react";
import { Plus, Trash2, Check, X, CalendarRange, AlertTriangle, Pencil } from "lucide-react";
import { SHIFTS } from "./rosterEngine";

// The duty categories a person can ask for. Leave types are deliberately
// absent: sick leave is recorded when it happens, not requested in advance.
const REQUESTABLE = [
  ["morning", "Morning duty"],
  ["afternoon", "Afternoon duty"],
  ["evening", "Evening duty"],
  ["night", "Night duty"],
  ["off", "Off day"],
];
const SHIFT_LABELS = { morning: "morning", afternoon: "afternoon", evening: "evening", night: "night" };

/* A request can also name the exact code — M(R) rather than plain M — so a
   rota built by Smart Roster or Ini writes the code the manager uses for
   requests, and nobody has to change it by hand afterwards. Stored as
   codeId beside the category; the category (from the code's "Counts as")
   is still what every rule and check reads. A request without a codeId
   behaves exactly as before. In the picker a code is "code:<id>". */
const CODE_PREFIX = "code:";

export default function RequestsTab({
  data, update, staffEditable, T, Card, Btn, Field, inputStyle, th, td, uid, dstr,
}) {
  // Held in a useMemo so the empty case does not hand back a brand-new []
  // on every render. Without that, the two useMemos below see their
  // dependency change each time and recalculate for nothing.
  const requests = useMemo(() => data.dutyRequests || [], [data.dutyRequests]);
  const [form, setForm] = useState({ staffId: "", date: "", category: "off", codeId: "" });
  const codeById = useMemo(() => {
    const m = {};
    (data.codes || []).forEach((c) => { m[c.id] = c; });
    return m;
  }, [data.codes]);
  // Codes that can be asked for, grouped under what they count as.
  const codesFor = (cat) => (data.codes || []).filter((c) => c.counts === cat);
  const [showPast, setShowPast] = useState(false);
  /* Editing: the form above holds the request being changed. Its approval,
     who entered it and when are kept; only person, date and duty change. */
  const [editingId, setEditingId] = useState(null);
  const blankForm = { staffId: "", date: "", category: "off", codeId: "" };
  const startEdit = (r) => {
    setEditingId(r.id);
    setForm({ staffId: r.staffId, date: r.date, category: r.category, codeId: r.codeId && codeById[r.codeId] ? r.codeId : "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const cancelEdit = () => { setEditingId(null); setForm(blankForm); };

  const today = dstr(new Date());
  const staffById = useMemo(() => {
    const m = {};
    (data.staff || []).forEach((s) => { m[s.id] = s; });
    return m;
  }, [data.staff]);

  const activeStaff = useMemo(() => (data.staff || []).filter((s) => !s.former), [data.staff]);

  /* The Smart Roster settings, read only. This page never changes them — it
     just needs to know what the ward runs and who is available, so it can
     tell the manager whether a request is one the generator will actually
     be able to keep. */
  const rules = data.rosterRules || {};
  const coverage = rules.coverage || null;
  const skipStaff = useMemo(() => rules.skipStaff || [], [rules.skipStaff]);
  const staffShifts = rules.staffShifts || {};
  const seniorStaff = useMemo(() => rules.seniorStaff || [], [rules.seniorStaff]);
  const seniorCover = rules.seniorCover || {};
  const termOne = (rules.seniorTerm || "Senior").trim() || "Senior";
  const termLower = termOne.toLowerCase();

  const wardRuns = (sh) => !coverage || (coverage[sh]?.min || 0) > 0 || (coverage[sh]?.max || 0) > 0;
  const dailyMin = coverage ? SHIFTS.reduce((n, sh) => n + (coverage[sh]?.min || 0), 0) : null;
  const seniorPerDay = coverage
    ? SHIFTS.reduce((n, sh) => n + ((coverage[sh]?.min || 0) > 0 ? (seniorCover[sh] || 0) : 0), 0)
    : 0;
  const onLeave = (s, date) =>
    (s?.leavePeriods || []).some((lp) => date >= lp.start && date <= lp.end);

  // update() takes a function that receives a copy of the rota data and
  // returns it changed — it does not take an object. It also enforces the
  // paywall and department locks, which is why requests go through it
  // rather than writing to the data directly.
  const setRequests = (next) => update((d) => { d.dutyRequests = next; return d; });

  /* What stands in the way of this particular request being honoured.
     Everything here is something the generator will do quietly and without
     complaint — which is exactly why it is worth saying out loud. */
  const issuesFor = (r) => {
    const who = staffById[r.staffId];
    if (!who) return [];
    const out = [];
    if (skipStaff.includes(r.staffId)) {
      out.push("skipped in Smart Roster, so the generator will not touch this week for them");
    }
    if (onLeave(who, r.date)) {
      out.push("on recorded leave that day — leave is left alone, so this cannot be honoured");
    }
    if (r.category !== "off" && !wardRuns(r.category)) {
      out.push(`the ward does not run ${SHIFT_LABELS[r.category]} shifts`);
    }
    const only = staffShifts[r.staffId];
    if (r.category !== "off" && only?.length && !only.includes(r.category)) {
      out.push(`only set up for ${only.map((x) => SHIFT_LABELS[x]).join(" and ")} duties`);
    }
    return out;
  };

  const add = () => {
    if (!form.staffId) { window.alert("Choose which staff member the request is for."); return; }
    if (!form.date) { window.alert("Choose the date being requested."); return; }
    // The same person asking for two different duties on one date cannot
    // both be honoured, so catch it here rather than letting the generator
    // silently drop one.
    const clash = requests.find((r) => r.id !== editingId && r.staffId === form.staffId && r.date === form.date);
    if (clash) {
      const who = staffById[form.staffId]?.name || "This staff member";
      window.alert(`${who} already has a request for ${form.date}.\n\nEdit or delete that one instead.`);
      return;
    }
    /* Recorded anyway if the manager wants it — a request is also a record
       of what was asked for. But not silently: a request that cannot be
       kept is worth knowing about now. */
    const trouble = issuesFor(form);
    if (trouble.length) {
      const who = staffById[form.staffId]?.name || "This staff member";
      if (!window.confirm(
        `${who}: ${trouble.join("; ")}.\n\n` +
        `The request can still be recorded, but approving it will not change the rota.\n\n${editingId ? "Save" : "Add"} it anyway?`
      )) return;
    }
    if (editingId) {
      setRequests(requests.map((r) => {
        if (r.id !== editingId) return r;
        const next = { ...r, staffId: form.staffId, date: form.date, category: form.category };
        if (form.codeId && codeById[form.codeId]) next.codeId = form.codeId; else delete next.codeId;
        return next;
      }));
      cancelEdit();
      return;
    }
    setRequests([
      ...requests,
      {
        id: uid(),
        staffId: form.staffId,
        date: form.date,
        category: form.category,
        ...(form.codeId && codeById[form.codeId] ? { codeId: form.codeId } : {}),
        approved: false,
        enteredBy: "manager",   // employee logins will use "staff" here
        enteredOn: today,
      },
    ]);
    setForm({ staffId: "", date: "", category: "off", codeId: "" });
  };

  const toggleApproved = (id) =>
    setRequests(requests.map((r) => (r.id === id ? { ...r, approved: !r.approved } : r)));

  const remove = (id) => {
    const r = requests.find((x) => x.id === id);
    const who = staffById[r?.staffId]?.name || "this staff member";
    if (!window.confirm(`Delete the request for ${who} on ${r?.date}?`)) return;
    setRequests(requests.filter((x) => x.id !== id));
    if (id === editingId) cancelEdit();
  };

  // Upcoming first, because those are the ones that still matter. Past
  // requests are hidden by default rather than deleted — they are a record
  // of what was asked for and agreed.
  const visible = useMemo(() => {
    const rows = showPast ? requests : requests.filter((r) => r.date >= today);
    return [...rows].sort((a, b) => a.date.localeCompare(b.date) ||
      (staffById[a.staffId]?.name || "").localeCompare(staffById[b.staffId]?.name || ""));
  }, [requests, showPast, today, staffById]);

  const pastCount = requests.filter((r) => r.date < today).length;
  const approvedUpcoming = requests.filter((r) => r.approved && r.date >= today).length;

  /* ── Which dates the approvals have made impossible ──
     This used to guess: half the ward asking for the same day looked
     alarming. Half the ward asking for a day the ward barely needs staffing
     is fine, and three people asking for a day that needs five is not — so
     it now does the arithmetic the generator does.

     Free staff, against duties still to cover after the requests themselves
     are counted. If the second number is bigger, that date cannot be
     staffed, and the generator will refuse the whole week over it.       */
  const strained = useMemo(() => {
    if (!coverage || dailyMin === 0) return [];
    const rostered = activeStaff.filter((s) => !skipStaff.includes(s.id));
    const byDate = {};
    requests.filter((r) => r.approved && r.date >= today)
      .forEach((r) => { (byDate[r.date] = byDate[r.date] || []).push(r); });

    return Object.entries(byDate).map(([date, reqs]) => {
      const present = rostered.filter((s) => !onLeave(s, date));
      const held = reqs.filter((r) => present.some((s) => s.id === r.staffId));
      const onDuty = held.filter((r) => r.category !== "off").length;
      const free = present.length - held.length;
      const stillNeeded = Math.max(0, dailyMin - onDuty);

      const leaders = present.filter((s) => seniorStaff.includes(s.id)).length;
      const leadersOff = held.filter((r) => r.category === "off" && seniorStaff.includes(r.staffId)).length;
      const leadersLeft = leaders - leadersOff;

      const lines = [];
      if (stillNeeded > free) {
        lines.push(
          `${held.length} approved request${held.length === 1 ? "" : "s"} leave ${free} staff free, ` +
          `but ${stillNeeded} more ${stillNeeded === 1 ? "is" : "are"} needed to cover the day. ` +
          `The whole week will be refused until one is un-approved.`
        );
      }
      if (seniorPerDay > 0 && leadersLeft < seniorPerDay) {
        lines.push(
          `only ${leadersLeft} ${leadersLeft === 1 ? termLower : `${termLower}s`} would be free, ` +
          `and ${seniorPerDay} ${seniorPerDay === 1 ? "is" : "are"} needed that day.`
        );
      }
      return { date, lines };
    }).filter((x) => x.lines.length).sort((a, b) => a.date.localeCompare(b.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, today, activeStaff, staffById, coverage, dailyMin, skipStaff, seniorStaff, seniorPerDay, termLower]);

  const catLabel = (c) => REQUESTABLE.find(([id]) => id === c)?.[1] || c;
  // "M(R) — Morning request", or the plain category when no code was named
  // (or the named code has since been deleted).
  const requestLabel = (r) => {
    const c = r.codeId && codeById[r.codeId];
    return c ? `${c.code} — ${c.label || catLabel(r.category)}` : catLabel(r.category);
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card>
        <h2 style={{ fontFamily: "'Plus Jakarta Sans', Inter, sans-serif", fontSize: 17, margin: "0 0 4px" }}>Duty requests</h2>
        <p style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.6, margin: "0 0 16px" }}>
          Record what staff have asked for, then tick <strong>Approved</strong> on the ones you agree to.
          Only approved requests are honoured when a rota is generated automatically — the rest are
          kept here as a note. An approved request outranks every other rule, so anything that would
          make a day impossible is flagged below.
        </p>

        {!staffEditable && (
          <div style={{ background: "#FBEAE7", border: "1px solid #F1B8AE", borderRadius: 10, padding: "10px 12px", fontSize: 13, color: "#8A2E1E", marginBottom: 14 }}>
            Editing is paused on this plan, so requests cannot be changed.
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, alignItems: "end" }}>
          <Field label="Staff member">
            <select
              value={form.staffId}
              onChange={(e) => setForm({ ...form, staffId: e.target.value })}
              disabled={!staffEditable}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              <option value="">Choose…</option>
              {activeStaff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>

          <Field label="Requested date">
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              disabled={!staffEditable}
              style={inputStyle}
            />
          </Field>

          <Field label="Requested duty">
            <select
              value={form.codeId ? CODE_PREFIX + form.codeId : form.category}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith(CODE_PREFIX)) {
                  const c = codeById[v.slice(CODE_PREFIX.length)];
                  if (c) setForm({ ...form, category: c.counts, codeId: c.id });
                } else setForm({ ...form, category: v, codeId: "" });
              }}
              disabled={!staffEditable}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              {REQUESTABLE.map(([id, label]) => {
                const note = id !== "off" && !wardRuns(id) ? " — not run here" : "";
                const list = codesFor(id);
                return (
                  <optgroup key={id} label={label + note}>
                    <option value={id}>Any {label.toLowerCase()}</option>
                    {list.map((c) => (
                      <option key={c.id} value={CODE_PREFIX + c.id}>{c.code}{c.label && c.label !== c.code ? ` — ${c.label}` : ""}</option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </Field>

          {editingId ? (
            <div style={{ display: "flex", gap: 8 }}>
              <Btn onClick={add} disabled={!staffEditable} style={{ justifyContent: "center", flex: 1 }}>
                <Check size={15} /> Save changes
              </Btn>
              <Btn kind="ghost" onClick={cancelEdit}>Cancel</Btn>
            </div>
          ) : (
            <Btn onClick={add} disabled={!staffEditable} style={{ justifyContent: "center" }}>
              <Plus size={15} /> Add request
            </Btn>
          )}
        </div>

        {!activeStaff.length && (
          <p style={{ fontSize: 12.5, color: T.inkSoft, margin: "12px 0 0" }}>
            Add staff members first, on the Staff tab.
          </p>
        )}
      </Card>

      {strained.length > 0 && (
        <Card style={{ background: "#FBF1DC", borderColor: "#E7D9B8" }}>
          <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
            <AlertTriangle size={15} color="#8A5A0F" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 13, color: "#8A5A0F", lineHeight: 1.7, minWidth: 0 }}>
              <strong>
                {strained.length === 1 ? "One date cannot be staffed" : `${strained.length} dates cannot be staffed`}{" "}
                with the requests approved:
              </strong>
              <ul style={{ margin: "5px 0 0", paddingLeft: 17 }}>
                {strained.map((x) => (
                  <li key={x.date} style={{ marginBottom: 3 }}>
                    <strong>{x.date}</strong> — {x.lines.join(" Also, ")}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <Card style={{ padding: 0, overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "14px 18px", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: T.inkSoft }}>
            {approvedUpcoming} approved upcoming · {visible.length} shown
          </span>
          {pastCount > 0 && (
            <Btn kind="ghost" small onClick={() => setShowPast(!showPast)}>
              <CalendarRange size={14} />
              {showPast ? "Hide past requests" : `Show ${pastCount} past request${pastCount === 1 ? "" : "s"}`}
            </Btn>
          )}
        </div>

        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620 }}>
          <thead>
            <tr>
              <th style={th}>Entered</th>
              <th style={th}>Staff</th>
              <th style={th}>Requested date</th>
              <th style={th}>Requested duty</th>
              <th style={{ ...th, textAlign: "center" }}>Approved</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {!visible.length && (
              <tr>
                <td style={{ ...td, color: T.inkSoft, whiteSpace: "normal" }} colSpan={6}>
                  No requests yet. Add one above when a staff member asks for a particular duty.
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const past = r.date < today;
              const who = staffById[r.staffId];
              const trouble = past ? [] : issuesFor(r);
              return (
                <tr key={r.id} style={{ opacity: past ? 0.55 : 1 }}>
                  <td style={{ ...td, color: T.inkSoft, fontSize: 12 }}>{r.enteredOn || "—"}</td>
                  <td style={{ ...td, fontWeight: 600 }}>
                    {who?.name || <span style={{ color: T.coral }}>Staff member removed</span>}
                  </td>
                  <td style={td}>{r.date}</td>
                  <td style={{ ...td, whiteSpace: "normal" }}>
                    {requestLabel(r)}
                    {/* Said on the row rather than only in a banner, because
                        this is the row the manager is about to tick. */}
                    {trouble.length > 0 && (
                      <div style={{ fontSize: 11.5, color: "#8A5A0F", lineHeight: 1.5, marginTop: 3 }}>
                        {trouble.map((t, i) => (
                          <div key={i} style={{ display: "flex", gap: 5, alignItems: "flex-start" }}>
                            <AlertTriangle size={11} color="#8A5A0F" style={{ flexShrink: 0, marginTop: 3 }} />
                            <span>{t}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <button
                      onClick={() => toggleApproved(r.id)}
                      disabled={!staffEditable}
                      title={
                        trouble.length
                          ? "Approving this will not change the rota — see the note beside it"
                          : r.approved
                            ? "Approved — the generator will honour this"
                            : "Not approved — the generator will ignore this"
                      }
                      style={{
                        border: trouble.length && r.approved ? "1px solid #E7D9B8" : "none",
                        borderRadius: 999, width: 30, height: 30, cursor: staffEditable ? "pointer" : "not-allowed",
                        background: r.approved ? (trouble.length ? "#FBF1DC" : "#D8EEE9") : T.mist,
                        color: r.approved ? (trouble.length ? "#8A5A0F" : T.lagoon) : "#A9BFBB",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      {r.approved ? <Check size={16} strokeWidth={3} /> : <X size={15} strokeWidth={2.5} />}
                    </button>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      <Btn kind="ghost" small onClick={() => startEdit(r)} disabled={!staffEditable} aria-label="Edit request">
                        <Pencil size={13} />
                      </Btn>
                      <Btn kind="danger" small onClick={() => remove(r.id)} disabled={!staffEditable} aria-label="Delete request">
                        <Trash2 size={13} />
                      </Btn>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}