import assert from "node:assert/strict";
import test from "node:test";
import {
  deploymentCommands,
  deployPreview,
  validatePreviewPrefix,
} from "./deploy-preview.mjs";

const revision = "1".repeat(40);
const credentials = {
  CLOUDFLARE_ACCOUNT_ID: "account",
  CLOUDFLARE_API_TOKEN: "secret",
  CLOUDFLARE_ZONE_ID: "zone",
  PATH: "/trusted/bin",
};

test("preview prefixes are narrow DNS labels", () => {
  assert.equal(validatePreviewPrefix("zoey-2"), "zoey-2");
  for (const value of [
    "Zoey",
    "-zoey",
    "zoey.",
    "pr-12",
    "www",
    "a".repeat(31),
  ])
    assert.throws(() => validatePreviewPrefix(value));
});

test("deployment plan binds the prefix and revision without a shell", () => {
  const plan = deploymentCommands({
    prefix: "zoey",
    revision,
    dirty: true,
    remove: false,
  });
  assert.equal(plan.previewEnvironment.PREVIEW_ACTION, "ensure-manual");
  assert.equal(plan.previewEnvironment.PREVIEW_HEAD_SHA, revision);
  assert.deepEqual(plan.wrangler.slice(1), [
    "pages",
    "deploy",
    "dist",
    "--project-name",
    "atrinik-website",
    "--branch",
    "manual-zoey",
    "--commit-hash",
    revision,
    "--commit-message",
    "manual testing deployment for zoey",
    "--commit-dirty",
    "true",
  ]);
});

test("remove skips build and Wrangler, then invokes the trusted domain helper", async () => {
  const calls = [];
  const result = await deployPreview({
    argv: ["--remove", "zoey"],
    environment: credentials,
    runCommand: async (command, arguments_, options = {}) => {
      calls.push({ command, arguments_, options });
      if (command === "git" && arguments_[0] === "rev-parse") return revision;
      if (command === "git") return "";
      return "";
    },
  });
  assert.equal(result, "https://zoey.testing.atrinik.org/");
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.env.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(calls[1].options.env.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(calls[2].options.env.PREVIEW_ACTION, "remove-manual");
  assert.equal(calls[2].options.env.CLOUDFLARE_API_TOKEN, "secret");
  assert.equal(calls[2].options.env.PREVIEW_PREFIX, "zoey");
});

test("deploy withholds the token from Git and the build", async () => {
  const calls = [];
  await deployPreview({
    argv: ["zoey"],
    environment: {
      ...credentials,
      AWS_SECRET_ACCESS_KEY: "unrelated-secret",
      GITHUB_TOKEN: "github-secret",
    },
    runCommand: async (command, arguments_, options = {}) => {
      calls.push({ command, arguments_, options });
      if (command === "git" && arguments_[0] === "rev-parse") return revision;
      if (command === "git") return " M src/pages/index.astro";
      return "";
    },
  });
  assert.equal(calls.length, 5);
  for (const call of calls.slice(0, 3)) {
    assert.equal(call.options.env.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(call.options.env.CLOUDFLARE_API_TOKEN, undefined);
    assert.equal(call.options.env.GITHUB_TOKEN, undefined);
  }
  assert.equal(calls[3].options.env.CLOUDFLARE_API_TOKEN, "secret");
  assert.equal(calls[4].options.env.CLOUDFLARE_API_TOKEN, "secret");
  for (const call of calls.slice(3)) {
    assert.equal(call.options.env.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(call.options.env.GITHUB_TOKEN, undefined);
    assert.equal(call.options.env.PATH, "/trusted/bin");
  }
  assert.equal(calls[3].options.env.CLOUDFLARE_ZONE_ID, undefined);
  assert.equal(calls[3].options.env.PREVIEW_ACTION, undefined);
  assert.equal(calls[4].options.env.CLOUDFLARE_ZONE_ID, "zone");
  assert.equal(calls[3].arguments_.at(-1), "true");
  assert.equal(calls[4].options.env.PREVIEW_ACTION, "ensure-manual");
});

test("credentials and extra operands fail before any subprocess", async () => {
  await assert.rejects(
    deployPreview({ argv: ["zoey"], environment: {}, runCommand: assert.fail }),
    /CLOUDFLARE_ACCOUNT_ID/u,
  );
  await assert.rejects(
    deployPreview({
      argv: ["zoey", "extra"],
      environment: credentials,
      runCommand: assert.fail,
    }),
    /usage/u,
  );
});
