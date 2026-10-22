import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test, { mock } from "node:test";
import {
  WEBHOOK_BODY_LIMIT,
  handleClassicDownload,
  handleGithubRelease,
  handleStatus,
  memoryStatusCache,
  verifyGithubSignature,
} from "../server/handlers.js";
import { isDownloadRecord, isStatusResponse } from "../server/record.js";
import {
  parseChecksums,
  parseReleaseNotes,
  refreshDownloadRecord,
  environmentFor,
  storageKeys,
} from "../server/releases.js";
import { parseDirectory } from "../server/status.js";

// Refresh failures log reason codes; keep test output readable.
mock.method(console, "warn", () => {});

const NOW = Date.parse("2026-10-22T12:00:00Z");
const SECRET = "test-webhook-secret";
const sha = (text) => createHash("sha256").update(text).digest("hex");
const commitFor = (tag) => createHash("sha1").update(tag).digest("hex");

// Tests use pages.dev request URLs and env without ATRINIK_PRODUCTION, so they
// read and write the preview key namespace.
const RECORD_KEY = storageKeys({}).record;
const GATE_KEY = storageKeys({}).refreshGate;

/** In-memory KV with expirationTtl measured against `time`. */
class MemoryKv {
  constructor(entries = {}) {
    this.store = new Map(Object.entries(entries));
    this.expires = new Map();
    this.puts = [];
    this.time = NOW;
  }
  async get(key) {
    if ((this.expires.get(key) ?? Infinity) <= this.time) {
      this.store.delete(key);
      this.expires.delete(key);
    }
    return this.store.get(key) ?? null;
  }
  async put(key, value, options) {
    this.puts.push({ key, value, options });
    this.store.set(key, value);
    if (options?.expirationTtl)
      this.expires.set(key, this.time + options.expirationTtl * 1000);
    else this.expires.delete(key);
  }
  putsTo(key) {
    return this.puts.filter((put) => put.key === key).length;
  }
}

function makeRelease(version, overrides = {}) {
  const tag = `v${version}`;
  const root = `https://github.com/atrinik/classic/releases/download/${tag}`;
  const names = [
    `atrinik-classic-${version}.spdx.json`,
    `atrinik-classic-client-${version}-linux-x86_64.AppImage`,
    `atrinik-classic-client-${version}-windows-x86_64.zip`,
    `atrinik-classic-server-${version}-windows-x86_64.zip`,
  ];
  const assets = names.map((name, index) => ({
    name,
    state: "uploaded",
    size: 1000 + index,
    digest: `sha256:${sha(`${tag}/${name}`)}`,
    browser_download_url: `${root}/${name}`,
  }));
  const sums = `${assets
    .map(({ name, digest }) => `${digest.slice(7)}  ${name}`)
    .join("\n")}\n`;
  assets.push({
    name: "SHA256SUMS",
    state: "uploaded",
    size: sums.length,
    digest: `sha256:${sha(sums)}`,
    browser_download_url: `${root}/SHA256SUMS`,
  });
  return {
    release: {
      tag_name: tag,
      draft: false,
      prerelease: false,
      immutable: true,
      published_at: "2026-10-22T00:34:38Z",
      html_url: `https://github.com/atrinik/classic/releases/tag/${tag}`,
      body: `## [${version}](https://example.invalid)\n\n### Features\n\n* **client:** add a thing ([#1](https://github.com/atrinik/classic/issues/1)) ([abc1234](https://github.com/atrinik/classic/commit/abc1234))\n\n### Bug Fixes\n\n* fix another thing ([#2](https://github.com/atrinik/classic/issues/2))\n`,
      assets,
      ...overrides,
    },
    sums,
  };
}

function directory(servers, overrides = {}) {
  return {
    schema: "atrinik-classic-directory-v6",
    protocol: 6,
    generation: "1",
    generatedAt: NOW / 1000 - 60,
    expiresAt: NOW / 1000 + 86_400,
    servers,
    ...overrides,
  };
}

const officialEntry = (version, extra = {}) => ({
  serverId: "x",
  name: "Atrinik Official Server",
  playersCount: 3,
  version,
  textComment: "<b>untrusted</b>",
  certificateSha256: "y",
  accessRequired: false,
  endpoint: { hostname: "game.atrinik.com", port: 1730 },
  ...extra,
});

/**
 * Builds a mocked upstream. `protocols` maps tags to protocol versions.
 */
function upstream({
  releases,
  sums = {},
  protocols = {},
  server = officialEntry("5.106.0"),
  directoryStatus = 200,
  releasesStatus = 200,
  tagReleases = {},
}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url: url.href, headers: init.headers ?? {} });
    const json = (value, status = 200) =>
      new Response(JSON.stringify(value), { status });
    if (url.href === "https://classic.meta.atrinik.org/index.json") {
      if (directoryStatus !== 200)
        return new Response("", { status: directoryStatus });
      return json(directory(server ? [server] : []));
    }
    if (url.hostname === "api.github.com") {
      const single =
        /^\/repos\/atrinik\/classic\/releases\/tags\/(v[0-9.]+)$/u.exec(
          url.pathname,
        );
      if (single && tagReleases[single[1]] !== undefined) {
        const { status = 200, body } = tagReleases[single[1]];
        return status === 200 ? json(body) : new Response("", { status });
      }
      if (url.pathname === "/repos/atrinik/classic/releases") {
        if (releasesStatus !== 200)
          return new Response("", { status: releasesStatus });
        return json(releases);
      }
      const ref =
        /^\/repos\/atrinik\/classic\/git\/ref\/tags\/(v[0-9.]+)$/u.exec(
          url.pathname,
        );
      if (ref && protocols[ref[1]] !== undefined)
        return json({ object: { sha: commitFor(ref[1]), type: "commit" } });
      return new Response("", { status: 404 });
    }
    if (url.hostname === "raw.githubusercontent.com") {
      const tag = Object.keys(protocols).find((candidate) =>
        url.pathname.startsWith(`/atrinik/classic/${commitFor(candidate)}/`),
      );
      if (tag) return json({ protocol_version: protocols[tag] });
      return new Response("", { status: 404 });
    }
    if (url.hostname === "github.com") {
      const match = /\/download\/(v[0-9.]+)\/SHA256SUMS$/u.exec(url.pathname);
      if (match)
        return new Response(null, {
          status: 302,
          headers: {
            location: `https://release-assets.githubusercontent.com/sums/${match[1]}`,
          },
        });
    }
    if (url.hostname === "release-assets.githubusercontent.com") {
      const tag = url.pathname.split("/").at(-1);
      if (sums[tag] !== undefined) return new Response(sums[tag]);
    }
    return new Response("", { status: 404 });
  };
  return { fetch: fetchImpl, calls };
}

