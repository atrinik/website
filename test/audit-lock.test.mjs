// Copyright (C) 2026 Atrinik contributors
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateHydratedLock } from "../scripts/audit-lock.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "audit-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const original = {
    name: "fixture",
    lockfileVersion: 3,
    packages: {
      "": { name: "fixture", dependencies: { tool: "1.0.0" } },
      "node_modules/tool": {
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/tool/-/tool-1.0.0.tgz",
        integrity: "sha512-fixture",
        bundleDependencies: ["bundled"],
        dependencies: { bundled: "^1", other: "^2" },
      },
    },
  };
  const hydrated = structuredClone(original);
  const location = "node_modules/tool/node_modules/bundled";
  const manifestDir = join(dir, location);
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    join(dir, "node_modules/tool/package.json"),
    JSON.stringify({ name: "tool", version: "1.0.0" }),
  );
  writeFileSync(
    join(manifestDir, "package.json"),
    JSON.stringify({ name: "bundled", version: "1.2.3" }),
  );
  hydrated.packages[location] = { version: "1.2.3", inBundle: true };
  return { dir, original, hydrated, location, manifestDir };
}

test("hydrates previously omitted bundled inventory without an advisory allowlist", (t) => {
  const { original, hydrated, dir, location } = fixture(t);
  validateHydratedLock(original, hydrated, dir);
  // A subsequently published advisory sees exactly the installed bundled version.
  const newAdvisory = { name: "bundled", vulnerableVersion: "1.2.3" };
  assert.equal(
    hydrated.packages[location].version,
    newAdvisory.vulnerableVersion,
  );
  assert.equal(Object.hasOwn(original.packages, location), false);
});

test("accepts reordered dependency maps and unchanged locks", (t) => {
  const { original, hydrated, dir } = fixture(t);
  hydrated.packages["node_modules/tool"].dependencies = {
    other: "^2",
    bundled: "^1",
  };
  validateHydratedLock(original, hydrated, dir);
  validateHydratedLock(hydrated, structuredClone(hydrated), dir);
  assert.throws(
    () => validateHydratedLock(original, structuredClone(original), dir),
    /missing/,
  );
});

for (const field of [
  "version",
  "resolved",
  "integrity",
  "link",
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "devDependencies",
  "peerDependenciesMeta",
  "bundleDependencies",
]) {
  test(`rejects changed existing ${field}`, (t) => {
    const { original, hydrated, dir } = fixture(t);
    hydrated.packages["node_modules/tool"][field] = "changed";
    assert.throws(
      () => validateHydratedLock(original, hydrated, dir),
      /changed/,
    );
  });
}

test("rejects removed packages and root contract changes", (t) => {
  const { original, hydrated, dir } = fixture(t);
  delete hydrated.packages["node_modules/tool"];
  assert.throws(() => validateHydratedLock(original, hydrated, dir), /removed/);
  const changed = structuredClone(original);
  changed.packages[""].dependencies.tool = "2.0.0";
  assert.throws(() => validateHydratedLock(original, changed, dir), /root/);
  changed.packages[""] = structuredClone(original.packages[""]);
  changed.lockfileVersion = 2;
  assert.throws(() => validateHydratedLock(original, changed, dir), /root/);
});

for (const location of [
  "node_modules/unrelated",
  "node_modules/toolbox/node_modules/bundled",
  "node_modules/tool/node_modules/../escape",
  "node_modules/tool/node_modules/bundled/extra",
  "node_modules/tool/node_modules/C:escape",
  "node_modules/tool/node_modules/bundled\\escape",
]) {
  test(`rejects unrelated or malicious addition ${location}`, (t) => {
    const f = fixture(t);
    f.hydrated.packages[location] = { version: "1.0.0", inBundle: true };
    assert.throws(() => validateHydratedLock(f.original, f.hydrated, f.dir));
  });
}

test("requires inBundle, non-link additions and existing bundle declaration", (t) => {
  const { original, hydrated, dir, location } = fixture(t);
  for (const record of [
    { version: "1.2.3" },
    { version: "1.2.3", inBundle: true, link: true },
  ]) {
    hydrated.packages[location] = record;
    assert.throws(
      () => validateHydratedLock(original, hydrated, dir),
      /unproven/,
    );
  }
  hydrated.packages[location] = { version: "1.2.3", inBundle: true };
  delete original.packages["node_modules/tool"].bundleDependencies;
  delete hydrated.packages["node_modules/tool"].bundleDependencies;
  assert.throws(
    () => validateHydratedLock(original, hydrated, dir),
    /unproven/,
  );
});

