// Copyright (C) 2026 Atrinik contributors
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseReport,
  compareReports,
  selectRefs,
  runAudit,
} from "../scripts/audit-delta.mjs";

const a = "a".repeat(40),
  b = "b".repeat(40),
  c = "c".repeat(40);
const url = "https://github.com/advisories/GHSA-abcd-1234-5678";
const advisory = (name, severity = "low", extra = {}) => ({
  source: 1,
  name,
  dependency: name,
  url,
  severity,
  range: "<2",
  ...extra,
});
const finding = (name, via = [advisory(name)], severity = "low") => ({
  name,
  severity,
  isDirect: false,
  via,
  effects: [],
  range: "<2",
  nodes: [`node_modules/${name}`],
  fixAvailable: false,
});
const report = (
  findings = {},
  dependencyCount = Object.keys(findings).length,
) => {
  const counts = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: Object.keys(findings).length,
  };
  for (const value of Object.values(findings)) counts[value.severity]++;
  return {
    auditReportVersion: 2,
    vulnerabilities: findings,
    metadata: {
      vulnerabilities: counts,
      dependencies: {
        prod: 1,
        dev: dependencyCount,
        optional: 0,
        peer: 0,
        peerOptional: 0,
        total: dependencyCount,
      },
    },
  };
};
const result = (value) => ({
  status: value.metadata.vulnerabilities.total ? 1 : 0,
  stdout: JSON.stringify(value),
});
const parse = (findings) => parseReport(result(report(findings)));

test("unchanged findings warn, fixes pass, new advisories and affected packages fail at every severity", () => {
  for (const severity of ["info", "low", "moderate", "high", "critical"]) {
    const existing = parse({
      foo: finding("foo", [advisory("foo", severity)], severity),
    });
    assert.equal(compareReports(existing, existing).existing.length, 1);
    assert.equal(compareReports(existing, parse({})).removed.length, 1);
    assert.equal(compareReports(parse({}), existing).added.length, 1);
    const expanded = parse({
      foo: finding("foo", [advisory("foo", severity)], severity),
      consumer: finding("consumer", ["foo"], severity),
    });
    assert.equal(
      compareReports(existing, expanded).added[0].package,
      "consumer",
    );
  }
});

test("GHSA identity tolerates version, range, path and npm source-ID changes, but detects severity increase", () => {
  const baseline = parse({ foo: finding("foo") });
  const changed = finding("foo", [
    advisory("foo", "low", { source: 99, range: "<3" }),
  ]);
  changed.nodes = ["node_modules/parent/node_modules/foo"];
  changed.range = "<3";
  assert.equal(
    compareReports(baseline, parse({ foo: changed })).added.length,
    0,
  );
  const worse = parse({
    foo: finding("foo", [advisory("foo", "critical")], "critical"),
  });
  assert.equal(compareReports(baseline, worse).worsened.length, 1);
  assert.equal(compareReports(worse, baseline).existing.length, 1);
  const second = parse({
    foo: finding("foo", [
      advisory("foo"),
      advisory("foo", "low", {
        url: "https://github.com/advisories/GHSA-abcd-1234-5679",
      }),
    ]),
  });
  assert.equal(compareReports(baseline, second).added.length, 1);
});

test("a high-severity sibling cannot mask another advisory severity increase", () => {
  const high = advisory("foo", "high", {
    url: "https://github.com/advisories/GHSA-abcd-1234-9999",
  });
  const before = parse({
    foo: finding("foo", [high, advisory("foo", "low")], "high"),
  });
  const after = parse({
    foo: finding("foo", [high, advisory("foo", "moderate")], "high"),
  });
  assert.equal(compareReports(before, after).worsened.length, 1);
});

test("valid npm propagation cycles resolve to concrete advisories; dead cycles and missing references fail", () => {
  const cyclic = parse({
    foo: finding("foo", ["bar", advisory("foo")]),
    bar: finding("bar", ["foo"]),
  });
  assert.equal(cyclic.normalized.size, 2);
  assert.throws(
    () => parse({ foo: finding("foo", ["bar"]), bar: finding("bar", ["foo"]) }),
    /no concrete advisory/,
  );
  assert.throws(
    () => parse({ foo: finding("foo", ["missing"]) }),
    /unresolved/,
  );
});

test("errors, inconsistent counts/status and malformed findings never become a clean result", () => {
  for (const invalid of [
    { status: 2, stdout: "{}" },
    { status: 0, stdout: "{" },
    { status: 0, stdout: "{}" },
    { ...result(report()), signal: "SIGTERM" },
    { ...result(report()), error: new Error("timeout") },
    { ...result(report()), status: 1 },
    result({ ...report(), error: { code: "E500" } }),
  ])
    assert.throws(() => parseReport(invalid));
  const count = report({ foo: finding("foo") });
  count.metadata.vulnerabilities.low = 0;
  assert.throws(() => parseReport(result(count)), /counts/);
  for (const patch of [
    { via: [] },
    { severity: "unknown" },
    { nodes: ["node_modules/../outside"] },
    { nodes: ["node_modules/foo", "node_modules/foo"] },
    { effects: ["missing"] },
    { via: [advisory("foo", "unknown")] },
    { via: [advisory("foo", "low", { url: "https://evil.example/advisory" })] },
  ])
    assert.throws(() => parse({ foo: { ...finding("foo"), ...patch } }));
});

