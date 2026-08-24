"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");

const {
  parseReleaseTag,
  prepareBaseline,
  replaceRefs,
  restoreBaseline,
  withReleaseBaseline,
} = require("./release-baseline.cjs");

function git(cwd, args, input) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "atrinik-release-baseline-"));
  git(cwd, ["init", "--quiet", "--initial-branch=main"]);
  git(cwd, ["config", "user.name", "Release test"]);
  git(cwd, ["config", "user.email", "release-test@example.invalid"]);
  return cwd;
}

function commit(cwd, message, allowEmpty = false) {
  const args = ["commit", "--quiet"];
  if (allowEmpty) {
    args.push("--allow-empty");
  }
  args.push("-m", message);
  return git(cwd, args);
}

function cleanup(cwd) {
  rmSync(cwd, { recursive: true, force: true });
}

test("parses only canonical stable release tags", () => {
  assert.equal(parseReleaseTag("v2.3.4").version, "2.3.4");
  assert.equal(parseReleaseTag("v01.2.3"), null);
  assert.equal(parseReleaseTag("v2.3"), null);
  assert.equal(parseReleaseTag("v2.3.4-rc.1"), null);
});

test("recovers an unreachable release tag without changing its object", async () => {
  const cwd = fixture();
  try {
    commit(cwd, "chore: publish historical baseline", true);
    const historical = git(cwd, ["rev-parse", "HEAD"]);
    git(cwd, ["tag", "-a", "v1.0.0", historical, "-m", "v1.0.0"]);
    const tagObject = git(cwd, ["rev-parse", "refs/tags/v1.0.0"]);

    git(cwd, ["checkout", "--quiet", "--orphan", "mainline"]);
    commit(cwd, "feat: rebuild the website history", true);
    const head = git(cwd, ["rev-parse", "HEAD"]);

    const state = prepareBaseline(cwd);
    assert.equal(state.active, true);
    assert.equal(git(cwd, ["tag", "--merged", "HEAD"]), "v1.0.0");
    assert.equal(git(cwd, ["rev-list", "-1", "v1.0.0"]), historical);
    assert.equal(git(cwd, ["rev-parse", "refs/tags/v1.0.0"]), tagObject);
    assert.equal(
      git(cwd, ["log", "--format=%s", "v1.0.0..HEAD"]),
      "feat: rebuild the website history",
    );
    assert.doesNotThrow(() => git(cwd, ["tag", "v1.1.0", head]));
    assert.equal(
      git(cwd, ["merge-base", "--is-ancestor", "v1.0.0", "HEAD"]),
      "",
    );

    restoreBaseline(state);
    assert.deepEqual(replaceRefs(cwd), []);
    assert.equal(git(cwd, ["rev-parse", "refs/tags/v1.0.0"]), tagObject);
    assert.equal(git(cwd, ["rev-list", "-1", "v1.0.0"]), historical);
    assert.equal(git(cwd, ["rev-list", "-1", "v1.1.0"]), head);
  } finally {
    cleanup(cwd);
  }
});

test("ignores malformed tags when no valid baseline exists", () => {
  const cwd = fixture();
  try {
    commit(cwd, "feat: initial site", true);
    git(cwd, ["tag", "v1.2"]);
    const state = prepareBaseline(cwd);
    assert.equal(state.active, false);
    assert.equal(state.reason, "no-valid-release-tags");
    assert.deepEqual(state.invalidTags, ["v1.2"]);
  } finally {
    cleanup(cwd);
  }
});

test("selects the highest historical tag and is idempotent during cleanup", async () => {
  const cwd = fixture();
  try {
    commit(cwd, "chore: historical release one", true);
    const old = git(cwd, ["rev-parse", "HEAD"]);
    git(cwd, ["tag", "v1.0.0"]);
    commit(cwd, "chore: historical release two", true);
    git(cwd, ["tag", "v1.1.0"]);

    git(cwd, ["checkout", "--quiet", "--orphan", "mainline"]);
    commit(cwd, "feat: recover the release line", true);

    const state = await withReleaseBaseline(cwd, async (active) => {
      assert.equal(active.selected.tag, "v1.1.0");
      assert.equal(replaceRefs(cwd).length, 1);
      const second = prepareBaseline(cwd);
      assert.equal(second.active, false);
      assert.equal(second.reason, "latest-release-tag-is-reachable");
      restoreBaseline(second);
      assert.equal(git(cwd, ["rev-list", "-1", "v1.0.0"]), old);
      return active;
    });
    assert.equal(state.active, false);
    assert.deepEqual(replaceRefs(cwd), []);
  } finally {
    cleanup(cwd);
  }
});

test("preserves a pre-existing replace-ref safety boundary", () => {
  const cwd = fixture();
  try {
    commit(cwd, "chore: historical baseline", true);
    const historical = git(cwd, ["rev-parse", "HEAD"]);
    git(cwd, ["tag", "v1.0.0", historical]);
    git(cwd, ["checkout", "--quiet", "--orphan", "mainline"]);
    commit(cwd, "feat: current history", true);
    const firstBlob = git(cwd, ["hash-object", "-w", "--stdin"], "first");
    const secondBlob = git(cwd, ["hash-object", "-w", "--stdin"], "second");
    git(cwd, ["replace", firstBlob, secondBlob]);
    assert.throws(() => prepareBaseline(cwd), /replace refs exist/);
    git(cwd, ["replace", "-d", firstBlob]);
  } finally {
    cleanup(cwd);
  }
});

test("fails closed when release tags do not form one lineage", () => {
  const cwd = fixture();
  try {
    commit(cwd, "chore: first release line", true);
    git(cwd, ["tag", "v1.0.0"]);
    git(cwd, ["checkout", "--quiet", "--orphan", "second-line"]);
    commit(cwd, "chore: unrelated release line", true);
    git(cwd, ["tag", "v2.0.0"]);
    git(cwd, ["checkout", "--quiet", "--orphan", "mainline"]);
    commit(cwd, "feat: current history", true);

    assert.throws(
      () => prepareBaseline(cwd),
      /release tag history is ambiguous/,
    );
    assert.deepEqual(replaceRefs(cwd), []);
  } finally {
    cleanup(cwd);
  }
});

test("cleans the temporary baseline when the semantic-release child exits", () => {
  const cwd = fixture();
  try {
    commit(cwd, "chore: historical baseline", true);
    const historical = git(cwd, ["rev-parse", "HEAD"]);
    git(cwd, ["tag", "v1.0.0", historical]);
    const tagObject = git(cwd, ["rev-parse", "refs/tags/v1.0.0"]);
    git(cwd, ["checkout", "--quiet", "--orphan", "mainline"]);
    commit(cwd, "feat: current history", true);

    const wrapper = join(__dirname, "run-semantic-release.cjs");
    const result = spawnSync(process.execPath, [wrapper, "--version"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^\d+\.\d+\.\d+/);
    assert.deepEqual(replaceRefs(cwd), []);
    assert.equal(git(cwd, ["rev-parse", "refs/tags/v1.0.0"]), tagObject);
  } finally {
    cleanup(cwd);
  }
});
