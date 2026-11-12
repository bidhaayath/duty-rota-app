/* Compare the Smart Roster engine in src with an older version of itself.

     node tools/engine-compare/run.js              against main
     node tools/engine-compare/run.js --ref HEAD   against the last commit
     node tools/engine-compare/run.js --job rules  only the measured weeks
     node tools/engine-compare/run.js --job keys   only the strength keys
     node tools/engine-compare/run.js --quick      a small sample, a few minutes

   Jobs: same-weeks, same-months (lists that must change nothing), rules
   (weeks with rules set, counted old against new), keys (each strength key
   at a level of its own, against the same week without it). Default is all four.
   The work is split into parts that run side by side; the full run takes
   around three quarters of an hour. Results are printed and left in out/. */

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const here = __dirname;
const root = path.resolve(here, "..", "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const ref = arg("ref", "main");
const quick = args.includes("--quick");
const jobs = arg("job", "same-weeks,same-months,rules,keys").split(",");
const parts = Number(arg("parts", 4));

// The older engine, exactly as that commit has it.
const oldDir = path.join(here, "old"), outDir = path.join(here, "out");
fs.mkdirSync(oldDir, { recursive: true });
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(oldDir, "rosterEngine.js"),
  execFileSync("git", ["show", `${ref}:src/rosterEngine.js`], { cwd: root, maxBuffer: 1 << 26 }));
const sha = execFileSync("git", ["rev-parse", "--short", ref], { cwd: root }).toString().trim();
console.log(`Old engine: ${ref} (${sha}). New engine: src/rosterEngine.js as it is now.`);

const jest = require.resolve("react-scripts/bin/react-scripts.js", { paths: [root] });
const run = (job, part, of) => new Promise((resolve) => {
  const env = {
    ...process.env, CI: "true", EC_JOB: job, EC_PART: `${part}/${of}`, EC_OUT: outDir,
    ...(quick ? { EC_SAME_WEEKS: "12", EC_RULE_WEEKS: "12", EC_MONTHS: "1" } : {}),
  };
  const child = spawn(process.execPath, [jest, "test", "--watchAll=false",
    "--roots", "<rootDir>/tools", "--roots", "<rootDir>/src",
    "--testMatch", "**/tools/engine-compare/compare.test.js"], { cwd: root, env });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  child.on("close", (code) => {
    if (code !== 0) console.log(`\n${job} part ${part} failed:\n${log}`);
    resolve(code);
  });
});

const merge = (job) => {
  const total = {};
  const add = (into, from) => Object.entries(from).forEach(([k, v]) => {
    if (typeof v === "number") into[k] = (into[k] || 0) + v;
    else if (typeof v === "string") into[k] = v;            // a name, the same in every part
    else if (Array.isArray(v)) into[k] = [...(into[k] || []), ...v];
    else add(into[k] || (into[k] = {}), v);
  });
  fs.readdirSync(outDir).filter((f) => f.startsWith(`${job}-`))
    .forEach((f) => add(total, JSON.parse(fs.readFileSync(path.join(outDir, f), "utf8"))));
  return total;
};
const row = (cells, widths) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");

