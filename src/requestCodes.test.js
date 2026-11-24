/* A duty request that names an exact code (M(R) rather than plain M) gets
   that code in a generated rota; one that names none is written exactly as
   before. */
import { toRotaCells } from "./rosterEngine";
import { requestedCodesFor } from "./rosterConfig";

const codes = [
  { id: "M", code: "M", counts: "morning" },
  { id: "MR", code: "M(R)", counts: "morning" },
  { id: "N", code: "N", counts: "night" },
  { id: "OFF", code: "OFF", counts: "off" },
  { id: "OFFR", code: "OFF(R)", counts: "off" },
];

test("requests naming a code become a map of that code's text", () => {
  expect(requestedCodesFor([
    { staffId: "a", date: "2026-12-01", category: "morning", codeId: "MR" },
    { staffId: "b", date: "2026-12-01", category: "morning" },
    { staffId: "c", date: "2026-12-01", category: "off", codeId: "gone" },
  ], codes)).toEqual({ "a|2026-12-01": "M(R)" });
});

test("the requested code is written when the day got that duty", () => {
  const cells = { "a|2026-12-01": "morning", "b|2026-12-01": "morning", "c|2026-12-01": "off" };
  const out = toRotaCells(cells, codes, [], {}, { "a|2026-12-01": "M(R)", "c|2026-12-01": "OFF(R)" });
  expect(out).toEqual({ "a|2026-12-01": "M(R)", "b|2026-12-01": "M", "c|2026-12-01": "OFF(R)" });
});

test("a requested code that doesn't match the duty given is ignored", () => {
  const out = toRotaCells({ "a|2026-12-01": "night" }, codes, [], {}, { "a|2026-12-01": "M(R)" });
  expect(out).toEqual({ "a|2026-12-01": "N" });
});

test("no requested codes: exactly as before", () => {
  const cells = { "a|2026-12-01": "morning", "a|2026-12-02": "off" };
  expect(toRotaCells(cells, codes, [], {})).toEqual(toRotaCells(cells, codes, [], {}, {}));
});
