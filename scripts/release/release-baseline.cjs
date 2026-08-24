"use strict";

const { execFileSync, spawnSync } = require("node:child_process");

const RELEASE_TAG_PATTERN =
  /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function git(cwd, args, input) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    const detail = stderr ? `: ${stderr}` : "";
    throw new Error(`git ${args.join(" ")} failed${detail}`, { cause: error });
  }
}

function gitStatus(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function isAncestor(cwd, ancestor, descendant) {
  const result = gitStatus(cwd, [
    "merge-base",
    "--is-ancestor",
    ancestor,
    descendant,
  ]);
  if (result.status === 0) {
    return true;
  }
  if (result.status === 1) {
    return false;
  }
  const detail = result.stderr.trim();
  throw new Error(
    `git merge-base --is-ancestor failed${detail ? `: ${detail}` : ""}`,
  );
}

function parseReleaseTag(tag) {
  const match = RELEASE_TAG_PATTERN.exec(tag);
  if (!match) {
    return null;
  }
  return {
    tag,
    version: `${match[1]}.${match[2]}.${match[3]}`,
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
  };
}

function compareReleaseTags(left, right) {
  for (const field of ["major", "minor", "patch"]) {
    if (left[field] !== right[field]) {
      return left[field] > right[field] ? 1 : -1;
    }
  }
  return left.tag.localeCompare(right.tag);
}

function listReleaseTags(cwd) {
  const output = git(cwd, [
    "for-each-ref",
    "--format=%(refname:strip=2)%00%(objectname)",
    "refs/tags",
  ]);
  if (!output) {
    return { tags: [], invalidTags: [] };
  }

  const tags = [];
  const invalidTags = [];
  for (const line of output.split("\n")) {
    const [tag, object] = line.split("\0");
    if (tag.startsWith("v") && !parseReleaseTag(tag)) {
      invalidTags.push(tag);
      continue;
    }
    const parsed = parseReleaseTag(tag);
    if (parsed) {
      tags.push({ ...parsed, object });
    }
  }
  return { tags, invalidTags };
}

function resolveTagCommit(cwd, tag) {
  return git(cwd, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${tag}^{commit}`,
  ]);
}

function releaseTagsWithCommits(cwd) {
  const { tags, invalidTags } = listReleaseTags(cwd);
  return {
    invalidTags,
    tags: tags.map((tag) => ({
      ...tag,
      commit: resolveTagCommit(cwd, tag.tag),
    })),
  };
}

function replaceRefs(cwd) {
  const output = git(cwd, ["replace", "-l"]);
  return output ? output.split("\n").filter(Boolean) : [];
}

function rootCommits(cwd) {
  const output = git(cwd, ["rev-list", "--max-parents=0", "HEAD"]);
  return output ? output.split("\n").filter(Boolean) : [];
}

function syntheticRootCommit(cwd, root, baselineCommit) {
  const original = execFileSync("git", ["cat-file", "commit", root], {
    cwd,
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const firstNewline = original.indexOf(0x0a);
  const firstLine = original.subarray(0, firstNewline).toString();
  if (!firstLine.startsWith("tree ")) {
    throw new Error(`root ${root} does not contain a Git tree header`);
  }
  const grafted = Buffer.concat([
    original.subarray(0, firstNewline + 1),
    Buffer.from(`parent ${baselineCommit}\n`),
    original.subarray(firstNewline + 1),
  ]);
  return git(cwd, ["hash-object", "-t", "commit", "-w", "--stdin"], grafted);
}

function validateTagLineage(cwd, tags, selected) {
  for (const tag of tags) {
    if (tag.tag === selected.tag) {
      continue;
    }
    if (!isAncestor(cwd, tag.commit, selected.commit)) {
      throw new Error(
        `release tag history is ambiguous: ${tag.tag} is not an ancestor of ${selected.tag}`,
      );
    }
  }
}

function prepareBaseline(cwd = process.cwd()) {
  const head = git(cwd, ["rev-parse", "HEAD"]);
  if (git(cwd, ["rev-parse", "--is-shallow-repository"]) === "true") {
    throw new Error(
      "cannot recover release history from a shallow repository; fetch complete history first",
    );
  }
  const { tags, invalidTags } = releaseTagsWithCommits(cwd);
  const sortedTags = [...tags].sort(compareReleaseTags);
  const selected = sortedTags.at(-1);

  if (!selected) {
    return {
      active: false,
      head,
      invalidTags,
      reason: "no-valid-release-tags",
    };
  }

  if (isAncestor(cwd, selected.commit, head)) {
    return {
      active: false,
      head,
      invalidTags,
      reason: "latest-release-tag-is-reachable",
      selected,
    };
  }

  validateTagLineage(cwd, sortedTags, selected);

  const existingReplaceRefs = replaceRefs(cwd);
  if (existingReplaceRefs.length > 0) {
    throw new Error(
      `cannot recover release history while Git replace refs exist: ${existingReplaceRefs.join(", ")}`,
    );
  }

  const roots = rootCommits(cwd);
  if (roots.length === 0) {
    throw new Error(
      "cannot recover release history without a current-history root",
    );
  }

  const replacements = [];
  try {
    for (const root of roots) {
      const replacement = syntheticRootCommit(cwd, root, selected.commit);
      git(cwd, ["replace", root, replacement]);
      replacements.push({ root, replacement });
    }
  } catch (error) {
    restoreBaseline({ cwd, replacements, selected });
    throw error;
  }

  if (!isAncestor(cwd, selected.commit, head)) {
    restoreBaseline({ cwd, replacements, selected });
    throw new Error(
      `release baseline ${selected.tag} could not be made reachable from ${head}`,
    );
  }

  return {
    active: true,
    cwd,
    head,
    invalidTags,
    selected,
    replacements,
  };
}

function restoreBaseline(state) {
  if (!state?.active && !state?.replacements?.length) {
    return;
  }
  const cwd = state.cwd;
  const errors = [];
  for (const { root, replacement } of [
    ...(state.replacements || []),
  ].reverse()) {
    try {
      const current = git(cwd, [
        "rev-parse",
        "--verify",
        `refs/replace/${root}`,
      ]);
      if (current !== replacement) {
        throw new Error(
          `replace ref for ${root} changed from ${replacement} to ${current}`,
        );
      }
      git(cwd, ["replace", "-d", root]);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "release baseline cleanup failed");
  }
  state.replacements = [];
  state.active = false;
}

async function withReleaseBaseline(cwd, callback) {
  const state = prepareBaseline(cwd);
  try {
    return await callback(state);
  } finally {
    restoreBaseline(state);
  }
}

module.exports = {
  compareReleaseTags,
  listReleaseTags,
  parseReleaseTag,
  prepareBaseline,
  releaseTagsWithCommits,
  replaceRefs,
  restoreBaseline,
  withReleaseBaseline,
};
