/* Smart Roster's "Generate this month": the same month build Ini's panel
   offers, on step 3. Opening writes nothing; building hands the engine the
   month Smart Roster would build; a month that cannot be built says why
   and changes nothing. The engine run itself is mocked here — it is tested
   in monthBuild.test.js. */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MonthBuildCard from "./MonthBuildCard";
import { startMonthBuild } from "./monthBuildRunner";

jest.mock("./monthBuildRunner", () => ({ startMonthBuild: jest.fn() }));

const CODES = [
  { id: "M", code: "M", counts: "morning" }, { id: "A", code: "A", counts: "afternoon" },
  { id: "N", code: "N", counts: "night" }, { id: "OFF", code: "OFF", counts: "off" },
];
const data = {
  staff: [{ id: "s0", name: "Shau", leavePeriods: [] }, { id: "s1", name: "Ana", leavePeriods: [] }],
  codes: CODES, cells: {}, dutyRequests: [], nonOfficial: [],
  rosterRules: { weeklyFixed: [{ id: "w", staffId: "s0", days: [4], duty: "night" }] },
};
const T = { lagoon: "#0F8B7E", ink: "#142B33", inkSoft: "#4A6570", line: "#DCE8E6" };
const Card = ({ children }) => <div>{children}</div>;
const Btn = ({ children, ...rest }) => <button {...rest}>{children}</button>;
const Field = ({ label, children }) => <label>{label}{children}</label>;
const show = (update = jest.fn()) => {
  render(<MonthBuildCard data={data} update={update} T={T} Card={Card} Btn={Btn} Field={Field} inputStyle={{}}
    editable staffEditable={() => true} today="2026-11-26" onMonthApplied={() => {}} />);
  return update;
};

test("opens on next month and writes nothing", () => {
  const update = show();
  expect(screen.getByLabelText("Month to build")).toHaveValue("2026-12");
  expect(screen.getByRole("button", { name: /Generate this month/ })).toBeInTheDocument();
  expect(update).not.toHaveBeenCalled();
});

test("builds December with the ward's rules, and says why when it cannot", async () => {
  startMonthBuild.mockReturnValue({ promise: Promise.resolve({ ok: false, problems: ["Too few staff."] }), cancel: () => {} });
  const update = show();
  fireEvent.click(screen.getByRole("button", { name: /Generate this month/ }));
  await waitFor(() => expect(startMonthBuild).toHaveBeenCalled());
  const config = startMonthBuild.mock.calls[0][0];
  expect(config.from <= "2026-12-01" && config.to >= "2026-12-31").toBe(true);
  expect(config.requests).toContainEqual({ staffId: "s0", date: "2026-12-10", category: "night", source: "manager" });
  expect(await screen.findByText("December 2026 could not be built. Nothing has been changed.")).toBeInTheDocument();
  expect(update).not.toHaveBeenCalled();
});


test("Show another option: pages between the months found, and says when there are no more", async () => {
  const out = (n) => ({ ok: true, cells: {}, report: { shortfalls: [], seniorGaps: [], relaxations: [], fairness: [], budget: [] },
    rotaCells: { "s1|2026-12-01": n === 1 ? "M" : "A" }, ms: 5 });
  startMonthBuild.mockReset();
  startMonthBuild
    .mockReturnValueOnce({ promise: Promise.resolve(out(1)), cancel: () => {} })
    .mockReturnValueOnce({ promise: Promise.resolve({ ...out(2), next: 3 }), cancel: () => {} })
    .mockReturnValueOnce({ promise: Promise.resolve({ ok: false, next: 7 }), cancel: () => {} });
  const update = show();
  fireEvent.click(screen.getByRole("button", { name: /Generate this month/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Show another option" }));
  expect(await screen.findByText("Option 2 of 2")).toBeInTheDocument();
  expect(startMonthBuild.mock.calls[1][2]).toEqual({ keptCells: [{}], next: 1 });
  fireEvent.click(screen.getByRole("button", { name: "Previous option" }));
  expect(screen.getByText("Option 1 of 2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next option" }));
  fireEvent.click(screen.getByRole("button", { name: "Show another option" }));
  expect(await screen.findByText("No other option different enough without being worse.")).toBeInTheDocument();
  expect(update).not.toHaveBeenCalled();
});
