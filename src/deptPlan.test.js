import { effectivePlan, usableDeptPlan, deptPlanLoading } from "./deptPlan";

const BASIC = {
  features: { smart_roster: false, company_logo: false, insights: true, priority_support: false },
  staffLimit: 20,
};
const PLUS = {
  features: { smart_roster: true, company_logo: true, insights: true, priority_support: false },
  staffLimit: null,
};
const plusDept = (deptId) => ({
  deptId, ok: true, tier: "plus", active: true, staff_limit: null,
  features: { smart_roster: true, company_logo: true, insights: true },
});
const basicDept = (deptId) => ({
  deptId, ok: true, tier: "basic", active: true, staff_limit: 20,
  features: { smart_roster: false, company_logo: false, insights: true },
});

describe("effectivePlan: billing follows the department owner", () => {
  test("a Basic manager in a Plus department gets Smart Roster, the logo and no staff cap", () => {
    const p = effectivePlan(BASIC, plusDept("d1"), "d1");
    expect(p.features.smart_roster).toBe(true);
    expect(p.features.company_logo).toBe(true);
    expect(p.staffLimit).toBeNull();
  });

  test("a Plus manager in a Basic department gets Basic limits there", () => {
    const p = effectivePlan(PLUS, basicDept("d1"), "d1");
    expect(p.features.smart_roster).toBe(false);
    expect(p.features.company_logo).toBe(false);
    expect(p.staffLimit).toBe(20);
  });

  test("features department_plan does not answer for keep the viewer's value", () => {
    const p = effectivePlan(BASIC, plusDept("d1"), "d1");
    expect(p.features.priority_support).toBe(false);
  });

  test("works when the viewer's own check failed open (features null)", () => {
    const p = effectivePlan({ features: null, staffLimit: null }, basicDept("d1"), "d1");
    expect(p.features.smart_roster).toBe(false);
    expect(p.staffLimit).toBe(20);
  });
});

describe("effectivePlan: falls back to the viewer's own plan", () => {
  test.each([
    ["not loaded yet", null, "d1"],
    ["ok:false", { deptId: "d1", ok: false }, "d1"],
    ["an answer for another department", plusDept("d2"), "d1"],
    ["legacy mode, no department", plusDept("d1"), null],
  ])("when the department plan is %s", (_label, deptPlan, deptId) => {
    expect(effectivePlan(BASIC, deptPlan, deptId)).toEqual({
      features: BASIC.features, staffLimit: 20,
    });
  });

  test("a missing staff_limit key keeps the viewer's limit", () => {
    const { staff_limit, ...noLimit } = basicDept("d1");
    expect(effectivePlan(PLUS, noLimit, "d1").staffLimit).toBeNull();
  });
});

describe("deptPlanLoading", () => {
  test("loading until an answer for this department arrives", () => {
    expect(deptPlanLoading(null, "d1")).toBe(true);
    expect(deptPlanLoading(plusDept("d2"), "d1")).toBe(true);
  });
  test("done once answered, even when the answer is a failure", () => {
    expect(deptPlanLoading(plusDept("d1"), "d1")).toBe(false);
    expect(deptPlanLoading({ deptId: "d1", ok: false }, "d1")).toBe(false);
  });
  test("never loading in legacy mode, where there is no department", () => {
    expect(deptPlanLoading(null, null)).toBe(false);
  });
});

test("usableDeptPlan only accepts a successful answer for the current department", () => {
  expect(usableDeptPlan(plusDept("d1"), "d1")).not.toBeNull();
  expect(usableDeptPlan(plusDept("d1"), "d2")).toBeNull();
  expect(usableDeptPlan({ deptId: "d1", ok: false }, "d1")).toBeNull();
});
