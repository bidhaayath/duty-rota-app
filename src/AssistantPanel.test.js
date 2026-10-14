/* Ini's panel: "A month" or "Choose dates", the three-month limit, and a
   note that asks to build particular dates. The database, the AI and the
   background build are replaced with stand-ins — nothing here reaches the
   live service. */

import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import AssistantPanel from "./AssistantPanel";
import { startMonthBuild } from "./monthBuildRunner";

jest.mock("./supabaseClient", () => ({
  __esModule: true,
  default: {
    rpc: () => Promise.resolve({ data: { ok: true, cap: 20, used: 1, remaining: 19 }, error: null }),
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "t" } } }) },
  },
}));
jest.mock("./monthBuildRunner", () => ({ startMonthBuild: jest.fn() }));
// The test setup resets stand-ins before each test, so they are set here.
beforeEach(() => {
  startMonthBuild.mockImplementation(() => ({ promise: new Promise(() => {}), cancel: () => {} }));
});

const T = { lagoon: "#0F8B7E", ink: "#142B33", inkSoft: "#4A6570", line: "#DCE8E6", mist: "#EEF4F3", coral: "#E4604E" };
const makeData = () => ({
  staff: [{ id: "a", name: "Ali" }, { id: "m", name: "Mariyam" }],
  codes: [{ id: "M", code: "M", color: "#F4B860", counts: "morning" }],
  cells: {}, nonOfficial: [], dutyRequests: [],
});
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const renderPanel = (data, update = jest.fn()) => render(
  <AssistantPanel visible deptId="d1" data={data} update={update} T={T}
    uid={() => Math.random().toString(36).slice(2)} dstr={iso} canBuild onMonthApplied={jest.fn()} />,
);
const open = async () => {
  fireEvent.click(screen.getByLabelText("Ask Ini"));
  await screen.findByText("Choose dates");
};

test("choosing dates: defaults to the month shown, and blocks more than three months", async () => {
  renderPanel(makeData());
  await open();
  fireEvent.click(screen.getByText("Choose dates"));
  const from = screen.getByLabelText("From");
  const to = screen.getByLabelText("To");
  const n = new Date();
  expect(from.value).toBe(iso(new Date(n.getFullYear(), n.getMonth() + 1, 1)));
  expect(to.value).toBe(iso(new Date(n.getFullYear(), n.getMonth() + 2, 0)));

  fireEvent.change(from, { target: { value: "2026-11-15" } });
  fireEvent.change(to, { target: { value: "2026-12-14" } });
  expect(screen.getByText(/Build roster for 15 Nov – 14 Dec/)).not.toBeDisabled();

  fireEvent.change(to, { target: { value: "2027-03-01" } });
  expect(screen.getByRole("alert")).toHaveTextContent("Choose at most 3 months (92 days) at a time.");
  expect(screen.getByText(/Build roster for/).closest("button")).toBeDisabled();
});

test("a note that asks to build particular dates switches to those dates", async () => {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      ok: true, unclear: [], requests: [],
      leave: [{ staffId: "a", type: "annual", start: "2026-12-10", end: "2026-12-12" }],
      build: true, buildFrom: "2026-11-15", buildTo: "2026-12-14", historyFrom: null,
      usage: { cap: 20, used: 2, remaining: 18 },
    }),
  }));
  let data = makeData();
  const update = jest.fn((fn) => { data = fn(JSON.parse(JSON.stringify(data))); });
  const { rerender } = renderPanel(data, update);
  await open();
  fireEvent.change(screen.getByPlaceholderText(/Fathimath Easa/), { target: { value: "Ali leave 10-12 Dec, build 15 Nov to 14 Dec" } });
  fireEvent.click(screen.getByText("Read my note"));

  expect(await screen.findByText("Build the roster for 15 Nov – 14 Dec")).toBeInTheDocument();
  // The leave falls inside the dates being built, so it starts ticked.
  expect(screen.queryByText("outside the dates you chose")).toBeNull();
  const confirm = screen.getByText(/Add 1 item and build 15 Nov – 14 Dec/);
  fireEvent.click(confirm);
  expect(update).toHaveBeenCalledTimes(1);

  // The month is built from the rota that includes the leave just added.
  act(() => {
    rerender(<AssistantPanel visible deptId="d1" data={data} update={update} T={T}
      uid={() => "x"} dstr={iso} canBuild onMonthApplied={jest.fn()} />);
  });
  await waitFor(() => expect(startMonthBuild).toHaveBeenCalled());
  const config = startMonthBuild.mock.calls[0][0];
  expect(config.from <= "2026-11-15" && config.to >= "2026-12-14").toBe(true);
  const ali = config.staff.find((s) => s.id === "a");
  expect(ali.leavePeriods.some((p) => p.start === "2026-12-10" && p.end === "2026-12-12")).toBe(true);
});
