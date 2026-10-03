// Copyright (C) 2026 Atrinik contributors
// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { validateHydratedLock } from "./audit-lock.mjs";

const levels = ["info", "low", "moderate", "high", "critical"];
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const fail = (message) => {
  throw new Error(`Dependency audit: ${message}`);
};
const rank = (severity) => levels.indexOf(severity);
const shaPattern = /^[a-f0-9]{40}$/;
const checkedSha = (sha) => {
  if (!shaPattern.test(sha ?? "") || /^0+$/.test(sha))
    fail("missing or invalid revision (initial pushes have no baseline)");
  return sha;
};
const pathIsSafe = (path) =>
  typeof path === "string" &&
  /^(?:node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(
    path,
  ) &&
  !path.includes("\\") &&
  !path.split("/").some((part) => !part || part === "." || part === "..");

/** Validate npm's complete report, then resolve advisory propagation, including cycles. */
export function parseReport(result, expectedDependencies) {
  if (result.error || result.signal || ![0, 1].includes(result.status))
    fail("npm audit did not complete");
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    fail("npm audit returned malformed JSON");
  }
  if (
    !object(report) ||
    own(report, "error") ||
    report.auditReportVersion !== 2 ||
    !object(report.vulnerabilities) ||
    !object(report.metadata?.vulnerabilities)
  )
    fail("unsupported or incomplete npm audit report");
  const dependencies = report.metadata.dependencies;
  if (
    !object(dependencies) ||
    !["prod", "dev", "optional", "peer", "peerOptional", "total"].every(
      (key) =>
        Number.isSafeInteger(dependencies[key]) && dependencies[key] >= 0,
    )
  )
    fail("missing or malformed dependency inventory");
  if (
    expectedDependencies !== undefined &&
    dependencies.total !== expectedDependencies
  )
    fail("audit dependency inventory differs from hydrated lock");
  const findings = report.vulnerabilities;
  const counts = Object.fromEntries(levels.map((severity) => [severity, 0]));
  const advisoryDefinitions = new Map();
  for (const [name, finding] of Object.entries(findings)) {
    if (
      !name ||
      !object(finding) ||
      finding.name !== name ||
      !levels.includes(finding.severity) ||
      typeof finding.isDirect !== "boolean" ||
      typeof finding.range !== "string" ||
      !Array.isArray(finding.via) ||
      !finding.via.length ||
      !Array.isArray(finding.effects) ||
      !finding.effects.every(
        (value) => typeof value === "string" && own(findings, value),
      ) ||
      !Array.isArray(finding.nodes) ||
      !finding.nodes.length ||
      !finding.nodes.every(pathIsSafe) ||
      new Set(finding.nodes).size !== finding.nodes.length
    )
      fail(`malformed finding ${JSON.stringify(name)}`);
    counts[finding.severity]++;
    for (const via of finding.via) {
      if (typeof via === "string") {
        if (!own(findings, via)) fail("unresolved advisory reference");
        continue;
      }
      if (
        !object(via) ||
        !Number.isSafeInteger(via.source) ||
        via.source <= 0 ||
        typeof via.name !== "string" ||
        !via.name ||
        via.dependency !== name ||
        typeof via.url !== "string" ||
        !/^https:\/\/github\.com\/advisories\/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(
          via.url,
        ) ||
        !levels.includes(via.severity) ||
        typeof via.range !== "string"
      )
        fail(`malformed advisory in ${JSON.stringify(name)}`);
      // GHSA survives npm source-ID/range updates; package remains part of identity.
      const identity = JSON.stringify([via.name, via.url]);
      const previous = advisoryDefinitions.get(identity);
      if (previous && previous.severity !== via.severity)
        fail("conflicting advisory severities");
      advisoryDefinitions.set(identity, via);
    }
  }
  const total = Object.keys(findings).length;
  for (const severity of levels)
    if (report.metadata.vulnerabilities[severity] !== counts[severity])
      fail("audit severity counts disagree");
  if (
    report.metadata.vulnerabilities.total !== total ||
    result.status !== (total ? 1 : 0)
  )
    fail("audit status or total disagrees");
  const normalized = new Map();
  for (const [name, finding] of Object.entries(findings)) {
    const visited = new Set();
    const pending = [name];
    let leaves = 0;
    while (pending.length) {
      const next = pending.pop();
      if (visited.has(next)) continue;
      visited.add(next);
      for (const via of findings[next].via) {
        if (typeof via === "string") {
          pending.push(via);
          continue;
        }
        leaves++;
        const identity = JSON.stringify([name, via.name, via.url]);
        const severity = via.severity;
        normalized.set(identity, {
          package: name,
          advisoryPackage: via.name,
          advisory: via.url,
          severity,
          packageSeverity: finding.severity,
        });
      }
    }
    if (!leaves)
      fail(`finding has no concrete advisory: ${JSON.stringify(name)}`);
  }
  return { report, normalized };
}