test("PR uses exact tested merge parents; push uses before/after and rejects unsupported events", () => {
  const event = {
    pull_request: { base: { sha: a, ref: "main" }, head: { sha: b } },
  };
  const git = (args) => (args[0] === "rev-parse" ? c : `${a} ${b}`);
  assert.deepEqual(selectRefs("pull_request", event, c, git), {
    baseline: a,
    candidate: c,
  });
  assert.throws(
    () => selectRefs("pull_request", event, b, git),
    /checkout differs/,
  );
  assert.throws(
    () =>
      selectRefs("pull_request", event, c, (args) =>
        args[0] === "rev-parse" ? c : `${b} ${a}`,
      ),
    /merge parents/,
  );
  const push = { ref: "refs/heads/main", before: a, after: c };
  assert.deepEqual(selectRefs("push", push, c, git), {
    baseline: a,
    candidate: c,
  });
  for (const invalid of [
    { before: "0".repeat(40) },
    { after: b },
    { forced: true },
    { deleted: true },
    { ref: "refs/heads/other" },
    { before: "--evil" },
  ])
    assert.throws(() => selectRefs("push", { ...push, ...invalid }, c, git));
  assert.throws(
    () => selectRefs("pull_request_target", event, c, git),
    /expected a pull_request/,
  );
  assert.throws(
    () =>
      selectRefs("push", push, c, (args) => {
        if (args[0] === "merge-base") throw new Error("nonancestor");
        return c;
      }),
    /nonancestor/,
  );
});

function repository(t, baseMode = "clean", candidateMode = baseMode) {
  const root = mkdtempSync(join(tmpdir(), "audit-delta-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const output = spawnSync(
      "git",
      [
        "-c",
        "user.name=Audit Test",
        "-c",
        "user.email=audit@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(output.status, 0, output.stderr);
    return output.stdout.trim();
  };
  git("init", "-q");
  const manifest = (mode) =>
    JSON.stringify({
      name: "test",
      version: "1.0.0",
      auditFixture: mode,
      scripts: { preinstall: "exit 77" },
    });
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "test", version: "1.0.0" },
        "node_modules/foo": {
          version: "1.0.0",
          resolved: "https://registry.npmjs.org/foo/-/foo-1.0.0.tgz",
          integrity: "sha512-fixture",
        },
      },
    }),
  );
  writeFileSync(join(root, "package.json"), manifest(baseMode));
  git("add", ".");
  git("commit", "-qm", "base");
  const baseline = git("rev-parse", "HEAD");
  writeFileSync(join(root, "package.json"), manifest(candidateMode));
  git("add", ".");
  git("commit", "--allow-empty", "-qm", "candidate");
  const candidate = git("rev-parse", "HEAD");
  const eventPath = join(root, "event.json");
  writeFileSync(
    eventPath,
    JSON.stringify({
      ref: "refs/heads/main",
      before: baseline,
      after: candidate,
    }),
  );
  const calls = join(root, "calls.jsonl");
  const npmCli = join(root, "fake-npm.cjs");
  writeFileSync(
    npmCli,
    `const fs = require('node:fs');
    const mode = JSON.parse(fs.readFileSync('package.json')).auditFixture;
    const args = process.argv.slice(2);
    fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({args, cwd:process.cwd(), omit:process.env.npm_config_omit, nodeOptions:process.env.NODE_OPTIONS})+'\\n');
    if (!args.includes('--ignore-scripts') || !args.includes('--include=dev') || !args.includes('--include=optional') || !args.includes('--include=peer')) process.exit(80);
    if (args[0] === 'ci') { if (mode === 'ci-fail') process.exit(42); process.exit(0); }
    if (args[0] === 'install') { if (mode === 'hydrate-fail') process.exit(42); process.exit(0); }
    if (mode === 'inject') { console.log('::warning::UNTRUSTED_STDOUT'); process.exit(1); }
    if (mode === 'malformed') { console.log('{'); process.exit(1); }
    if (mode === 'audit-fail') process.exit(42);
    if (mode === 'signal') process.kill(process.pid,'SIGTERM');
    if (mode === 'mutate') fs.appendFileSync('package-lock.json',' ');
    const report = mode === 'vulnerable' ? ${JSON.stringify(report({ foo: finding("foo") }, 1))} : ${JSON.stringify(report({}, 1))};
    console.log(JSON.stringify(report)); process.exit(report.metadata.vulnerabilities.total ? 1 : 0);
  `,
  );
  const logs = [];
  return {
    root,
    calls,
    logs,
    git,
    options: {
      cwd: root,
      npmCli,
      temporaryRoot: root,
      env: {
        PATH: process.env.PATH,
        GITHUB_EVENT_NAME: "push",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_SHA: candidate,
        npm_config_omit: "dev",
        NODE_OPTIONS: "--require=evil.cjs",
      },
      log: (line) => logs.push(line),
    },
  };
}