(async () => {
  const began = Date.now();
  const work = [];
  for (const job of jobs) {
    const of = job === "same-months" ? Math.min(parts, 3) : parts;
    for (let part = 0; part < of; part++) work.push(run(job, part, of));
  }
  const codes = await Promise.all(work);
  let bad = codes.some((c) => c !== 0);

  for (const job of jobs.filter((j) => j.startsWith("same"))) {
    const t = merge(job);
    console.log(`\n${job}: lists that must change nothing (old against new, as text)`);
    Object.entries(t).forEach(([name, v]) => {
      console.log(row([name, `${v.runs} runs`, `${v.different} different`], [44, 10, 14]));
      if (v.different) bad = true;
    });
  }
  if (jobs.includes("rules")) {
    const t = merge("rules");
    const w = [16, 6, 8, 5, 10, 10, 10, 10, 9, 10, 6, 6, 6];
    console.log("\nrules: weeks with rules set, counted from the finished rota");
    console.log(row(["list", "weeks", "refused", "same", "uncov old", "uncov new", "above old", "above new",
      "Try miss", "Must miss", "named", "s old", "s new"], w));
    Object.entries(t).forEach(([name, v]) => {
      console.log(row([name, v.weeks, v.refused, v.sameText, v.old.uncovered, v.new.uncovered, v.old.aboveMost,
        v.new.aboveMost, v.new.tryMissed, v.new.mustMissed, v.new.gapsNamed,
        Math.round(v.old.ms / 1000), Math.round(v.new.ms / 1000)], w));
    });
    console.log("\n(same = weeks identical as text; uncov = uncovered shifts; above = shift-days above Most;");
    console.log(" Try/Must miss = days a day rule was not kept; named = gaps naming a Must day rule; s = seconds building)");
    // Seconds for one week: the middle week and the slowest, old and new.
    const typical = (ms) => { const s = [...ms].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
    const slowest = (ms) => Math.max(0, ...ms);
    const sec = (ms) => (ms / 1000).toFixed(1);
    console.log("\nSeconds to build one week (typical = the middle week):");
    console.log(row(["list", "typical old", "typical new", "slowest old", "slowest new"], [16, 12, 12, 12, 12]));
    const all = { old: [], new: [] };
    Object.entries(t).forEach(([name, v]) => {
      all.old.push(...v.old.weekMs); all.new.push(...v.new.weekMs);
      console.log(row([name, sec(typical(v.old.weekMs)), sec(typical(v.new.weekMs)),
        sec(slowest(v.old.weekMs)), sec(slowest(v.new.weekMs))], [16, 12, 12, 12, 12]));
    });
    console.log(row(["all lists", sec(typical(all.old)), sec(typical(all.new)),
      sec(slowest(all.old)), sec(slowest(all.new))], [16, 12, 12, 12, 12]));
    console.log(`(timed with ${parts} parts running side by side, so a quiet machine is faster)`);
    console.log("\nPeople always off on fixed days, in whole weeks with no leave or request of theirs:");
    Object.entries(t).filter(([, v]) => v.fixed.weeks).forEach(([name, v]) => {
      console.log(row([name, `${v.fixed.weeks} weeks`, `${v.fixed.fixedDaysWorked} fixed days worked`,
        `${v.fixed.weeksWithExtraOff} with an extra off`, `${v.fixed.weeksShortOfDuties} short of duties`],
      [16, 10, 22, 22, 20]));
    });
    const disagree = Object.entries(t).filter(([, v]) => (v.reportDisagrees || []).length);
    console.log(disagree.length
      ? `\nThe report disagrees with the count in: ${disagree.map(([n, v]) => `${n} (${v.reportDisagrees.length})`).join(", ")} - see out/`
      : "\nThe engine's report matches the count in every week.");
    if (disagree.length) bad = true;
  }
  if (jobs.includes("keys")) {
    const t = merge("keys");
    const w = [26, 6, 9, 6, 13, 13, 18, 22, 11];
    const typical = (ms) => { const s = [...ms].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
    const pair = (a, b) => `${a} → ${b}`;
    console.log("\nkeys: each strength key at a level of its own, against the same week without it");
    console.log(row(["key and level", "weeks", "refused", "same", "uncovered", "above Most", "measure",
      "", "s a week"], w));
    Object.entries(t).forEach(([name, v]) => {
      console.log(row([name, v.weeks, pair(v.refusedWithout, v.refusedWith), v.sameCells,
        pair(v.without.uncovered, v.with.uncovered), pair(v.without.aboveMost, v.with.aboveMost),
        v.measure, pair(v.without.measure, v.with.measure),
        pair((typical(v.without.weekMs) / 1000).toFixed(1), (typical(v.with.weekMs) / 1000).toFixed(1))], w));
    });
    console.log("\n(each pair is without the key → with it, over the weeks both built; refused = weeks Generate");
    console.log(" refused; same = weeks with identical cells; s a week = the middle week's seconds. Measures:");
    console.log(" daysOver = days worked past working days in a row; noInCharge = shift-days short of the");
    console.log(" in-charge asked for; nightSpread / nonOfficialSpread = most anyone had less the fewest, summed");
    console.log(" over the weeks; offPairs = off days straight after an off day)");
  }
  console.log(`\n${Math.round((Date.now() - began) / 60000)} minutes.`);
  process.exit(bad ? 1 : 0);
})();