export function compareReports(baseline, candidate) {
  const added = [],
    worsened = [],
    existing = [],
    removed = [];
  for (const [identity, finding] of candidate.normalized) {
    const previous = baseline.normalized.get(identity);
    if (!previous) added.push(finding);
    else if (
      rank(finding.severity) > rank(previous.severity) ||
      rank(finding.packageSeverity) > rank(previous.packageSeverity)
    )
      worsened.push({
        ...finding,
        previousSeverity: previous.severity,
        previousPackageSeverity: previous.packageSeverity,
      });
    else existing.push(finding);
  }
  for (const [identity, finding] of baseline.normalized)
    if (!candidate.normalized.has(identity)) removed.push(finding);
  return { added, worsened, existing, removed };
}

/** Event SHAs are data, never executable shell interpolation or moving branch names. */
export function selectRefs(eventName, event, testedSha, git) {
  const candidate = checkedSha(testedSha);
  if (git(["rev-parse", "HEAD"]).trim() !== candidate)
    fail("checkout differs from tested revision");
  if (eventName === "pull_request") {
    const baseline = checkedSha(event.pull_request?.base?.sha);
    const head = checkedSha(event.pull_request?.head?.sha);
    if (event.pull_request.base.ref !== "main")
      fail("unexpected pull-request base branch");
    const parents = git(["show", "-s", "--format=%P", candidate])
      .trim()
      .split(" ");
    if (parents.length !== 2 || parents[0] !== baseline || parents[1] !== head)
      fail("tested merge parents differ from event base/head");
    return { baseline, candidate };
  }
  if (eventName === "push") {
    const baseline = checkedSha(event.before);
    if (
      event.ref !== "refs/heads/main" ||
      checkedSha(event.after) !== candidate ||
      event.deleted === true ||
      event.forced === true
    )
      fail("unsupported push or mismatched candidate");
    git(["merge-base", "--is-ancestor", baseline, candidate]);
    if (baseline === candidate) fail("baseline equals candidate");
    return { baseline, candidate };
  }
  fail("expected a pull_request or main push event");
}

