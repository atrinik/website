// Copyright (C) 2026 Atrinik contributors
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("configured release-note plugin renders Conventional Commit notes", async () => {
  const configuration = JSON.parse(
    await readFile(new URL("../../.releaserc.json", import.meta.url), "utf8"),
  );
  const entry = configuration.plugins.find(
    (plugin) =>
      Array.isArray(plugin) &&
      plugin[0] === "@semantic-release/release-notes-generator",
  );
  assert.ok(entry, "the configured release-note generator must be exercised");
  const [plugin, options] = entry;
  const { generateNotes } = await import(plugin);
  const notes = await generateNotes(options, {
    cwd: root,
    options: { repositoryUrl: "https://github.com/atrinik/website.git" },
    commits: [
      {
        hash: "a".repeat(40),
        message: "feat(downloads): show supported platforms",
      },
      {
        hash: "b".repeat(40),
        message: "fix(links): repair download links\n\nCloses #123",
      },
      {
        hash: "c".repeat(40),
        message:
          "feat(metadata)!: require artifact digests\n\nBREAKING CHANGE: Catalog entries must include an artifact digest.",
      },
    ],
    lastRelease: {
      version: "1.0.0",
      gitTag: "v1.0.0",
      gitHead: "d".repeat(40),
    },
    nextRelease: {
      version: "2.0.0",
      gitTag: "v2.0.0",
      gitHead: "e".repeat(40),
    },
  });

  assert.match(notes, /Features/);
  assert.match(notes, /Bug Fixes/);
  assert.match(notes, /BREAKING CHANGES/);
  assert.match(notes, /show supported platforms/);
  assert.match(notes, /repair download links/);
  assert.match(notes, /Catalog entries must include an artifact digest\./);
  const destinations = new Set(
    Array.from(notes.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g), (match) => match[1]),
  );
  assert.ok(
    destinations.has(
      "https://github.com/atrinik/website/compare/v1.0.0...v2.0.0",
    ),
  );
  assert.ok(destinations.has("https://github.com/atrinik/website/issues/123"));
  assert.ok(
    destinations.has(
      `https://github.com/atrinik/website/commit/${"a".repeat(40)}`,
    ),
  );
});
