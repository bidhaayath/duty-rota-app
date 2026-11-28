/* ─────────────── What a lapsing account has built ───────────────
   The plan banners say what is at stake in the customer's own terms:
   "Your rota has 24 staff and 3 months of duties." It reads only the
   departments this account owns and the newest rota in each (ordered by
   version, then created_at, like every other rota lookup). READ-ONLY:
   nothing here writes to the database.                                    */
import { useEffect, useState } from "react";
import supabase from "./supabaseClient";
import { entriesOf } from "./rotaCounts";

/* rotas: a list of rota_data objects. Months count only months that hold at
   least one duty, so a blank month someone clicked past doesn't count. */
export function rotaSummary(rotas) {
  let staff = 0;
  const months = new Set();
  let depts = 0;
  for (const data of rotas || []) {
    if (!data) continue;
    depts += 1;
    staff += Array.isArray(data.staff) ? data.staff.length : 0;
    const cells = data.cells || {};
    for (const date of Object.keys(cells)) {
      const row = cells[date] || {};
      if (Object.values(row).some((raw) => entriesOf(raw).length > 0)) months.add(date.slice(0, 7));
    }
  }
  return { depts, staff, months: months.size };
}

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const staffWord = (n) => (n === 1 ? "1 staff member" : `${n} staff`);

/* The sentence, or null when there is nothing worth saying yet. */
export function summaryLine({ depts, staff, months }) {
  if (!staff) return null;
  const what = months
    ? `${staffWord(staff)} and ${plural(months, "month")} of duties`
    : staffWord(staff);
  return depts > 1 ? `Your ${depts} rotas hold ${what}.` : `Your rota has ${what}.`;
}

export function useMyRotaSummary(userId, enabled) {
  const [line, setLine] = useState(null);
  useEffect(() => {
    if (!enabled || !userId) { setLine(null); return undefined; }
    let off = false;
    (async () => {
      try {
        const { data: deps } = await supabase.from("departments").select("id").eq("owner_user_id", userId);
        const ids = (deps || []).map((d) => d.id);
        if (!ids.length) return;
        const { data: rows } = await supabase.from("rotas")
          .select("department_id, rota_data, version, created_at")
          .in("department_id", ids)
          .order("version", { ascending: false })
          .order("created_at", { ascending: true });
        const newest = new Map();
        for (const r of rows || []) if (!newest.has(r.department_id)) newest.set(r.department_id, r.rota_data);
        if (!off) setLine(summaryLine(rotaSummary([...newest.values()])));
      } catch { /* the banner simply goes without the line */ }
    })();
    return () => { off = true; };
  }, [userId, enabled]);
  return line;
}

/* WhatsApp links for the banners and Your account. */
const WA = "9607666261";
export const waLink = (text) => `https://wa.me/${WA}?text=${encodeURIComponent(text)}`;
export const QUESTION_MSG = "Hello, I have a question about Easy Duty Rota.";
export const SAMPLE_MSG =
  "Hello, please build a sample roster for us on Easy Duty Rota.\n\n" +
  "Organisation / department: \nAbout how many staff: \nShifts we use (e.g. M, A, N): \n" +
  "You can also send a photo of a current roster.";
