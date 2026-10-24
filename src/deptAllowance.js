/* Which departments are this person's, for the department allowance — and
   whether they act as an owner in the department on screen.

   The departments list holds every department the person can see: their
   organisation's, and any shared with them from another one. The server
   counts only the first kind. department_limit() is checked against
   org_department_count(), which counts departments whose organisation_id is
   my_org_id(). This module mirrors that exactly, so a department a manager
   created inside my organisation counts against my allowance, and a
   department shared with me from elsewhere never does.

   The browser's count is a PREDICTION. The departments INSERT policy
   enforces the limit, and if the two ever disagree the server wins — the
   app reports the refusal rather than trusting this.

   The positional lock (oldest N editable, the rest view-only) is this app's
   alone; the server's can_edit_department() knows nothing of it.

   myOrgId has three states:
     undefined — my_org_id() did not answer. Nothing is locked, no add is
                 predicted (the server decides), Delete is not offered.
     null      — answered: this person belongs to no organisation.
     a uuid    — answered.                                                */

// Every row that enters the departments list goes through this, so
// ownerIsMe is never missing. It is how my_departments() works out
// is_owner (owner_user_id = auth.uid()), and it is what the departments
// DELETE policy checks — so it decides grouping and who may delete.
export function tagDept(dept, userId) {
  return { ...dept, ownerIsMe: userId != null && dept.owner_user_id === userId };
}

export const ownedByMe = (d) => !!d && d.ownerIsMe === true;

const sameName = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();

/* Whether a department is shown as the person's own — the "My Organisation"
   group, and who is told only the owner can upgrade. That is: it is in my
   organisation AND I own that organisation. Not the allowance's test,
   which counts my organisation whatever my role in it, because a manager
   would then see the inviting organisation's departments as their own.
   Not ownerIsMe alone either, which would put a department a manager made
   inside my organisation under "shared with you", though I pay for it.

   accountRole is my_role(); it is only trusted once it has answered, and
   a null role (no membership row) cannot own an organisation through one.
   Until both it and my_org_id() have answered, owner_user_id stands in. */
const showsAsMineTest = (myOrgId, accountRole, accountRoleKnown) => {
  if (!accountRoleKnown || accountRole == null || myOrgId == null) return ownedByMe;
  if (accountRole !== "owner") return () => false;
  return (d) => !!d && d.organisation_id === myOrgId;
};

export function deptAllowance({ departments, myOrgId, limit, accountRole = null, accountRoleKnown = false }) {
  const list = departments || [];
  const known = myOrgId !== undefined;
  const showsAsMine = showsAsMineTest(myOrgId, accountRole, accountRoleKnown);

  // Mirrors org_department_count(). The null guard matters: no department
  // has a null organisation_id today, but null === null would make every
  // such row "mine" for someone with no organisation.
  const inMyOrg = (d) => myOrgId != null && d.organisation_id === myOrgId;
  const mine = list.filter(inMyOrg);

  /* For names and for keeping at least one department: my organisation's
     departments when I have one, otherwise the ones I created. The unique
     index is on owner_user_id + name, so a clash this misses is still
     caught by the database and reported as a duplicate name. */
  const own = myOrgId != null ? mine : list.filter(ownedByMe);

  return {
    known,
    mine,
    isMine: (id) => mine.some((d) => d.id === id),
    showsAsMine,

    // Oldest-first (the list arrives ordered by created_at, new ones are
    // appended), so deleting an editable one promotes the next in line. A
    // department outside my organisation is governed by its own owner's
    // plan, which deptPerms.can_edit already reflects.
    isLocked: (id) => {
      if (!known || limit == null || id == null) return false;
      const at = mine.findIndex((d) => d.id === id);
      return at !== -1 && at >= limit;
    },

    // true / false, or null when there is nothing to predict from.
    addPrediction: !known ? null : (limit == null || mine.length < limit),

    // Only a department I created (the DELETE policy refuses any other), and
    // never the last of my own.
    canDelete: (id) => {
      if (!known) return false;
      const d = list.find((x) => x.id === id);
      return ownedByMe(d) && own.some((x) => x.id !== id);
    },

    // exceptId leaves out the department being renamed.
    nameTaken: (name, exceptId = null) => own.some((d) => d.id !== exceptId && sameName(d.name, name)),

    nextName: `Department ${own.length + 1}`,
  };
}

/* Whether this person acts as an owner in the department on screen. An
   UNKNOWN role is not an owner: this gates adding and deleting departments
   and granting manager access, so it fails closed.

   deptRole is my_departments()' role for this department, when it has
   answered. Otherwise accountRole from my_role() is used — but only once
   that has answered (accountRoleKnown), because a failed my_role() and a
   real null look the same. A real null means no membership row: accounts
   from before invites existed, who own their account outright. */
export function ownerLevel({ deptRole, accountRole, accountRoleKnown }) {
  if (typeof deptRole === "string" && deptRole) return { known: true, isOwner: deptRole === "owner" };
  if (accountRoleKnown) return { known: true, isOwner: accountRole == null || accountRole === "owner" };
  return { known: false, isOwner: false };
}