export function runAudit({
  cwd = process.cwd(),
  env = process.env,
  temporaryRoot = tmpdir(),
  npmCli = realpathSync(join(dirname(process.execPath), "npm")),
  execute = spawnSync,
  log = console.log,
} = {}) {
  const command = (program, args, options = {}) =>
    execute(program, args, {
      cwd,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    });
  const git = (args) => {
    const result = command("git", args);
    if (result.error || result.signal || result.status !== 0)
      fail(`git ${args[0]} failed; required revision may be unavailable`);
    return result.stdout;
  };
  let event;
  try {
    event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  } catch {
    fail("cannot read GitHub event");
  }
  const refs = selectRefs(env.GITHUB_EVENT_NAME, event, env.GITHUB_SHA, git);
  const root = mkdtempSync(join(temporaryRoot, "atrinik-audit-delta-"));
  try {
    const config = join(root, "user.npmrc");
    const globalConfig = join(root, "global.npmrc");
    writeFileSync(config, "");
    writeFileSync(globalConfig, "");
    const cleanEnv = {
      PATH: env.PATH,
      HOME: root,
      TMPDIR: root,
      npm_config_userconfig: config,
      npm_config_globalconfig: globalConfig,
      npm_config_cache: join(root, "cache"),
      npm_config_registry: "https://registry.npmjs.org/",
      npm_config_update_notifier: "false",
    };
    const reports = {};
    for (const [label, sha] of Object.entries(refs)) {
      const directory = join(root, label);
      mkdirSync(directory);
      const sources = {};
      if (git(["ls-tree", sha, "--", "npm-shrinkwrap.json"]).trim())
        fail(`${label}: npm-shrinkwrap.json is unsupported`);
      for (const file of ["package.json", "package-lock.json"]) {
        if (
          !/^100(?:644|755) blob [a-f0-9]{40}\t/.test(
            git(["ls-tree", sha, "--", file]),
          )
        )
          fail(`${label}: missing or nonregular ${file}`);
        sources[file] = git(["show", `${sha}:${file}`]);
        writeFileSync(join(directory, file), sources[file]);
      }
      let manifest, lock;
      try {
        manifest = JSON.parse(sources["package.json"]);
        lock = JSON.parse(sources["package-lock.json"]);
      } catch {
        fail(`${label}: malformed dependency manifest/lock`);
      }
      if (
        !object(manifest) ||
        own(manifest, "workspaces") ||
        !object(lock) ||
        lock.lockfileVersion !== 3 ||
        !object(lock.packages) ||
        !object(lock.packages[""]) ||
        Object.values(lock.packages).some(
          (entry) =>
            !object(entry) ||
            entry.link ||
            (typeof entry.resolved === "string" &&
              /^(?:file:|link:)/.test(entry.resolved)),
        )
      )
        fail(`${label}: expected standalone standard npm v3 lock`);
      for (const [path, entry] of Object.entries(lock.packages)) {
        if (
          path &&
          (!pathIsSafe(path) ||
            typeof entry.version !== "string" ||
            !entry.version ||
            (!entry.resolved && entry.inBundle !== true))
        )
          fail(`${label}: unsupported package path/source`);
        if (entry.resolved) {
          let source;
          try {
            source = new URL(entry.resolved);
          } catch {
            fail(`${label}: unsupported package source`);
          }
          if (
            source.protocol !== "https:" ||
            source.hostname !== "registry.npmjs.org" ||
            source.username ||
            source.password ||
            source.port
          )
            fail(`${label}: expected public npm registry packages`);
        }
        for (const kind of [
          "dependencies",
          "devDependencies",
          "optionalDependencies",
          "peerDependencies",
        ]) {
          if (entry[kind] !== undefined && !object(entry[kind]))
            fail(`${label}: malformed dependency map`);
          for (const spec of Object.values(entry[kind] ?? {}))
            if (
              typeof spec !== "string" ||
              /^(?:file|link|workspace|git|git\+[^:]*|https?|ssh|github|gitlab|bitbucket):/.test(
                spec,
              ) ||
              (spec.includes("/") && !spec.startsWith("npm:"))
            )
              fail(`${label}: unsupported nonregistry dependency`);
        }
      }
      const common = [
        "--ignore-scripts",
        "--include=dev",
        "--include=optional",
        "--include=peer",
        "--registry=https://registry.npmjs.org/",
      ];
      const options = { cwd: directory, env: cleanEnv };
      const installed = command(
        process.execPath,
        [npmCli, "ci", "--no-audit", "--no-fund", ...common],
        options,
      );
      if (installed.error || installed.signal || installed.status !== 0)
        fail(`${label}: npm ci failed`);
      // npm audit reads the virtual lock, so materialize omitted bundle records first.
      const hydrated = command(
        process.execPath,
        [
          npmCli,
          "install",
          "--package-lock-only",
          "--no-audit",
          "--no-fund",
          ...common,
        ],
        options,
      );
      if (hydrated.error || hydrated.signal || hydrated.status !== 0)
        fail(`${label}: temporary lock hydration failed`);
      const auditLock = readFileSync(
        join(directory, "package-lock.json"),
        "utf8",
      );
      let hydratedLock;
      try {
        hydratedLock = JSON.parse(auditLock);
      } catch {
        fail(`${label}: malformed hydrated lock`);
      }
      validateHydratedLock(lock, hydratedLock, directory);
      if (
        readFileSync(join(directory, "package.json"), "utf8") !==
        sources["package.json"]
      )
        fail(`${label}: npm changed package.json`);
      const result = command(
        process.execPath,
        [npmCli, "audit", "--json", "--audit-level=info", ...common],
        options,
      );
      // Validate before logging: untrusted malformed stdout may contain workflow commands.
      reports[label] = parseReport(
        result,
        Object.keys(hydratedLock.packages).length - 1,
      );
      log(
        `${label} full npm audit (${sha}):\n${JSON.stringify(reports[label].report, null, 2)}`,
      );
      for (const [file, source] of Object.entries({
        "package.json": sources["package.json"],
        "package-lock.json": auditLock,
      }))
        if (readFileSync(join(directory, file), "utf8") !== source)
          fail(`${label}: npm changed ${file}`);
    }
    const delta = compareReports(reports.baseline, reports.candidate);
    log(JSON.stringify({ revisions: refs, ...delta }, null, 2));
    if (delta.existing.length)
      log(
        `::warning::${delta.existing.length} existing advisory/package findings remain; see full audit reports.`,
      );
    if (delta.added.length || delta.worsened.length)
      fail(
        `${delta.added.length} new and ${delta.worsened.length} worsened advisory/package findings`,
      );
    log(
      `Dependency audit delta passed; ${delta.removed.length} advisory/package findings removed.`,
    );
    return delta;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    runAudit();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