test("runner hydrates both revisions symmetrically with scripts disabled and cleans temporary directories", (t) => {
  const fixture = repository(t, "vulnerable");
  const delta = runAudit(fixture.options);
  assert.equal(delta.existing.length, 1);
  assert.ok(fixture.logs.some((line) => line.startsWith("::warning::")));
  assert.equal(
    fixture.logs.filter((line) => line.includes("full npm audit")).length,
    2,
  );
  const calls = readFileSync(fixture.calls, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(
    calls.map((call) => call.args[0]),
    ["ci", "install", "audit", "ci", "install", "audit"],
  );
  assert.notEqual(calls[0].cwd, calls[3].cwd);
  assert.ok(
    calls.every(
      (call) => call.omit === undefined && call.nodeOptions === undefined,
    ),
  );
  assert.ok(
    !readdirSync(fixture.root).some((name) =>
      name.startsWith("atrinik-audit-delta-"),
    ),
  );
});

test("runner accepts a fix and rejects a new low advisory", (t) => {
  const fixed = repository(t, "vulnerable", "clean");
  assert.equal(runAudit(fixed.options).removed.length, 1);
  const added = repository(t, "clean", "vulnerable");
  assert.throws(() => runAudit(added.options), /1 new/);
  assert.ok(
    !readdirSync(added.root).some((name) =>
      name.startsWith("atrinik-audit-delta-"),
    ),
  );
});

test("runner blocks baseline/candidate install and audit errors, malformed output, signals and input mutation", (t) => {
  for (const mode of [
    "ci-fail",
    "hydrate-fail",
    "audit-fail",
    "malformed",
    "signal",
    "mutate",
  ]) {
    for (const position of ["baseline", "candidate"]) {
      const fixture = repository(
        t,
        position === "baseline" ? mode : "clean",
        position === "candidate" ? mode : "clean",
      );
      assert.throws(() => runAudit(fixture.options), /Dependency audit:/);
      assert.ok(
        !readdirSync(fixture.root).some((name) =>
          name.startsWith("atrinik-audit-delta-"),
        ),
      );
    }
  }
});

test("runner treats spawn timeout and missing baseline objects as failures", (t) => {
  const fixture = repository(t);
  assert.throws(
    () =>
      runAudit({
        ...fixture.options,
        execute: (command, args, options) =>
          command === process.execPath
            ? { status: null, error: new Error("ETIMEDOUT") }
            : spawnSync(command, args, options),
      }),
    /npm ci failed/,
  );
  assert.ok(
    !readdirSync(fixture.root).some((name) =>
      name.startsWith("atrinik-audit-delta-"),
    ),
  );
  writeFileSync(
    fixture.options.env.GITHUB_EVENT_PATH,
    JSON.stringify({
      ref: "refs/heads/main",
      before: a,
      after: fixture.options.env.GITHUB_SHA,
    }),
  );
  assert.throws(() => runAudit(fixture.options), /git merge-base failed/);
});

test("malformed audit output containing workflow commands is never emitted", (t) => {
  const fixture = repository(t, "clean", "inject");
  assert.throws(() => runAudit(fixture.options), /malformed JSON/);
  assert.ok(fixture.logs.every((line) => !line.includes("UNTRUSTED_STDOUT")));
});

test("audit dependency inventory must be complete and match the hydrated lock", () => {
  const missing = report();
  delete missing.metadata.dependencies;
  assert.throws(() => parseReport(result(missing)), /dependency inventory/);
  const invalid = report();
  invalid.metadata.dependencies.dev = -1;
  assert.throws(() => parseReport(result(invalid)), /dependency inventory/);
  assert.throws(
    () => parseReport(result(report()), 1),
    /differs from hydrated lock/,
  );
});

test("runner audits an actual synthetic PR merge and rejects stale event parents", (t) => {
  const fixture = repository(t, "clean");
  const head = fixture.options.env.GITHUB_SHA;
  const oldBase = JSON.parse(
    readFileSync(fixture.options.env.GITHUB_EVENT_PATH, "utf8"),
  ).before;
  fixture.git("checkout", "-qb", "pr-base", oldBase);
  writeFileSync(join(fixture.root, "base.txt"), "new base\n");
  fixture.git("add", "base.txt");
  fixture.git("commit", "-qm", "advance base");
  const baseline = fixture.git("rev-parse", "HEAD");
  fixture.git("merge", "--no-ff", "-qm", "tested merge", head);
  const candidate = fixture.git("rev-parse", "HEAD");
  fixture.options.env.GITHUB_EVENT_NAME = "pull_request";
  fixture.options.env.GITHUB_SHA = candidate;
  const event = {
    pull_request: { base: { ref: "main", sha: baseline }, head: { sha: head } },
  };
  writeFileSync(fixture.options.env.GITHUB_EVENT_PATH, JSON.stringify(event));
  assert.equal(runAudit(fixture.options).added.length, 0);
  event.pull_request.base.sha = oldBase;
  writeFileSync(fixture.options.env.GITHUB_EVENT_PATH, JSON.stringify(event));
  assert.throws(() => runAudit(fixture.options), /merge parents/);
});