test("requires matching installed name and version; absent optional additions fail closed", (t) => {
  const { original, hydrated, dir, location, manifestDir } = fixture(t);
  for (const manifest of [
    { name: "other", version: "1.2.3" },
    { name: "bundled", version: "9.0.0" },
  ]) {
    writeFileSync(join(manifestDir, "package.json"), JSON.stringify(manifest));
    assert.throws(
      () => validateHydratedLock(original, hydrated, dir),
      /identity|mismatched/,
    );
  }
  rmSync(manifestDir, { recursive: true });
  hydrated.packages[location].optional = true;
  assert.throws(() => validateHydratedLock(original, hydrated, dir), /ENOENT/);
});

test("rejects symlinked package directories, including Windows junctions", (t) => {
  const { original, hydrated, dir, manifestDir } = fixture(t);
  const outside = join(dir, "outside");
  mkdirSync(outside);
  writeFileSync(
    join(outside, "package.json"),
    JSON.stringify({ name: "bundled", version: "1.2.3" }),
  );
  rmSync(manifestDir, { recursive: true });
  symlinkSync(
    outside,
    manifestDir,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => validateHydratedLock(original, hydrated, dir), /linked/);
});

test("inventories scoped and nested bundles while ignoring npm metadata", (t) => {
  const f = fixture(t);
  for (const [location, name] of [
    ["node_modules/tool/node_modules/@scope/transitive", "@scope/transitive"],
    [`${f.location}/node_modules/deep`, "deep"],
  ]) {
    const directory = join(f.dir, location);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({ name, version: "2.0.0" }),
    );
    assert.throws(
      () => validateHydratedLock(f.original, f.hydrated, f.dir),
      /missing/,
    );
    f.hydrated.packages[location] = { version: "2.0.0", inBundle: true };
    validateHydratedLock(f.original, f.hydrated, f.dir);
  }
  mkdirSync(join(f.dir, "node_modules/tool/node_modules/.bin"));
  writeFileSync(
    join(f.dir, "node_modules/tool/node_modules/.package-lock.json"),
    "{}",
  );
  validateHydratedLock(f.original, f.hydrated, f.dir);
});

test("unchanged optional bundled roots need not be installed on this platform", (t) => {
  const f = fixture(t);
  rmSync(join(f.dir, "node_modules/tool"), { recursive: true });
  f.original.packages["node_modules/tool"].optional = true;
  validateHydratedLock(f.original, structuredClone(f.original), f.dir);
});

test(
  "rejects symlinked manifest files",
  { skip: process.platform === "win32" },
  (t) => {
    const f = fixture(t);
    const outside = join(f.dir, "outside.json");
    writeFileSync(
      outside,
      JSON.stringify({ name: "bundled", version: "1.2.3" }),
    );
    rmSync(join(f.manifestDir, "package.json"));
    symlinkSync(outside, join(f.manifestDir, "package.json"));
    assert.throws(
      () => validateHydratedLock(f.original, f.hydrated, f.dir),
      /linked/,
    );
  },
);

test("rejects a missing required bundled root", (t) => {
  const f = fixture(t);
  rmSync(join(f.dir, "node_modules/tool"), { recursive: true });
  assert.throws(
    () => validateHydratedLock(f.original, structuredClone(f.original), f.dir),
    /missing required bundled root/,
  );
});

for (const target of ["root", "node_modules"]) {
  test(`rejects a dangling symlink at bundled ${target}`, (t) => {
    const f = fixture(t);
    f.original.packages["node_modules/tool"].optional = true;
    const linked = join(
      f.dir,
      "node_modules/tool",
      target === "root" ? "" : "node_modules",
    );
    rmSync(linked, { recursive: true });
    symlinkSync(
      join(f.dir, "nonexistent"),
      linked,
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(
      () =>
        validateHydratedLock(f.original, structuredClone(f.original), f.dir),
      /linked/,
    );
  });
}
