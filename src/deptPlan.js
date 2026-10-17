/* Whose plan applies to the department on screen.

   Billing follows the department's owner, not the viewer. A manager invited
   into another organisation's department is covered by that owner's plan
   there — for better or worse: a Basic manager in a Plus department gets
   Smart Roster, and a Plus manager in a Basic department does not.

   The answer comes from department_plan(p_dept) in the database. Until it
   arrives, or if it fails or says ok:false, everything falls back to the
   viewer's own plan from my_subscription — exactly how the app behaved
   before this existed.

   The department allowance is deliberately NOT here. It limits the
   departments a person owns, so it stays on their own plan.            */

// Only a successful answer for THIS department counts. A late reply for
// the department just left must never decide the one now on screen.
export function usableDeptPlan(deptPlan, deptId) {
  if (!deptPlan || deptId == null) return null;
  if (deptPlan.deptId !== deptId || !deptPlan.ok) return null;
  return deptPlan;
}

// Still waiting for department_plan to answer for this department. A
// failed answer is stored as { deptId, ok: false }, so it ends the wait
// (and falls back to the viewer's plan) rather than loading for ever.
export function deptPlanLoading(deptPlan, deptId) {
  if (deptId == null) return false;
  return !deptPlan || deptPlan.deptId !== deptId;
}

/* viewer: { features, staffLimit } from my_subscription. features may be
   null, which means "grant everything" (the subscription check failed open).
   Returns the features and staff limit to use in this department. */
export function effectivePlan(viewer, deptPlan, deptId) {
  const plan = usableDeptPlan(deptPlan, deptId);
  const viewerFeatures = viewer ? viewer.features : null;
  const viewerStaffLimit = viewer ? viewer.staffLimit : null;
  if (!plan) return { features: viewerFeatures, staffLimit: viewerStaffLimit };

  const f = plan.features || {};
  return {
    // Anything department_plan does not answer for keeps the viewer's value.
    features: {
      ...(viewerFeatures || {}),
      smart_roster: f.smart_roster === true,
      company_logo: f.company_logo === true,
      insights: f.insights === true,
    },
    // null is a real answer here: unlimited. Only a missing key falls back.
    staffLimit: "staff_limit" in plan ? plan.staff_limit : viewerStaffLimit,
  };
}
