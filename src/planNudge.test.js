jest.mock("./supabaseClient", () => ({ __esModule: true, default: {} }));
import { rotaSummary, summaryLine } from "./planNudge";

const rota = (staff, cells) => ({ staff: Array.from({ length: staff }, (_, i) => ({ id: "s" + i })), cells });

test("counts staff and months that hold duties, both cell shapes", () => {
  const s = rotaSummary([
    rota(3, { "2026-10-01": { s0: "M" }, "2026-11-02": { s1: [{ code: "N", post: "ICU" }] }, "2026-12-01": { s0: "" } }),
    rota(2, { "2026-11-05": { s0: "A" } }),
  ]);
  expect(s).toEqual({ depts: 2, staff: 5, months: 2 });
});

test("sentence wording", () => {
  expect(summaryLine({ depts: 1, staff: 24, months: 3 })).toBe("Your rota has 24 staff and 3 months of duties.");
  expect(summaryLine({ depts: 3, staff: 52, months: 1 })).toBe("Your 3 rotas hold 52 staff and 1 month of duties.");
  expect(summaryLine({ depts: 1, staff: 1, months: 0 })).toBe("Your rota has 1 staff member.");
  expect(summaryLine({ depts: 1, staff: 0, months: 0 })).toBeNull();
  expect(rotaSummary(null)).toEqual({ depts: 0, staff: 0, months: 0 });
});
