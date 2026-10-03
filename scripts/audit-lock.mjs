// Copyright (C) 2026 Atrinik contributors
// SPDX-License-Identifier: MIT

import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

const preservedFields = [
  "name",
  "version",
  "resolved",
  "integrity",
  "link",
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "bundleDependencies",
  "bundledDependencies",
];

function fail(message) {
  throw new Error(`Unsafe audit lock hydration: ${message}`);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Lockfile paths always use '/' even on Windows. Accept only package locations,
// never filesystem syntax such as drive letters, traversal or alternate streams.
function packageName(location) {
  const parts = location.split("/");
  let name;
  while (parts.length) {
    if (parts.shift() !== "node_modules")
      fail(`invalid package path ${location}`);
    name = parts.shift();
    if (name?.startsWith("@")) name += `/${parts.shift() ?? ""}`;
    if (
      !name ||
      !/^(?:@[a-zA-Z0-9_~-][a-zA-Z0-9_.~-]*\/)?[a-zA-Z0-9_~-][a-zA-Z0-9_.~-]*$/.test(
        name,
      ) ||
      name.split("/").some((part) => part.endsWith("."))
    ) {
      fail(`invalid package path ${location}`);
    }
  }
  return name;
}

function installedManifest(installDir, location) {
  let current = resolve(installDir);
  const root = lstatSync(current);
  if (!root.isDirectory() || root.isSymbolicLink())
    fail("invalid install root");
  for (const part of location.split("/")) {
    current = join(current, part);
    const entry = lstatSync(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      fail(`linked or invalid installed directory ${location}`);
    }
  }
  const file = join(current, "package.json");
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
    fail(`linked or invalid installed manifest ${location}`);
  }
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (!object(manifest)) fail(`invalid installed manifest ${location}`);
  return manifest;
}

// Audit must include every installed package below a bundled root, including
// transitive bundles absent from the source lock. Merely approving additions
// would also approve a successful hydration command that added nothing.
function optionalStat(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

function validateBundleInventory(
  installDir,
  bundleRoot,
  originalRecord,
  hydrated,
) {
  const visit = (modulesLocation) => {
    const modulesDir = join(installDir, modulesLocation);
    const stat = optionalStat(modulesDir);
    if (!stat) return;
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail(`linked or invalid bundled inventory ${modulesLocation}`);
    }
    const inspect = (location) => {
      packageName(location);
      const manifest = installedManifest(installDir, location);
      const record = hydrated[location];
      if (
        !Object.hasOwn(hydrated, location) ||
        record.version !== manifest.version ||
        (record.name ?? packageName(location)) !== manifest.name
      ) {
        fail(`missing or mismatched installed bundle ${location}`);
      }
      visit(`${location}/node_modules`);
    };
    for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const location = `${modulesLocation}/${entry.name}`;
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        fail(`linked or invalid bundled package ${location}`);
      }
      if (entry.name.startsWith("@")) {
        for (const child of readdirSync(join(installDir, location))) {
          inspect(`${location}/${child}`);
        }
      } else {
        inspect(location);
      }
    }
  };
  // Platform-specific optional bundle roots may legitimately be absent. New
  // records remain subject to the stricter installed-manifest check below.
  const rootStat = optionalStat(join(installDir, bundleRoot));
  if (!rootStat) {
    if (originalRecord.optional !== true) {
      fail(`missing required bundled root ${bundleRoot}`);
    }
    return;
  }
  installedManifest(installDir, bundleRoot);
  visit(`${bundleRoot}/node_modules`);
}

/**
 * Permit npm to discover missing bundled records, never to change locked inputs.
 * Both locks and installDir belong to the same isolated, scripts-disabled install.
 * Throws on any unproven change; callers must not audit a rejected hydrated lock.
 */
export function validateHydratedLock(originalLock, hydratedLock, installDir) {
  for (const lock of [originalLock, hydratedLock]) {
    if (
      !object(lock) ||
      ![2, 3].includes(lock.lockfileVersion) ||
      !object(lock.packages) ||
      !object(lock.packages[""])
    ) {
      fail("unsupported or malformed lockfile");
    }
    for (const [location, record] of Object.entries(lock.packages)) {
      if (location !== "") packageName(location);
      if (!object(record)) fail(`invalid package record ${location}`);
    }
  }
  const { packages: original, ...originalContract } = originalLock;
  const { packages: hydrated, ...hydratedContract } = hydratedLock;
  if (
    !isDeepStrictEqual(originalContract, hydratedContract) ||
    !isDeepStrictEqual(original[""], hydrated[""])
  ) {
    fail("root lock contract changed");
  }
  for (const [location, record] of Object.entries(original)) {
    if (!Object.hasOwn(hydrated, location)) fail(`removed package ${location}`);
    for (const field of preservedFields) {
      if (!isDeepStrictEqual(record[field], hydrated[location][field])) {
        fail(`changed ${field} for ${location || "root"}`);
      }
    }
  }
  const bundleRoots = Object.entries(original)
    .filter(
      ([location, record]) =>
        location !== "" &&
        !record.link &&
        Array.isArray(record.bundleDependencies) &&
        record.bundleDependencies.length > 0,
    )
    .map(([location]) => location);
  for (const root of bundleRoots) {
    validateBundleInventory(installDir, root, original[root], hydrated);
  }
  for (const [location, record] of Object.entries(hydrated)) {
    if (Object.hasOwn(original, location)) continue;
    if (
      record.inBundle !== true ||
      record.link ||
      !bundleRoots.some((root) => location.startsWith(`${root}/node_modules/`))
    ) {
      fail(`unproven bundled addition ${location}`);
    }
    const manifest = installedManifest(installDir, location);
    const name = record.name ?? packageName(location);
    if (
      typeof record.version !== "string" ||
      !record.version ||
      manifest.name !== name ||
      manifest.version !== record.version
    ) {
      fail(`installed identity mismatch for ${location}`);
    }
  }
}