function deps(mock, now = NOW) {
  return { fetch: mock.fetch, now: () => now };
}

function context(request, env) {
  const pending = [];
  return {
    request,
    env,
    waitUntil: (promise) => pending.push(promise),
    pending,
  };
}

function standardReleases() {
  const newest = makeRelease("5.108.0");
  const middle = makeRelease("5.107.0");
  const matching = makeRelease("5.106.0");
  return {
    releases: [newest.release, middle.release, matching.release],
    sums: {
      "v5.108.0": newest.sums,
      "v5.107.0": middle.sums,
      "v5.106.0": matching.sums,
    },
  };
}

function signed(body, { event = "release", signature, length } = {}) {
  const headers = {
    "content-type": "application/json",
    "x-github-event": event,
    "x-hub-signature-256":
      signature ??
      `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`,
  };
  if (length !== undefined) headers["content-length"] = String(length);
  return new Request(
    "https://preview.atrinik-website.pages.dev/api/github/release",
    {
      method: "POST",
      headers,
      body,
    },
  );
}

test("webhook signatures are verified over the raw body", async () => {
  const body = new TextEncoder().encode('{"a":1}');
  const good = `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
  assert.equal(await verifyGithubSignature(SECRET, good, body), true);
  assert.equal(
    await verifyGithubSignature(
      SECRET,
      good,
      new TextEncoder().encode('{"a":2}'),
    ),
    false,
  );
  assert.equal(await verifyGithubSignature("other", good, body), false);
  assert.equal(await verifyGithubSignature(SECRET, null, body), false);
  assert.equal(await verifyGithubSignature(SECRET, "sha1=abc", body), false);
  assert.equal(
    await verifyGithubSignature(SECRET, good.toUpperCase(), body),
    false,
  );
});

test("webhook rejects unsigned, mis-signed, oversized and foreign requests", async () => {
  const kv = new MemoryKv();
  const env = { DOWNLOADS: kv, GITHUB_WEBHOOK_SECRET: SECRET };
  const mock = upstream(standardReleases());
  const body = JSON.stringify({ repository: { full_name: "atrinik/classic" } });

  const missing = new Request(
    "https://preview.atrinik-website.pages.dev/api/github/release",
    {
      method: "POST",
      body,
    },
  );
  assert.equal(
    (await handleGithubRelease(context(missing, env), deps(mock))).status,
    401,
  );
  const invalid = signed(body, { signature: `sha256=${"0".repeat(64)}` });
  assert.equal(
    (await handleGithubRelease(context(invalid, env), deps(mock))).status,
    401,
  );

  const declaredLarge = signed(body, { length: WEBHOOK_BODY_LIMIT + 1 });
  assert.equal(
    (await handleGithubRelease(context(declaredLarge, env), deps(mock))).status,
    413,
  );
  const actualLarge = new Request(
    "https://preview.atrinik-website.pages.dev/api/github/release",
    {
      method: "POST",
      headers: {
        "x-github-event": "release",
        "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(WEBHOOK_BODY_LIMIT));
          controller.enqueue(new Uint8Array(1));
          controller.close();
        },
      }),
      duplex: "half",
    },
  );
  assert.equal(
    (await handleGithubRelease(context(actualLarge, env), deps(mock))).status,
    413,
  );

  const foreign = JSON.stringify({
    repository: { full_name: "atrinik/website" },
  });
  assert.equal(
    (await handleGithubRelease(context(signed(foreign), env), deps(mock)))
      .status,
    422,
  );
  assert.equal(
    (
      await handleGithubRelease(
        context(signed(body, { event: "push" }), env),
        deps(mock),
      )
    ).status,
    400,
  );
  const unconfigured = await handleGithubRelease(
    context(signed(body), { DOWNLOADS: kv }),
    deps(mock),
  );
  assert.equal(unconfigured.status, 503);
  const get = await handleGithubRelease(
    context(
      new Request(
        "https://preview.atrinik-website.pages.dev/api/github/release",
      ),
      env,
    ),
    deps(mock),
  );
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
  assert.equal(mock.calls.length, 0, "no upstream request before acceptance");
  assert.equal(kv.puts.length, 0);
});

test("a signed ping is acknowledged and a signed release triggers a recompute", async () => {
  const kv = new MemoryKv();
  const env = { DOWNLOADS: kv, GITHUB_WEBHOOK_SECRET: SECRET };
  const fixture = standardReleases();
  const mock = upstream({
    ...fixture,
    protocols: { "v5.108.0": 1086, "v5.107.0": 1086, "v5.106.0": 1085 },
  });
  const ping = await handleGithubRelease(
    context(signed("{}", { event: "ping" }), env),
    deps(mock),
  );
  assert.equal(ping.status, 204);

  const body = JSON.stringify({
    action: "published",
    repository: { full_name: "atrinik/classic" },
    release: { assets: [{ browser_download_url: "https://evil.example/x" }] },
  });
  const ctx = context(signed(body), env);
  const response = await handleGithubRelease(ctx, deps(mock));
  assert.equal(response.status, 202);
  assert.equal(ctx.pending.length, 1);
  await Promise.all(ctx.pending);
  const record = JSON.parse(kv.store.get(RECORD_KEY));
  assert.equal(record.version, "5.106.0");
  assert.ok(mock.calls.every(({ url }) => !url.includes("evil.example")));
  // The webhook restarted the visit gate's 15-minute window.
  assert.equal(
    kv.puts.find(({ key }) => key === GATE_KEY).options.expirationTtl,
    900,
  );

  // A replay or burst within a minute triggers no second refresh.
  const replay = context(signed(body), env);
  assert.equal((await handleGithubRelease(replay, deps(mock))).status, 202);
  assert.equal(replay.pending.length, 0);
  kv.time += 61_000;
  const later = context(signed(body), env);
  assert.equal((await handleGithubRelease(later, deps(mock))).status, 202);
  assert.equal(later.pending.length, 1);
  await Promise.all(later.pending);
});

test("release actions other than published, edited and deleted are no-ops", async () => {
  const kv = new MemoryKv();
  const env = { DOWNLOADS: kv, GITHUB_WEBHOOK_SECRET: SECRET };
  const mock = upstream(standardReleases());
  for (const action of ["created", "prereleased", "released", undefined]) {
    const ctx = context(
      signed(
        JSON.stringify({
          action,
          repository: { full_name: "atrinik/classic" },
        }),
      ),
      env,
    );
    assert.equal((await handleGithubRelease(ctx, deps(mock))).status, 204);
    assert.equal(ctx.pending.length, 0);
  }
  assert.equal(kv.puts.length, 0);
  for (const action of ["published", "edited", "deleted"]) {
    kv.time += 61_000;
    const ctx = context(
      signed(
        JSON.stringify({
          action,
          repository: { full_name: "atrinik/classic" },
        }),
      ),
      env,
    );
    assert.equal((await handleGithubRelease(ctx, deps(mock))).status, 202);
    assert.equal(ctx.pending.length, 1, action);
  }
});

test("selection picks the newest verified release matching the server protocol", async () => {
  const kv = new MemoryKv();
  const fixture = standardReleases();
  const mock = upstream({
    ...fixture,
    protocols: { "v5.108.0": 1086, "v5.107.0": 1085, "v5.106.0": 1085 },
  });
  const result = await refreshDownloadRecord(
    { DOWNLOADS: kv, GITHUB_TOKEN: "token-value" },
    deps(mock),
  );
  assert.equal(result.outcome, "updated");
  const record = result.record;
  assert.ok(isDownloadRecord(record));
  assert.equal(record.version, "5.107.0");
  assert.equal(record.serverMatch, true);
  assert.deepEqual(record.server, { version: "5.106.0" });
  assert.equal(record.protocol, 1085);
  assert.equal(record.commit, commitFor("v5.107.0"));
  assert.equal(
    record.platforms.linux.url,
    "https://github.com/atrinik/classic/releases/download/v5.107.0/atrinik-classic-client-5.107.0-linux-x86_64.AppImage",
  );
  assert.equal(record.files.length, 5);
  assert.deepEqual(record.notes, [
    { kind: "feature", scope: "client", text: "add a thing" },
    { kind: "fix", text: "fix another thing" },
  ]);
  assert.equal(record.checkedAt, new Date(NOW).toISOString());
  assert.deepEqual(JSON.parse(kv.store.get(RECORD_KEY)), record);
  // The token reaches only the GitHub API host.
  for (const call of mock.calls)
    assert.equal(
      "Authorization" in call.headers,
      new URL(call.url).hostname === "api.github.com",
      call.url,
    );
  // Protocol lookups are cached by tag and commit.
  assert.equal(
    kv.store.get(storageKeys({}).protocol(commitFor("v5.107.0"))),
    "1085",
  );
  assert.ok(!mock.calls.some(({ url }) => url.includes("release-manifest")));
});

test("checksum mismatches, missing assets, mutable and draft releases are skipped", async () => {
  const mismatch = makeRelease("5.110.0");
  const tampered = mismatch.sums.replace(
    /^[0-9a-f]{64}(?=  atrinik-classic-client-5\.110\.0-windows)/mu,
    "f".repeat(64),
  );
  mismatch.release.assets.find((asset) => asset.name === "SHA256SUMS").digest =
    `sha256:${sha(tampered)}`;
  const missingLinux = makeRelease("5.109.0");
  missingLinux.release.assets = missingLinux.release.assets.filter(
    ({ name }) => !name.endsWith(".AppImage"),
  );
  const mutable = makeRelease("5.108.0", { immutable: false });
  const draft = makeRelease("5.107.5", { draft: true });
  const prerelease = makeRelease("5.107.4", { prerelease: true });
  const noDigest = makeRelease("5.107.3");
  delete noDigest.release.assets.find(
    ({ name }) => name.endsWith(".zip") && name.includes("client"),
  ).digest;
  const good = makeRelease("5.107.0");
  const protocols = Object.fromEntries(
    [
      "5.110.0",
      "5.109.0",
      "5.108.0",
      "5.107.5",
      "5.107.4",
      "5.107.3",
      "5.107.0",
      "5.106.0",
    ].map((version) => [`v${version}`, 1085]),
  );
  const mock = upstream({
    releases: [
      mismatch,
      missingLinux,
      mutable,
      draft,
      prerelease,
      noDigest,
      good,
    ].map(({ release }) => release),
    sums: { "v5.110.0": tampered, "v5.107.0": good.sums },
    protocols,
  });
  const kv = new MemoryKv();
  const result = await refreshDownloadRecord({ DOWNLOADS: kv }, deps(mock));
  assert.equal(result.record?.version, "5.107.0");

  assert.equal(parseChecksums("abc  file\n"), null);
  assert.equal(parseChecksums(`${"a".repeat(64)}  ../evil\n`), null);
  assert.equal(
    parseChecksums(`${"a".repeat(64)}  same\n${"b".repeat(64)}  same\n`),
    null,
  );
  assert.equal(parseChecksums(""), null);
  assert.equal(parseChecksums(`${"a".repeat(64)}  ok\n\n`), null);
  assert.deepEqual(
    [...parseChecksums(`${"a".repeat(64)}  ok\n${"b".repeat(64)} *bin\n`)],
    [
      ["ok", "a".repeat(64)],
      ["bin", "b".repeat(64)],
    ],
  );
});

test("a checksum file that differs from its own API digest is rejected", async () => {
  const release = makeRelease("5.106.0");
  const mock = upstream({
    releases: [release.release],
    sums: { "v5.106.0": `${release.sums}${"c".repeat(64)}  extra\n` },
    protocols: { "v5.106.0": 1085 },
  });
  const result = await refreshDownloadRecord(
    { DOWNLOADS: new MemoryKv() },
    deps(mock),
  );
  assert.equal(result.outcome, "unavailable");
});

test("an unreachable or missing official server keeps the stored record", async () => {
  const fixture = standardReleases();
  const protocols = { "v5.108.0": 1086, "v5.107.0": 1085, "v5.106.0": 1085 };
  const seed = await refreshDownloadRecord(
    { DOWNLOADS: new MemoryKv() },
    deps(upstream({ ...fixture, protocols })),
  );
  const stored = JSON.stringify(seed.record);
  for (const options of [{ directoryStatus: 500 }, { server: null }]) {
    const kv = new MemoryKv({ [RECORD_KEY]: stored });
    const mock = upstream({ ...fixture, protocols, ...options });
    const result = await refreshDownloadRecord(
      { DOWNLOADS: kv },
      deps(mock, NOW + 3_600_000),
    );
    assert.equal(result.outcome, "kept");
    assert.equal(kv.store.get(RECORD_KEY), stored);
    assert.equal(kv.puts.length, 0);
  }
  // A failed release listing or no matching release also keeps it.
  for (const options of [
    { releasesStatus: 502 },
    {
      protocols: { ...protocols, "v5.107.0": 1, "v5.108.0": 1 },
      releases: fixture.releases.slice(0, 2),
    },
  ]) {
    const kv = new MemoryKv({ [RECORD_KEY]: stored });
    const result = await refreshDownloadRecord(
      { DOWNLOADS: kv },
      deps(upstream({ ...fixture, protocols, ...options })),
    );
    assert.equal(result.outcome, "kept");
    assert.equal(kv.store.get(RECORD_KEY), stored);
  }
});

test("without a stored record an unknown server falls back to the newest verified release", async () => {
  const fixture = standardReleases();
  const mock = upstream({
    ...fixture,
    server: null,
    protocols: { "v5.108.0": 1086, "v5.107.0": 1085, "v5.106.0": 1085 },
  });
  const result = await refreshDownloadRecord(
    { DOWNLOADS: new MemoryKv() },
    deps(mock),
  );
  assert.equal(result.record?.version, "5.108.0");
  assert.equal(result.record?.serverMatch, false);
  assert.equal(result.record?.server, null);
});

test("the download endpoint serves, refreshes stale records once, and fails closed", async () => {
  const fixture = standardReleases();
  const protocols = { "v5.108.0": 1085, "v5.107.0": 1085, "v5.106.0": 1085 };
  const request = new Request(
    "https://preview.atrinik-website.pages.dev/api/downloads/classic",
  );

  // Empty store with a failing upstream: one synchronous attempt, then 503.
  const emptyKv = new MemoryKv();
  const failing = upstream({
    ...fixture,
    protocols,
    directoryStatus: 500,
    releasesStatus: 500,
  });
  const failed = await handleClassicDownload(
    context(request, { DOWNLOADS: emptyKv }),
    deps(failing),
  );
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { available: false });
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.equal(failed.headers.get("x-content-type-options"), "nosniff");

  // Missing binding.
  const unbound = await handleClassicDownload(
    context(request, {}),
    deps(failing),
  );
  assert.equal(unbound.status, 503);

  // Empty store with a healthy upstream: synchronous refresh.
  const kv = new MemoryKv();
  const healthy = upstream({ ...fixture, protocols });
  const first = await handleClassicDownload(
    context(request, { DOWNLOADS: kv }),
    deps(healthy),
  );
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "public, max-age=60");
  assert.match(first.headers.get("content-type"), /^application\/json/u);
  const body = await first.json();
  assert.equal(body.version, "5.108.0");

  assert.equal(kv.putsTo(RECORD_KEY), 1);

  // Within the gate's 15-minute window: served, no refresh scheduled.
  kv.time = NOW + 14 * 60_000;
  const freshCtx = context(request, { DOWNLOADS: kv });
  assert.equal(
    (await handleClassicDownload(freshCtx, deps(healthy, kv.time))).status,
    200,
  );
  assert.equal(freshCtx.pending.length, 0);

  // After the window: served immediately, refreshed once in the background.
  kv.time = NOW + 16 * 60_000;
  const staleCtx = context(request, { DOWNLOADS: kv });
  const stale = await handleClassicDownload(staleCtx, deps(healthy, kv.time));
  assert.equal(stale.status, 200);
  assert.equal(staleCtx.pending.length, 1);
  assert.equal(
    kv.puts.findLast(({ key }) => key === GATE_KEY).options.expirationTtl,
    900,
  );
  const secondCtx = context(request, { DOWNLOADS: kv });
  await handleClassicDownload(secondCtx, deps(healthy, kv.time));
  assert.equal(secondCtx.pending.length, 0, "gated refresh is not repeated");
  await Promise.all(staleCtx.pending);
  // Unchanged content costs no record write and keeps its checkedAt.
  assert.equal(kv.putsTo(RECORD_KEY), 1);
  assert.equal(JSON.parse(kv.store.get(RECORD_KEY)).checkedAt, body.checkedAt);

  const post = await handleClassicDownload(
    context(new Request(request, { method: "POST" }), { DOWNLOADS: kv }),
    deps(healthy),
  );
  assert.equal(post.status, 405);
});

test("records are validated when read from storage", async () => {
  const fixture = standardReleases();
  const protocols = { "v5.108.0": 1085, "v5.107.0": 1085, "v5.106.0": 1085 };
  const { record } = await refreshDownloadRecord(
    { DOWNLOADS: new MemoryKv() },
    deps(upstream({ ...fixture, protocols })),
  );
  assert.ok(isDownloadRecord(record));
  const tampered = [
    { ...record, extra: true },
    { ...record, tag: "v9.9.9" },
    {
      ...record,
      platforms: {
        ...record.platforms,
        windows: {
          ...record.platforms.windows,
          url: "https://evil.example/a.zip",
        },
      },
    },
    {
      ...record,
      platforms: {
        ...record.platforms,
        linux: { ...record.platforms.linux, sha256: "0".repeat(64) },
      },
    },
    {
      ...record,
      notes: [{ kind: "feature", text: "<img src=x onerror=alert(1)>" }],
    },
    { ...record, serverMatch: true, server: null },
    { ...record, releaseUrl: "javascript:alert(1)" },
    { ...record, files: [] },
  ];
  for (const value of tampered) {
    assert.equal(isDownloadRecord(value), false);
    const kv = new MemoryKv({ [RECORD_KEY]: JSON.stringify(value) });
    const failing = upstream({
      ...fixture,
      protocols,
      directoryStatus: 500,
      releasesStatus: 500,
    });
    const response = await handleClassicDownload(
      context(
        new Request(
          "https://preview.atrinik-website.pages.dev/api/downloads/classic",
        ),
        {
          DOWNLOADS: kv,
        },
      ),
      deps(failing),
    );
    assert.equal(response.status, 503);
  }
  const corrupt = new MemoryKv({ [RECORD_KEY]: "{not json" });
  const response = await handleClassicDownload(
    context(
      new Request(
        "https://preview.atrinik-website.pages.dev/api/downloads/classic",
      ),
      {
        DOWNLOADS: corrupt,
      },
    ),
    deps(
      upstream({
        ...fixture,
        protocols,
        directoryStatus: 500,
        releasesStatus: 500,
      }),
    ),
  );
  assert.equal(response.status, 503);
});

test("release notes become bounded plain text", () => {
  const body = [
    "## [5.0.0](https://x)",
    "### Features",
    "* **client:** <script>alert(1)</script>render **bold** and `code` [link](javascript:alert(1)) ([#1](https://x)) ([abcdef0](https://y))",
    "* **Bad Scope!:** <img src=x onerror=alert(1)>",
    "* " + "long ".repeat(80),
    "### Other Section",
    "* ignored",
    "### Bug Fixes",
    "- **server:** fix\u0000 nul and ‮ bidi",
    "* <",
    "### Performance Improvements",
    "* faster",
    "* a",
    "* b",
    "* c",
    "* d",
  ].join("\n");
  const notes = parseReleaseNotes(body);
  assert.equal(notes.length, 8);
  assert.deepEqual(notes[0], {
    kind: "feature",
    scope: "client",
    text: "alert(1) render bold and code link",
  });
  assert.equal(notes[1].kind, "feature");
  assert.ok(!("scope" in notes[1]), "invalid scopes are dropped");
  assert.ok(notes[1].text.endsWith("…"));
  assert.ok(notes.every(({ text }) => !/[<>\u0000\u202e]/u.test(text)));
  assert.ok(notes.every(({ text }) => [...text].length <= 200));
  assert.deepEqual(notes[2], {
    kind: "fix",
    scope: "server",
    text: "fix nul and bidi",
  });
  assert.deepEqual(notes[3], { kind: "performance", text: "faster" });
  assert.deepEqual(notes.at(-1), { kind: "performance", text: "d" });
  assert.ok(!notes.some(({ text }) => text === "ignored"));
  assert.deepEqual(parseReleaseNotes(null), []);
  assert.deepEqual(parseReleaseNotes("* orphan bullet"), []);
});

test("status exposes only whitelisted official-server fields", async () => {
  const request = new Request(
    "https://preview.atrinik-website.pages.dev/api/status",
  );
  const mock = upstream({ releases: [], server: officialEntry("5.106.0") });
  const cache = memoryStatusCache();
  const response = await handleStatus(context(request, {}), {
    ...deps(mock),
    cache,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=60");
  const body = await response.json();
  assert.deepEqual(body, {
    available: true,
    generatedAt: new Date(NOW - 60_000).toISOString(),
    server: {
      online: true,
      name: "Atrinik Official Server",
      version: "5.106.0",
      playersCount: 3,
    },
  });
  assert.ok(isStatusResponse(body));
  await handleStatus(context(request, {}), { ...deps(mock), cache });
  assert.equal(mock.calls.length, 1, "status is cached");

  const offline = await handleStatus(context(request, {}), {
    ...deps(upstream({ releases: [], server: null })),
    cache: memoryStatusCache(),
  });
  assert.deepEqual((await offline.json()).server, { online: false });

  const custom = await handleStatus(
    context(request, { OFFICIAL_SERVER_HOST: "other.example.org" }),
    { ...deps(mock), cache: memoryStatusCache() },
  );
  assert.deepEqual((await custom.json()).server, { online: false });
});

test("status is honest when the directory is unavailable, stale, or malformed", async () => {
  const request = new Request(
    "https://preview.atrinik-website.pages.dev/api/status",
  );
  const down = await handleStatus(context(request, {}), {
    ...deps(upstream({ releases: [], directoryStatus: 503 })),
    cache: memoryStatusCache(),
  });
  assert.equal(down.status, 503);
  assert.deepEqual(await down.json(), { available: false });
  assert.equal(down.headers.get("cache-control"), "no-store");

  const host = "game.atrinik.com";
  assert.equal(
    parseDirectory(
      directory([officialEntry("5.1.0")], { expiresAt: NOW / 1000 - 1 }),
      host,
      NOW,
    ),
    null,
  );
  assert.equal(
    parseDirectory(
      directory([officialEntry("5.1.0")], { schema: "other" }),
      host,
      NOW,
    ),
    null,
  );
  assert.equal(
    parseDirectory(directory([officialEntry("<b>")]), host, NOW),
    null,
  );
  assert.equal(
    parseDirectory(
      directory([officialEntry("5.1.0", { playersCount: -1 })]),
      host,
      NOW,
    ),
    null,
  );
  assert.equal(
    parseDirectory(
      directory([officialEntry("5.1.0", { name: "a\u0007b" })]),
      host,
      NOW,
    ),
    null,
  );
  assert.equal(
    parseDirectory(
      directory([officialEntry("5.1.0"), officialEntry("5.2.0")]),
      host,
      NOW,
    ),
    null,
  );
  assert.equal(
    isStatusResponse({
      available: true,
      generatedAt: "x",
      server: { online: false },
    }),
    false,
  );
  assert.equal(isStatusResponse({ available: false, extra: 1 }), false);
  const post = await handleStatus(
    context(new Request(request, { method: "POST" }), {}),
    {
      ...deps(upstream({ releases: [] })),
      cache: memoryStatusCache(),
    },
  );
  assert.equal(post.status, 405);
});

test("upstream fetches stay on allowlisted https hosts", async () => {
  const fixture = standardReleases();
  const evil = upstream({
    ...fixture,
    protocols: { "v5.108.0": 1085, "v5.107.0": 1085, "v5.106.0": 1085 },
  });
  const redirecting = {
    fetch: async (input, init) => {
      if (new URL(input).hostname === "github.com")
        return new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/sums" },
        });
      return evil.fetch(input, init);
    },
    calls: evil.calls,
  };
  const result = await refreshDownloadRecord(
    { DOWNLOADS: new MemoryKv() },
    deps(redirecting),
  );
  assert.equal(result.outcome, "unavailable");
  assert.ok(!evil.calls.some(({ url }) => url.includes("evil.example")));
});

test("a day of steady traffic costs about one gate write per 15 minutes", async () => {
  const fixture = standardReleases();
  const protocols = { "v5.108.0": 1085, "v5.107.0": 1085, "v5.106.0": 1085 };
  const kv = new MemoryKv();
  const request = new Request(
    "https://preview.atrinik-website.pages.dev/api/downloads/classic",
  );
  for (const failing of [false, true]) {
    const mock = upstream({
      ...fixture,
      protocols,
      ...(failing ? { directoryStatus: 500 } : {}),
    });
    const before = kv.putsTo(GATE_KEY);
    const start = kv.time;
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      kv.time = start + minute * 60_000;
      const ctx = context(request, { DOWNLOADS: kv });
      const response = await handleClassicDownload(ctx, deps(mock, kv.time));
      assert.equal(response.status, 200);
      await Promise.all(ctx.pending);
    }
    // 1,440 visits per day: 96 refresh attempts, kept or confirmed alike.
    const gateWrites = kv.putsTo(GATE_KEY) - before;
    assert.ok(gateWrites >= 95 && gateWrites <= 97, String(gateWrites));
    kv.time += 60_000;
  }
  // Only the first selection wrote the record; confirmations wrote nothing.
  assert.equal(kv.putsTo(RECORD_KEY), 1);
});

test("a transient failure on a newer release never downgrades a matching record", async () => {
  const newest = makeRelease("5.108.0");
  const older = makeRelease("5.107.0");
  const protocols = { "v5.108.0": 1085, "v5.107.0": 1085, "v5.106.0": 1085 };
  const releases = [newest.release, older.release];
  const kv = new MemoryKv();
  const seeded = await refreshDownloadRecord(
    { DOWNLOADS: kv },
    deps(
      upstream({
        releases,
        sums: { "v5.108.0": newest.sums, "v5.107.0": older.sums },
        protocols,
      }),
    ),
  );
  assert.equal(seeded.record.version, "5.108.0");
  // SHA256SUMS for 5.108.0 is now unreachable; 5.107.0 still verifies.
  const result = await refreshDownloadRecord(
    { DOWNLOADS: kv },
    deps(upstream({ releases, sums: { "v5.107.0": older.sums }, protocols })),
  );
  assert.equal(result.record.version, "5.108.0");
  assert.equal(kv.putsTo(RECORD_KEY), 1);

  // Once the server moves to a protocol the stored release no longer
  // matches (here a rollback to 5.105.0), an older matching release wins.
  const downgraded = await refreshDownloadRecord(
    { DOWNLOADS: kv },
    deps(
      upstream({
        releases,
        sums: { "v5.108.0": newest.sums, "v5.107.0": older.sums },
        protocols: { ...protocols, "v5.105.0": 1084, "v5.107.0": 1084 },
        server: officialEntry("5.105.0"),
      }),
    ),
  );
  assert.equal(downgraded.outcome, "updated");
  assert.equal(downgraded.record.version, "5.107.0");
  assert.equal(downgraded.record.serverMatch, true);
});

test("a deleted or withdrawn stored release is replaced", async () => {
  const newest = makeRelease("5.108.0");
  const older = makeRelease("5.107.0");
  const protocols = { "v5.108.0": 1085, "v5.107.0": 1085, "v5.106.0": 1085 };
  const sums = { "v5.108.0": newest.sums, "v5.107.0": older.sums };
  const kv = new MemoryKv();
  const seeded = await refreshDownloadRecord(
    { DOWNLOADS: kv },
    deps(
      upstream({ releases: [newest.release, older.release], sums, protocols }),
    ),
  );
  assert.equal(seeded.record.version, "5.108.0");
  // 5.108.0 is deleted: it leaves the list and its tag lookup returns 404.
  const replaced = await refreshDownloadRecord(
    { DOWNLOADS: kv },
    deps(upstream({ releases: [older.release], sums, protocols })),
  );
  assert.equal(replaced.outcome, "updated");
  assert.equal(replaced.record.version, "5.107.0");
  // A stored release that is now a prerelease is replaced too.
  const reseeded = await refreshDownloadRecord(
    { DOWNLOADS: new MemoryKv() },
    deps(upstream({ releases: [newest.release], sums, protocols })),
  );
  const kv2 = new MemoryKv({ [RECORD_KEY]: JSON.stringify(reseeded.record) });
  const withdrawn = await refreshDownloadRecord(
    { DOWNLOADS: kv2 },
    deps(
      upstream({
        releases: [{ ...newest.release, prerelease: true }, older.release],
        sums,
        protocols,
      }),
    ),
  );
  assert.equal(withdrawn.record.version, "5.107.0");
});

test("selection does not assume the list is ordered by version", async () => {
  const stored = makeRelease("5.108.0");
  const patch = makeRelease("5.108.1");
  const backport = makeRelease("5.107.1");
  const protocols = {
    "v5.108.1": 1085,
    "v5.108.0": 1085,
    "v5.107.1": 1085,
    "v5.106.0": 1085,
  };
  const sums = {
    "v5.108.0": stored.sums,
    "v5.108.1": patch.sums,
    "v5.107.1": backport.sums,
  };
  const kv = new MemoryKv();
  await refreshDownloadRecord(
    { DOWNLOADS: kv },
    deps(upstream({ releases: [stored.release], sums, protocols })),
  );
  const result = await refreshDownloadRecord(
    { DOWNLOADS: kv },
    deps(
      upstream({
        releases: [backport.release, patch.release, stored.release],
        sums,
        protocols,
      }),
    ),
  );
  assert.equal(result.record.version, "5.108.1");
});

test("a stored release outside the list is checked by tag", async () => {
  const stored = makeRelease("5.108.0");
  const older = makeRelease("5.107.0");
  const protocols = { "v5.108.0": 1085, "v5.107.0": 1085, "v5.106.0": 1085 };
  const sums = { "v5.108.0": stored.sums, "v5.107.0": older.sums };
  const seed = async () => {
    const kv = new MemoryKv();
    await refreshDownloadRecord(
      { DOWNLOADS: kv },
      deps(upstream({ releases: [stored.release], sums, protocols })),
    );
    return kv;
  };
  const tagUrl =
    "https://api.github.com/repos/atrinik/classic/releases/tags/v5.108.0";
  for (const [tagRelease, expected] of [
    [{ body: stored.release }, "5.108.0"],
    [{ status: 500 }, "5.108.0"],
    [{ status: 404 }, "5.107.0"],
  ]) {
    const kv = await seed();
    const mock = upstream({
      releases: [older.release],
      sums,
      protocols,
      tagReleases: { "v5.108.0": tagRelease },
    });
    const result = await refreshDownloadRecord({ DOWNLOADS: kv }, deps(mock));
    assert.equal(result.record.version, expected, JSON.stringify(tagRelease));
    assert.ok(mock.calls.some(({ url }) => url === tagUrl));
  }
});

test("without a floor the highest matching version wins", async () => {
  const patch = makeRelease("5.108.1");
  const backport = makeRelease("5.107.1");
  const result = await refreshDownloadRecord(
    { DOWNLOADS: new MemoryKv() },
    deps(
      upstream({
        releases: [backport.release, patch.release],
        sums: { "v5.108.1": patch.sums, "v5.107.1": backport.sums },
        protocols: { "v5.108.1": 1085, "v5.107.1": 1085, "v5.106.0": 1085 },
      }),
    ),
  );
  assert.equal(result.record.version, "5.108.1");
});

test("a failed store read never overwrites the stored record", async () => {
  const fixture = standardReleases();
  const kv = new MemoryKv({ [RECORD_KEY]: "kept" });
  kv.get = async () => {
    throw new Error("kv unavailable");
  };
  const result = await refreshDownloadRecord(
    { DOWNLOADS: kv },
    deps(
      upstream({
        ...fixture,
        protocols: { "v5.108.0": 1085, "v5.107.0": 1085, "v5.106.0": 1085 },
        directoryStatus: 500,
      }),
    ),
  );
  assert.equal(result.reason, "store-unavailable");
  assert.equal(result.outcome, "unavailable");
  assert.equal(kv.puts.length, 0);
});

test("a server protocol change without a matching release is stated, not hidden", async () => {
  const fixture = standardReleases();
  const protocols = { "v5.108.0": 1085, "v5.107.0": 1085, "v5.106.0": 1085 };
  const kv = new MemoryKv();
  await refreshDownloadRecord(
    { DOWNLOADS: kv },
    deps(upstream({ ...fixture, protocols })),
  );
  const result = await refreshDownloadRecord(
    { DOWNLOADS: kv },
    deps(
      upstream({
        ...fixture,
        protocols: { ...protocols, "v5.109.0": 1090 },
        server: officialEntry("5.109.0"),
      }),
    ),
  );
  assert.equal(result.outcome, "updated");
  assert.equal(result.record.version, "5.108.0");
  assert.equal(result.record.serverMatch, false);
  assert.deepEqual(result.record.server, { version: "5.109.0" });
  assert.ok(isDownloadRecord(result.record));
  assert.deepEqual(JSON.parse(kv.store.get(RECORD_KEY)), result.record);
  assert.equal(
    isDownloadRecord({ ...result.record, serverMatch: true, server: null }),
    false,
  );
});

test("tag commits expire after a day while commit protocols stay cached", async () => {
  const fixture = standardReleases();
  const kv = new MemoryKv();
  await refreshDownloadRecord(
    { DOWNLOADS: kv },
    deps(
      upstream({
        ...fixture,
        protocols: { "v5.108.0": 1085, "v5.107.0": 1085, "v5.106.0": 1085 },
      }),
    ),
  );
  const keys = storageKeys({});
  const tagPut = kv.puts.find(({ key }) => key === keys.tagCommit("v5.108.0"));
  assert.equal(tagPut.options.expirationTtl, 86_400);
  const protocolPut = kv.puts.find(
    ({ key }) => key === keys.protocol(commitFor("v5.108.0")),
  );
  assert.equal(protocolPut.options, undefined);
});

test("preview deployments use their own key namespace", async () => {
  const production = storageKeys({ ATRINIK_PRODUCTION: true });
  assert.equal(production.record, "classic:download:v1");
  const request = (url) => new Request(url);
  assert.equal(
    environmentFor({}, request("https://atrinik.org/api/status"))
      .ATRINIK_PRODUCTION,
    true,
  );
  for (const url of [
    "https://www.atrinik.org/api/status",
    "https://feat-x.atrinik-website.pages.dev/api/status",
    "https://atrinik.org.evil.example/api/status",
    "http://localhost:8788/api/status",
  ])
    assert.equal(
      environmentFor({ ATRINIK_PRODUCTION: true }, request(url))
        .ATRINIK_PRODUCTION,
      false,
      url,
    );
  for (const flag of [undefined, false, "true", 1]) {
    const keys = storageKeys(
      flag === undefined ? {} : { ATRINIK_PRODUCTION: flag },
    );
    for (const key of [
      keys.record,
      keys.refreshGate,
      keys.webhookGate,
      keys.tagCommit("v1.0.0"),
      keys.protocol("a".repeat(40)),
    ])
      assert.ok(key.startsWith("preview:"), key);
  }
  // A preview refresh against a shared namespace leaves production untouched.
  const kv = new MemoryKv({ [production.record]: "production" });
  const fixture = standardReleases();
  await refreshDownloadRecord(
    { DOWNLOADS: kv, ATRINIK_PRODUCTION: false },
    deps(
      upstream({
        ...fixture,
        protocols: { "v5.108.0": 1085, "v5.107.0": 1085, "v5.106.0": 1085 },
      }),
    ),
  );
  assert.equal(kv.store.get(production.record), "production");
  assert.ok(kv.puts.every(({ key }) => key.startsWith("preview:")));
});

test("pathological release notes parse in linear time", () => {
  const bodies = [
    `### Features\n#${" ".repeat(20_000)}x`,
    `### Features\n# ${" ".repeat(20_000)}#x`,
    `### Features\n* ${"[".repeat(20_000)}`,
    `### Features\n* ${"([a](b)) ".repeat(2_200)}x))`,
    `### Features\n* ${"<".repeat(20_000)}`,
    `### Features\n* ${"*".repeat(20_000)}`,
    `### Features\n* **${"a".repeat(20_000)}`,
    `### Features\n${"* x\n".repeat(5_000)}`,
    `### Features\n* ${"[a](".repeat(5_000)}`,
    "#".repeat(20_000),
  ];
  for (const body of bodies) {
    const start = performance.now();
    parseReleaseNotes(body);
    const elapsed = performance.now() - start;
    assert.ok(
      elapsed < 250,
      `${elapsed.toFixed(1)} ms for ${body.slice(0, 30)}`,
    );
  }
});
