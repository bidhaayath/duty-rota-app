import { tagDept, ownedByMe, deptAllowance, ownerLevel } from "./deptAllowance";

const ME = "user-me";
const MY_ORG = "org-mine";
const OTHER_ORG = "org-other";

// Rows as the departments select returns them, oldest first.
const row = (id, org, owner = ME, name = id) =>
  tagDept({ id, name, organisation_id: org, owner_user_id: owner }, ME);

describe("tagDept", () => {
  test("marks the signed-in user's own rows", () => {
    expect(row("a", MY_ORG).ownerIsMe).toBe(true);
    expect(row("a", MY_ORG, "someone-else").ownerIsMe).toBe(false);
  });

  test("an unknown user owns nothing, even a row with no owner", () => {
    expect(tagDept({ id: "a", owner_user_id: null }, null).ownerIsMe).toBe(false);
    expect(ownedByMe(undefined)).toBe(false);
  });
});

describe("what counts as mine", () => {
  test("a department a manager created in my organisation counts", () => {
    const a = deptAllowance({ departments: [row("a", MY_ORG, "a-manager")], myOrgId: MY_ORG, limit: 1 });
    expect(a.isMine("a")).toBe(true);
    expect(a.addPrediction).toBe(false);
  });

  test("a department shared from another organisation does not", () => {
    const a = deptAllowance({ departments: [row("s", OTHER_ORG, "them")], myOrgId: MY_ORG, limit: 1 });
    expect(a.isMine("s")).toBe(false);
    expect(a.addPrediction).toBe(true);
  });

  test("a null organisation never matches a person with no organisation", () => {
    const a = deptAllowance({ departments: [row("a", null)], myOrgId: null, limit: 0 });
    expect(a.mine).toEqual([]);
    expect(a.isLocked("a")).toBe(false);
  });
});

describe("the positional lock", () => {
  test("a shared department ahead of mine does not lock mine", () => {
    const departments = [row("s", OTHER_ORG, "them"), row("a", MY_ORG), row("b", MY_ORG)];
    const a = deptAllowance({ departments, myOrgId: MY_ORG, limit: 2 });
    expect(a.isLocked("a")).toBe(false);
    expect(a.isLocked("b")).toBe(false);
  });

  test("my departments beyond the limit are locked, oldest kept", () => {
    const departments = [row("a", MY_ORG), row("b", MY_ORG), row("c", MY_ORG)];
    const a = deptAllowance({ departments, myOrgId: MY_ORG, limit: 2 });
    expect(["a", "b", "c"].map(a.isLocked)).toEqual([false, false, true]);
  });

  test("a shared department is never locked by my limit", () => {
    const departments = [row("a", MY_ORG), row("s", OTHER_ORG, "them")];
    expect(deptAllowance({ departments, myOrgId: MY_ORG, limit: 0 }).isLocked("s")).toBe(false);
  });

  test("nothing is locked while my_org_id() has not answered", () => {
    const departments = [row("a", MY_ORG), row("b", MY_ORG)];
    const a = deptAllowance({ departments, myOrgId: undefined, limit: 1 });
    expect(a.isLocked("a")).toBe(false);
    expect(a.isLocked("b")).toBe(false);
  });

  test("unlimited, and legacy mode with no department, lock nothing", () => {
    const departments = [row("a", MY_ORG), row("b", MY_ORG)];
    expect(deptAllowance({ departments, myOrgId: MY_ORG, limit: null }).isLocked("b")).toBe(false);
    expect(deptAllowance({ departments, myOrgId: MY_ORG, limit: 1 }).isLocked(null)).toBe(false);
  });
});

describe("adding", () => {
  test("predicts against my organisation's count only", () => {
    const departments = [row("a", MY_ORG), row("s", OTHER_ORG, "them")];
    expect(deptAllowance({ departments, myOrgId: MY_ORG, limit: 2 }).addPrediction).toBe(true);
    expect(deptAllowance({ departments, myOrgId: MY_ORG, limit: 1 }).addPrediction).toBe(false);
    expect(deptAllowance({ departments, myOrgId: MY_ORG, limit: null }).addPrediction).toBe(true);
  });

  test("makes no prediction while my_org_id() has not answered", () => {
    const a = deptAllowance({ departments: [row("a", MY_ORG)], myOrgId: undefined, limit: 1 });
    expect(a.addPrediction).toBeNull();
  });
});

describe("deleting", () => {
  test("needs another of my own left afterwards", () => {
    const one = deptAllowance({ departments: [row("a", MY_ORG), row("s", OTHER_ORG, "them")], myOrgId: MY_ORG });
    expect(one.canDelete("a")).toBe(false);
    const two = deptAllowance({ departments: [row("a", MY_ORG), row("b", MY_ORG)], myOrgId: MY_ORG });
    expect(two.canDelete("a")).toBe(true);
  });

  test("never offers a department I did not create, even in my organisation", () => {
    const departments = [row("a", MY_ORG), row("m", MY_ORG, "a-manager")];
    expect(deptAllowance({ departments, myOrgId: MY_ORG }).canDelete("m")).toBe(false);
  });

  test("never offers a shared department", () => {
    const departments = [row("a", MY_ORG), row("b", MY_ORG), row("s", OTHER_ORG, "them")];
    expect(deptAllowance({ departments, myOrgId: MY_ORG }).canDelete("s")).toBe(false);
  });

  test("is not offered while my_org_id() has not answered", () => {
    const departments = [row("a", MY_ORG), row("b", MY_ORG)];
    expect(deptAllowance({ departments, myOrgId: undefined }).canDelete("a")).toBe(false);
  });

  test("with no organisation, falls back to the ones I created", () => {
    const departments = [row("a", null), row("b", null)];
    expect(deptAllowance({ departments, myOrgId: null }).canDelete("a")).toBe(true);
  });
});

describe("names", () => {
  const departments = [row("a", MY_ORG, ME, "ICU"), row("s", OTHER_ORG, "them", "Ward 2")];

  test("a shared department's name is not taken", () => {
    expect(deptAllowance({ departments, myOrgId: MY_ORG }).nameTaken("Ward 2")).toBe(false);
  });

  test("my organisation's names are compared without regard to case or spaces", () => {
    expect(deptAllowance({ departments, myOrgId: MY_ORG }).nameTaken("  icu ")).toBe(true);
  });

  test("renaming leaves out the department being renamed", () => {
    expect(deptAllowance({ departments, myOrgId: MY_ORG }).nameTaken("ICU", "a")).toBe(false);
  });

  test("the default name counts my departments only", () => {
    expect(deptAllowance({ departments, myOrgId: MY_ORG }).nextName).toBe("Department 2");
  });

  test("before my_org_id() answers, names fall back to the ones I created", () => {
    const a = deptAllowance({ departments, myOrgId: undefined });
    expect(a.nameTaken("ICU")).toBe(true);
    expect(a.nextName).toBe("Department 2");
  });
});

describe("which departments show as mine", () => {
  const departments = [
    row("a", MY_ORG),                     // I made it, in my organisation
    row("m", MY_ORG, "a-manager"),        // a manager made it, in my organisation
    row("s", OTHER_ORG, "them"),          // shared from elsewhere
  ];
  const shows = (opts) => {
    const a = deptAllowance({ departments, myOrgId: MY_ORG, ...opts });
    return departments.filter(a.showsAsMine).map((d) => d.id);
  };

  test("an owner sees everything in her organisation, whoever created it", () => {
    expect(shows({ accountRole: "owner", accountRoleKnown: true })).toEqual(["a", "m"]);
  });

  test("a manager sees nothing of the inviting organisation as theirs", () => {
    const managerView = deptAllowance({
      departments: [row("x", OTHER_ORG, "the-owner"), row("y", OTHER_ORG, "the-owner")],
      myOrgId: OTHER_ORG, accountRole: "manager", accountRoleKnown: true,
    });
    expect(managerView.mine.map((d) => d.id)).toEqual(["x", "y"]); // still counted, as the server does
    expect(["x", "y"].filter((id) => managerView.showsAsMine({ id, organisation_id: OTHER_ORG }))).toEqual([]);
  });

  test("falls back to the ones I created while my_role() has not answered", () => {
    expect(shows({ accountRole: null, accountRoleKnown: false })).toEqual(["a"]);
  });

  test("falls back too while my_org_id() has not answered", () => {
    const a = deptAllowance({ departments, myOrgId: undefined, accountRole: "owner", accountRoleKnown: true });
    expect(departments.filter(a.showsAsMine).map((d) => d.id)).toEqual(["a"]);
  });

  test("a real null role — no membership row — falls back as well", () => {
    expect(shows({ accountRole: null, accountRoleKnown: true })).toEqual(["a"]);
  });

  test("a missing department is never mine", () => {
    const a = deptAllowance({ departments, myOrgId: MY_ORG, accountRole: "owner", accountRoleKnown: true });
    expect(a.showsAsMine(undefined)).toBe(false);
  });
});

test("ownership never comes from deptPerms", () => {
  // A permissions map that contradicts the rows. The module takes no such
  // argument; handing one in anyway must change nothing and read nothing.
  const deptPerms = { get: jest.fn(() => ({ isOwner: false, role: "employee" })) };
  const departments = [row("a", MY_ORG), row("b", MY_ORG), row("c", MY_ORG)];
  const plain = deptAllowance({ departments, myOrgId: MY_ORG, limit: 2 });
  const withPerms = deptAllowance({ departments, myOrgId: MY_ORG, limit: 2, deptPerms });
  for (const id of ["a", "b", "c"]) {
    expect(withPerms.isLocked(id)).toBe(plain.isLocked(id));
    expect(withPerms.canDelete(id)).toBe(plain.canDelete(id));
    const d = departments.find((x) => x.id === id);
    expect(withPerms.showsAsMine(d)).toBe(plain.showsAsMine(d));
  }
  expect(withPerms.addPrediction).toBe(plain.addPrediction);
  expect(deptPerms.get).not.toHaveBeenCalled();
});

describe("ownerLevel", () => {
  test("the department's own role wins when my_departments() has answered", () => {
    expect(ownerLevel({ deptRole: "owner", accountRole: "manager", accountRoleKnown: true }).isOwner).toBe(true);
    expect(ownerLevel({ deptRole: "manager", accountRole: "owner", accountRoleKnown: true }).isOwner).toBe(false);
  });

  test("falls back to my_role() once it has answered", () => {
    expect(ownerLevel({ deptRole: undefined, accountRole: "owner", accountRoleKnown: true }).isOwner).toBe(true);
    expect(ownerLevel({ deptRole: undefined, accountRole: "manager", accountRoleKnown: true }).isOwner).toBe(false);
  });

  test("a real null from my_role() is an account from before invites — an owner", () => {
    expect(ownerLevel({ deptRole: null, accountRole: null, accountRoleKnown: true })).toEqual({ known: true, isOwner: true });
  });

  test("unknown is not an owner", () => {
    expect(ownerLevel({ deptRole: undefined, accountRole: null, accountRoleKnown: false })).toEqual({ known: false, isOwner: false });
    expect(ownerLevel({ deptRole: null, accountRole: null, accountRoleKnown: false }).isOwner).toBe(false);
  });
});
