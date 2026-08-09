import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManualPreviewSpec,
  buildPrPreviewSpec,
  classifyPagesDomainStatus,
  createCloudflareApi,
  createGitHubApi,
  ensurePreviewDomain,
  ensurePullRequestPreview,
  isOwnedDnsRecord,
  pollPagesBranchAlias,
  pollPagesDomainReady,
  previewDomainContract,
  removePreviewDomain,
  removePullRequestPreview,
  runPreviewDomainCli,
  selectPagesBranchAlias,
  validateHeadRef,
  validateLivePullRequest,
  validateManualPrefix,
  validatePreviewHostname,
  validatePrNumber,
} from "./cloudflare-preview-domain.mjs";

const accountId = "a".repeat(32);
const zoneId = "b".repeat(32);
const domainId = "zoey.testing.atrinik.org";
const recordId = "d".repeat(32);
const apiToken = "cloudflare-test-token-value-1234567890";
const githubToken = "github-test-token-value-123456789012";
const headSha = "1".repeat(40);
const nextSha = "2".repeat(40);

function response(result, { status = 200, resultInfo } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return {
        success: status >= 200 && status < 300,
        result,
        ...(resultInfo === undefined ? {} : { result_info: resultInfo }),
      };
    },
  };
}

function githubResponse(result, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return result;
    },
  };
}

function activeDomain(hostname, overrides = {}) {
  return {
    id: domainId,
    name: hostname,
    status: "active",
    validation_data: { status: "active" },
    verification_data: { status: "active" },
    ...overrides,
  };
}

function ownedRecord(spec, overrides = {}) {
  return {
    id: recordId,
    name: spec.hostname,
    type: "CNAME",
    content: spec.target,
    ttl: 1,
    proxied: true,
    comment: spec.comment,
    ...overrides,
  };
}

function pullRequest({
  number = 42,
  state = "open",
  headRef = "feature/blue-crystal",
  sha = headSha,
  baseRef = "main",
  baseRepository = "atrinik/website",
  headRepository = "atrinik/website",
  baseId = previewDomainContract.repositoryId,
  headId = previewDomainContract.repositoryId,
} = {}) {
  return {
    number,
    state,
    base: { ref: baseRef, repo: { id: baseId, full_name: baseRepository } },
    head: {
      ref: headRef,
      sha,
      repo: { id: headId, full_name: headRepository },
    },
  };
}

function deployment({
  branch = "feature/blue-crystal",
  sha = headSha,
  alias = "blue-crystal.atrinik-website.pages.dev",
  status = "success",
  environment = "preview",
  usesFunctions = false,
  skipped = false,
  source = {
    type: "github",
    config: {
      owner: "atrinik",
      repo_name: "website",
      repo_id: String(previewDomainContract.repositoryId),
      production_branch: "main",
    },
  },
} = {}) {
  return {
    id: "deployment-id",
    environment,
    deployment_trigger: { metadata: { branch, commit_hash: sha } },
    latest_stage: { name: "deploy", status },
    aliases: [alias],
    uses_functions: usesFunctions,
    is_skipped: skipped,
    source,
  };
}

test("manual and pull-request specifications are exact and production-safe", () => {
  assert.deepEqual(buildManualPreviewSpec("zoey"), {
    kind: "manual",
    key: "zoey",
    prefix: "zoey",
    hostname: "zoey.testing.atrinik.org",
    branchAlias: "manual-zoey",
    target: "manual-zoey.atrinik-website.pages.dev",
    comment: "atrinik/website-preview:v1;key=manual-zoey",
  });
  assert.equal(
    buildPrPreviewSpec(42, "blue-crystal.atrinik-website.pages.dev").hostname,
    "pr.42.testing.atrinik.org",
  );
  assert.equal(validatePrNumber("42"), "42");
  assert.equal(
    validatePreviewHostname("pr.42.testing.atrinik.org"),
    "pr.42.testing.atrinik.org",
  );
  assert.ok(buildManualPreviewSpec("a".repeat(56)).comment.length <= 100);
  assert.throws(() => validateManualPrefix("Blue"), /invalid/u);
  assert.throws(
    () => validateManualPrefix(`a${"-b".repeat(30)}`),
    /invalid|long/u,
  );
  assert.throws(() => validatePrNumber("042"), /invalid/u);
  assert.throws(
    () => validatePreviewHostname("atrinik.org"),
    /managed namespace/u,
  );
  assert.throws(
    () => validatePreviewHostname("pr.42.evil.example"),
    /managed namespace/u,
  );
  assert.throws(
    () => buildPrPreviewSpec(42, "atrinik-website.pages.dev"),
    /outside the Pages project/u,
  );
  assert.throws(
    () => buildPrPreviewSpec(42, "main.atrinik-website.pages.dev"),
    /safe preview alias/u,
  );
});

test("head refs and live pull requests enforce same-repository main", () => {
  assert.equal(validateHeadRef("feature/blue-crystal"), "feature/blue-crystal");
  assert.throws(() => validateHeadRef("main"), /unsafe/u);
  assert.throws(() => validateHeadRef("bad..ref"), /unsafe/u);
  assert.deepEqual(validateLivePullRequest(pullRequest(), 42), {
    number: "42",
    state: "open",
    headRef: "feature/blue-crystal",
    headSha,
  });
  assert.throws(
    () =>
      validateLivePullRequest(
        pullRequest({ headRepository: "someone/website", headId: 99 }),
        42,
      ),
    /same-repository main/u,
  );
  assert.throws(
    () => validateLivePullRequest(pullRequest({ baseRef: "release" }), 42),
    /same-repository main/u,
  );
  assert.throws(
    () =>
      validateLivePullRequest(pullRequest({ sha: nextSha }), 42, {
        expectedHeadSha: headSha,
      }),
    /SHA changed/u,
  );
});

test("deployment selection is SHA/ref-bound and uses the returned branch alias", () => {
  const stale = deployment({
    sha: nextSha,
    alias: "stale.atrinik-website.pages.dev",
  });
  const current = deployment();
  assert.equal(
    selectPagesBranchAlias([stale, current], {
      headRef: "feature/blue-crystal",
      headSha,
    }),
    "blue-crystal.atrinik-website.pages.dev",
  );
  assert.equal(
    selectPagesBranchAlias([deployment({ status: "failure" })], {
      headRef: "feature/blue-crystal",
      headSha,
    }),
    undefined,
  );
  assert.throws(
    () =>
      selectPagesBranchAlias(
        [
          deployment(),
          deployment({ alias: "other.atrinik-website.pages.dev" }),
        ],
        { headRef: "feature/blue-crystal", headSha },
      ),
    /disagree/u,
  );
  assert.throws(
    () =>
      selectPagesBranchAlias([deployment({ branch: "manual-zoey" })], {
        headRef: "manual-zoey",
        headSha,
        expectedAlias: "manual-zoey.atrinik-website.pages.dev",
      }),
    /unexpected branch alias/u,
  );
  assert.throws(
    () =>
      selectPagesBranchAlias([deployment({ usesFunctions: true })], {
        headRef: "feature/blue-crystal",
        headSha,
      }),
    /not proven static/u,
  );
  assert.throws(
    () =>
      selectPagesBranchAlias([deployment({ skipped: true })], {
        headRef: "feature/blue-crystal",
        headSha,
      }),
    /not proven static/u,
  );
  assert.throws(
    () =>
      selectPagesBranchAlias(
        [deployment({ source: { type: "direct_upload" } })],
        {
          headRef: "feature/blue-crystal",
          headSha,
          requireGitIntegration: true,
        },
      ),
    /trusted Git integration/u,
  );
});

test("deployment polling is bounded and reads only declared result pages", async () => {
  const calls = [];
  let round = 0;
  const delays = [];
  const cloudflare = {
    async listPreviewDeployments(options) {
      calls.push(options);
      if (options.page === 1) {
        round += 1;
        return {
          result: round === 1 ? [] : [deployment()],
          resultInfo: { total_pages: 2 },
        };
      }
      return { result: [], resultInfo: { total_pages: 2 } };
    },
  };
  assert.equal(
    await pollPagesBranchAlias({
      cloudflare,
      headRef: "feature/blue-crystal",
      headSha,
      attempts: 2,
      delayMilliseconds: 7,
      delay: async (milliseconds) => delays.push(milliseconds),
    }),
    "blue-crystal.atrinik-website.pages.dev",
  );
  assert.deepEqual(calls, [
    { page: 1, perPage: 100 },
    { page: 2, perPage: 100 },
    { page: 1, perPage: 100 },
  ]);
  assert.deepEqual(delays, [7]);
  await assert.rejects(
    pollPagesBranchAlias({
      cloudflare: {
        async listPreviewDeployments() {
          return { result: [], resultInfo: { total_pages: 1 } };
        },
      },
      headRef: "feature/blue-crystal",
      headSha,
      attempts: 1,
      delayMilliseconds: 0,
      delay: async () => assert.fail("last attempt must not delay"),
    }),
    /timed out/u,
  );
});

test("Cloudflare manager uses exact Pages and all-type DNS API contracts", async () => {
  const calls = [];
  const spec = buildManualPreviewSpec("zoey");
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const parsed = new URL(url);
    if (
      options.method === "GET" &&
      parsed.pathname.endsWith(`/domains/${spec.hostname}`)
    )
      return {
        ok: false,
        status: 404,
        json: async () => assert.fail("404 JSON"),
      };
    if (options.method === "DELETE") return response({ id: recordId });
    if (parsed.pathname.endsWith("/deployments"))
      return response([], { resultInfo: { total_pages: 1 } });
    if (parsed.pathname.endsWith("/dns_records") && options.method === "GET")
      return response([], { resultInfo: { total_pages: 1 } });
    if (parsed.pathname.endsWith("/domains") && options.method === "GET")
      return response([], { resultInfo: { total_pages: 1 } });
    if (parsed.pathname.endsWith("/domains"))
      return response(activeDomain(spec.hostname));
    if (parsed.pathname.endsWith("/dns_records"))
      return response(ownedRecord(spec));
    return response(ownedRecord(spec));
  };
  const api = createCloudflareApi({
    accountId,
    zoneId,
    apiToken,
    fetchImpl,
  });
  await api.listPagesDomains();
  assert.equal(await api.getPagesDomain(spec.hostname), undefined);
  await api.addPagesDomain(spec.hostname);
  await api.deletePagesDomain(spec.hostname);
  await api.listPreviewDeployments();
  await api.listDnsRecordsExact(spec.hostname);
  await api.createDnsRecord(spec);
  await api.updateDnsRecord(recordId, spec);
  await api.deleteDnsRecord(recordId);

  assert.ok(
    calls.every(
      ({ options }) => options.headers.Authorization === `Bearer ${apiToken}`,
    ),
  );
  assert.ok(
    calls.every(({ options }) => options.signal instanceof AbortSignal),
  );
  const dnsList = calls.find(
    ({ url, options }) =>
      url.includes("/dns_records?") && options.method === "GET",
  );
  const dnsQuery = new URL(dnsList.url).searchParams;
  assert.equal(dnsQuery.get("name.exact"), spec.hostname);
  assert.equal(dnsQuery.get("match"), "all");
  assert.equal(dnsQuery.has("type"), false);
  const create = calls.find(
    ({ url, options }) =>
      url.endsWith("/dns_records") && options.method === "POST",
  );
  assert.deepEqual(JSON.parse(create.options.body), {
    type: "CNAME",
    name: spec.hostname,
    content: spec.target,
    ttl: 1,
    proxied: true,
    comment: spec.comment,
  });
});

test("API failures never include either authorization token", async () => {
  const cloudflare = createCloudflareApi({
    accountId,
    zoneId,
    apiToken,
    fetchImpl: async () => {
      throw new Error(`accidental ${apiToken}`);
    },
  });
  await assert.rejects(
    cloudflare.listPagesDomains(),
    (error) =>
      !error.message.includes(apiToken) &&
      /request failed/u.test(error.message),
  );
  const github = createGitHubApi({
    token: githubToken,
    fetchImpl: async () => {
      throw new Error(`accidental ${githubToken}`);
    },
  });
  await assert.rejects(
    github.getPullRequest(42),
    (error) =>
      !error.message.includes(githubToken) &&
      /request failed/u.test(error.message),
  );
});

test("new setup claims the Pages-created CNAME and waits for full readiness", async () => {
  const spec = buildManualPreviewSpec("zoey");
  const autoRecord = {
    id: recordId,
    name: spec.hostname,
    type: "CNAME",
    content: previewDomainContract.pagesProjectDomain,
    proxied: true,
    comment: "",
    tags: [],
  };
  const events = [];
  let domainReads = 0;
  let dnsReads = 0;
  let currentRecord = autoRecord;
  const cloudflare = {
    async getPagesDomain() {
      domainReads += 1;
      events.push("get-domain");
      if (domainReads === 1) return undefined;
      if (domainReads === 2)
        return activeDomain(spec.hostname, {
          status: "pending",
          validation_data: { status: "pending" },
        });
      return activeDomain(spec.hostname);
    },
    async addPagesDomain() {
      events.push("add-domain");
      return activeDomain(spec.hostname, { status: "pending" });
    },
    async deletePagesDomain() {
      events.push("delete-domain");
    },
    async listDnsRecordsExact() {
      dnsReads += 1;
      events.push("list-dns");
      return {
        result: dnsReads === 1 ? [] : [currentRecord],
        resultInfo: { total_pages: 1 },
      };
    },
    async createDnsRecord() {
      assert.fail("Pages-created CNAME should be claimed");
    },
    async updateDnsRecord(id, updateSpec) {
      events.push("update-dns");
      assert.equal(id, recordId);
      currentRecord = ownedRecord(updateSpec);
      return currentRecord;
    },
    async deleteDnsRecord() {
      events.push("delete-dns");
    },
  };
  const delays = [];
  assert.deepEqual(
    await ensurePreviewDomain({
      cloudflare,
      spec,
      readinessAttempts: 2,
      readinessDelayMilliseconds: 3,
      delay: async (milliseconds) => delays.push(milliseconds),
    }),
    {
      status: "active",
      hostname: spec.hostname,
      target: spec.target,
      pagesDomainId: domainId,
      dnsRecordId: recordId,
    },
  );
  assert.deepEqual(delays, [3]);
  assert.deepEqual(events, [
    "get-domain",
    "list-dns",
    "add-domain",
    "list-dns",
    "update-dns",
    "list-dns",
    "get-domain",
    "get-domain",
  ]);
});

test("setup reconciles an automatic CNAME that races a manual create", async () => {
  const spec = buildManualPreviewSpec("zoey");
  const automatic = {
    id: recordId,
    name: spec.hostname,
    type: "CNAME",
    content: previewDomainContract.pagesProjectDomain,
    proxied: true,
    comment: "",
    tags: [],
  };
  let dnsRead = 0;
  let claimed = false;
  let currentRecord = automatic;
  const result = await ensurePreviewDomain({
    cloudflare: {
      async getPagesDomain() {
        return dnsRead === 0 ? undefined : activeDomain(spec.hostname);
      },
      async addPagesDomain() {
        return activeDomain(spec.hostname, { status: "pending" });
      },
      async deletePagesDomain() {},
      async listDnsRecordsExact() {
        dnsRead += 1;
        return {
          result: dnsRead < 3 ? [] : [currentRecord],
          resultInfo: { total_pages: 1 },
        };
      },
      async createDnsRecord() {
        throw new Error("record appeared concurrently");
      },
      async updateDnsRecord(id, updateSpec) {
        assert.equal(id, recordId);
        claimed = true;
        currentRecord = ownedRecord(updateSpec);
        return currentRecord;
      },
      async deleteDnsRecord() {},
    },
    spec,
    readinessAttempts: 1,
    readinessDelayMilliseconds: 0,
    delay: async () => {},
  });
  assert.equal(claimed, true);
  assert.equal(result.status, "active");
});

test("setup fails closed before mutation on any exact-name DNS conflict", async () => {
  const spec = buildManualPreviewSpec("zoey");
  let mutations = 0;
  const cloudflare = {
    async getPagesDomain() {
      return undefined;
    },
    async listDnsRecordsExact() {
      return {
        result: [{ id: "e".repeat(32), name: spec.hostname, type: "TXT" }],
        resultInfo: { total_pages: 1 },
      };
    },
    async addPagesDomain() {
      mutations += 1;
    },
    async deletePagesDomain() {
      mutations += 1;
    },
    async createDnsRecord() {
      mutations += 1;
    },
    async updateDnsRecord() {
      mutations += 1;
    },
    async deleteDnsRecord() {
      mutations += 1;
    },
  };
  await assert.rejects(
    ensurePreviewDomain({ cloudflare, spec }),
    /unowned DNS record/u,
  );
  assert.equal(mutations, 0);
});

test("terminal and unknown Pages domain states fail immediately", async () => {
  assert.deepEqual(
    classifyPagesDomainStatus(
      activeDomain("zoey.testing.atrinik.org", {
        verification_data: { status: "blocked" },
      }),
    ),
    { ready: false, terminal: true, name: "verification", status: "blocked" },
  );
  assert.throws(
    () =>
      classifyPagesDomainStatus(
        activeDomain("zoey.testing.atrinik.org", { status: "mystery" }),
      ),
    /unknown/u,
  );
  let delays = 0;
  await assert.rejects(
    pollPagesDomainReady({
      cloudflare: {
        async getPagesDomain() {
          return activeDomain("zoey.testing.atrinik.org", {
            status: "error",
          });
        },
      },
      hostname: "zoey.testing.atrinik.org",
      attempts: 3,
      delayMilliseconds: 0,
      delay: async () => {
        delays += 1;
      },
    }),
    /terminal domain status error/u,
  );
  assert.equal(delays, 0);
});

test("failed readiness removes only resources created by that setup", async () => {
  const spec = buildManualPreviewSpec("zoey");
  const record = ownedRecord(spec);
  let domainRead = 0;
  let dnsRead = 0;
  let domainDeleted = false;
  const deleted = [];
  const cloudflare = {
    async getPagesDomain() {
      domainRead += 1;
      if (domainRead === 1) return undefined;
      if (domainDeleted) return undefined;
      return activeDomain(spec.hostname, { status: "error" });
    },
    async addPagesDomain() {
      return activeDomain(spec.hostname, { status: "pending" });
    },
    async deletePagesDomain(hostname) {
      deleted.push(["domain", hostname]);
      domainDeleted = true;
    },
    async listDnsRecordsExact() {
      dnsRead += 1;
      return {
        result: dnsRead === 1 ? [] : dnsRead === 2 ? [] : [record],
        resultInfo: { total_pages: 1 },
      };
    },
    async createDnsRecord() {
      return record;
    },
    async updateDnsRecord() {
      assert.fail("no update expected");
    },
    async deleteDnsRecord(id) {
      deleted.push(["dns", id]);
    },
  };
  await assert.rejects(
    ensurePreviewDomain({
      cloudflare,
      spec,
      readinessAttempts: 1,
      readinessDelayMilliseconds: 0,
      delay: async () => {},
    }),
    /terminal domain status error/u,
  );
  assert.deepEqual(deleted, [
    ["domain", spec.hostname],
    ["dns", recordId],
  ]);
});

test("cleanup rechecks exact ownership and removes the Pages association first", async () => {
  const spec = buildPrPreviewSpec(42, "blue-crystal.atrinik-website.pages.dev");
  let record = ownedRecord(spec);
  let domain = activeDomain(spec.hostname);
  const events = [];
  let authorizations = 0;
  const cloudflare = {
    async getPagesDomain() {
      events.push("get-domain");
      return domain;
    },
    async listDnsRecordsExact() {
      events.push("list-dns");
      return { result: [record], resultInfo: { total_pages: 1 } };
    },
    async deleteDnsRecord(id) {
      events.push(`delete-dns:${id}`);
      record = undefined;
    },
    async deletePagesDomain(hostname) {
      events.push(`delete-domain:${hostname}`);
      domain = undefined;
    },
  };
  assert.deepEqual(
    await removePreviewDomain({
      cloudflare,
      spec: buildPrPreviewSpec(42),
      authorizeRemoval: async () => {
        authorizations += 1;
        return true;
      },
    }),
    { status: "removed", hostname: spec.hostname },
  );
  assert.equal(authorizations, 3);
  assert.deepEqual(events, [
    "get-domain",
    "list-dns",
    "get-domain",
    "list-dns",
    `delete-domain:${spec.hostname}`,
    "get-domain",
    "list-dns",
    `delete-dns:${recordId}`,
  ]);
});

test("setup resumes only a DNS-only partial state with complete ownership", async () => {
  const spec = buildManualPreviewSpec("zoey");
  const record = ownedRecord(spec);
  let domain;
  let domainAdds = 0;
  const cloudflare = {
    async getPagesDomain() {
      return domain;
    },
    async addPagesDomain(hostname) {
      domainAdds += 1;
      domain = activeDomain(hostname);
      return domain;
    },
    async deletePagesDomain() {
      domain = undefined;
    },
    async listDnsRecordsExact() {
      return { result: [record], resultInfo: { total_pages: 1 } };
    },
    async createDnsRecord() {
      assert.fail("owned partial DNS must be reused");
    },
    async updateDnsRecord() {
      assert.fail("exact owned partial DNS must not be rewritten");
    },
    async deleteDnsRecord() {
      assert.fail("successful partial recovery must retain DNS");
    },
  };
  assert.equal(
    (
      await ensurePreviewDomain({
        cloudflare,
        spec,
        readinessAttempts: 1,
        readinessDelayMilliseconds: 0,
        delay: async () => {},
      })
    ).status,
    "active",
  );
  assert.equal(domainAdds, 1);

  let mutations = 0;
  await assert.rejects(
    ensurePreviewDomain({
      cloudflare: {
        async getPagesDomain() {
          return activeDomain(spec.hostname);
        },
        async listDnsRecordsExact() {
          return { result: [], resultInfo: { total_pages: 1 } };
        },
        async addPagesDomain() {
          mutations += 1;
        },
        async deletePagesDomain() {
          mutations += 1;
        },
        async createDnsRecord() {
          mutations += 1;
        },
        async updateDnsRecord() {
          mutations += 1;
        },
        async deleteDnsRecord() {
          mutations += 1;
        },
      },
      spec,
    }),
    /no owned DNS record/u,
  );
  assert.equal(mutations, 0);
});

test("setup never overwrites an owned DNS record changed after preflight", async () => {
  const spec = buildPrPreviewSpec(42, "blue-crystal.atrinik-website.pages.dev");
  const previousSpec = buildPrPreviewSpec(
    42,
    "previous-crystal.atrinik-website.pages.dev",
  );
  const preflightRecord = ownedRecord(previousSpec);
  const racedRecord = {
    ...preflightRecord,
    content: "operator.example.net",
    comment: "changed outside preview automation",
  };
  let dnsReads = 0;
  let mutations = 0;
  await assert.rejects(
    ensurePreviewDomain({
      cloudflare: {
        async getPagesDomain() {
          return activeDomain(spec.hostname);
        },
        async addPagesDomain() {
          mutations += 1;
        },
        async deletePagesDomain() {
          mutations += 1;
        },
        async listDnsRecordsExact() {
          dnsReads += 1;
          return {
            result: [dnsReads === 1 ? preflightRecord : racedRecord],
            resultInfo: { total_pages: 1 },
          };
        },
        async createDnsRecord() {
          mutations += 1;
        },
        async updateDnsRecord() {
          mutations += 1;
        },
        async deleteDnsRecord() {
          mutations += 1;
        },
      },
      spec,
    }),
    /owned DNS changed before it could be updated/u,
  );
  assert.equal(dnsReads, 2);
  assert.equal(mutations, 0);
});

test("setup claims only a Pages-managed CNAME paired with its exact association", async () => {
  const spec = buildManualPreviewSpec("zoey");
  const automatic = {
    id: recordId,
    name: spec.hostname,
    type: "CNAME",
    content: previewDomainContract.pagesProjectDomain,
    proxied: true,
    comment: "",
    tags: [],
  };
  let record = automatic;
  let updates = 0;
  const cloudflare = {
    async getPagesDomain() {
      return activeDomain(spec.hostname);
    },
    async addPagesDomain() {
      assert.fail("existing association must be reused");
    },
    async deletePagesDomain() {},
    async listDnsRecordsExact() {
      return { result: [record], resultInfo: { total_pages: 1 } };
    },
    async createDnsRecord() {
      assert.fail("paired Pages-managed DNS must be claimed");
    },
    async updateDnsRecord(id, updateSpec) {
      assert.equal(id, recordId);
      updates += 1;
      record = ownedRecord(updateSpec);
      return record;
    },
    async deleteDnsRecord() {},
  };
  assert.equal(
    (
      await ensurePreviewDomain({
        cloudflare,
        spec,
        readinessAttempts: 1,
        readinessDelayMilliseconds: 0,
        delay: async () => {},
      })
    ).status,
    "active",
  );
  assert.equal(updates, 1);
  assert.equal(record.content, spec.target);

  let mutations = 0;
  await assert.rejects(
    ensurePreviewDomain({
      cloudflare: {
        async getPagesDomain() {
          return activeDomain(spec.hostname);
        },
        async listDnsRecordsExact() {
          return {
            result: [
              {
                ...automatic,
                content: "foreign.example.net",
              },
            ],
            resultInfo: { total_pages: 1 },
          };
        },
        async addPagesDomain() {
          mutations += 1;
        },
        async deletePagesDomain() {
          mutations += 1;
        },
        async createDnsRecord() {
          mutations += 1;
        },
        async updateDnsRecord() {
          mutations += 1;
        },
        async deleteDnsRecord() {
          mutations += 1;
        },
      },
      spec,
    }),
    /unowned DNS record/u,
  );
  assert.equal(mutations, 0);

  let domainReads = 0;
  await assert.rejects(
    ensurePreviewDomain({
      cloudflare: {
        async getPagesDomain() {
          domainReads += 1;
          return domainReads === 1 ? activeDomain(spec.hostname) : undefined;
        },
        async listDnsRecordsExact() {
          return { result: [automatic], resultInfo: { total_pages: 1 } };
        },
        async addPagesDomain() {
          assert.fail("raced association must not be recreated implicitly");
        },
        async deletePagesDomain() {},
        async createDnsRecord() {},
        async updateDnsRecord() {
          assert.fail("orphaned Pages-managed DNS must not be claimed");
        },
        async deleteDnsRecord() {},
      },
      spec,
    }),
    /changed before claiming managed DNS/u,
  );
});

test("cleanup releases a stable reserved Pages association with zero DNS", async () => {
  const spec = buildManualPreviewSpec("zoey");
  let domain = activeDomain(spec.hostname);
  let domainDeletes = 0;
  let authorizations = 0;
  assert.deepEqual(
    await removePreviewDomain({
      cloudflare: {
        async getPagesDomain() {
          return domain;
        },
        async listDnsRecordsExact() {
          return { result: [], resultInfo: { total_pages: 1 } };
        },
        async deletePagesDomain() {
          domainDeletes += 1;
          domain = undefined;
        },
        async deleteDnsRecord() {
          assert.fail("domain-only cleanup has no DNS to delete");
        },
      },
      spec,
      authorizeRemoval: async () => {
        authorizations += 1;
        return true;
      },
    }),
    { status: "removed", hostname: spec.hostname },
  );
  assert.equal(authorizations, 2);
  assert.equal(domainDeletes, 1);
  assert.equal(domain, undefined);
});

test("paired Pages-managed DNS cleanup is retry-safe and never orphan-claimed", async () => {
  const spec = buildManualPreviewSpec("zoey");
  let domain = activeDomain(spec.hostname);
  let record = {
    id: recordId,
    name: spec.hostname,
    type: "CNAME",
    content: previewDomainContract.pagesProjectDomain,
    proxied: true,
    comment: "",
    tags: [],
  };
  let dnsDeletes = 0;
  let domainDeletes = 0;
  const cloudflare = {
    async getPagesDomain() {
      return domain;
    },
    async listDnsRecordsExact() {
      return {
        result: record ? [record] : [],
        resultInfo: { total_pages: 1 },
      };
    },
    async deletePagesDomain() {
      domainDeletes += 1;
      domain = undefined;
    },
    async deleteDnsRecord() {
      dnsDeletes += 1;
      record = undefined;
      throw new Error("Pages-managed DNS delete response was lost");
    },
  };
  await assert.rejects(
    removePreviewDomain({ cloudflare, spec }),
    /response was lost/u,
  );
  assert.ok(domain);
  assert.equal(record, undefined);
  assert.deepEqual(await removePreviewDomain({ cloudflare, spec }), {
    status: "removed",
    hostname: spec.hostname,
  });
  assert.equal(dnsDeletes, 1);
  assert.equal(domainDeletes, 1);

  let foreignDeletes = 0;
  await assert.rejects(
    removePreviewDomain({
      cloudflare: {
        async getPagesDomain() {
          return undefined;
        },
        async listDnsRecordsExact() {
          return {
            result: [
              {
                id: recordId,
                name: spec.hostname,
                type: "CNAME",
                content: previewDomainContract.pagesProjectDomain,
                proxied: true,
                comment: "",
                tags: [],
              },
            ],
            resultInfo: { total_pages: 1 },
          };
        },
        async deletePagesDomain() {
          foreignDeletes += 1;
        },
        async deleteDnsRecord() {
          foreignDeletes += 1;
        },
      },
      spec,
    }),
    /unowned or unsafe/u,
  );
  assert.equal(foreignDeletes, 0);
});

test("cleanup retry converges when Pages deletion succeeded but its response failed", async () => {
  const spec = buildManualPreviewSpec("zoey");
  let domain = activeDomain(spec.hostname);
  let record = ownedRecord(spec);
  let domainDeletes = 0;
  let dnsDeletes = 0;
  const cloudflare = {
    async getPagesDomain() {
      return domain;
    },
    async listDnsRecordsExact() {
      return {
        result: record ? [record] : [],
        resultInfo: { total_pages: 1 },
      };
    },
    async deletePagesDomain() {
      domainDeletes += 1;
      domain = undefined;
      throw new Error("Pages delete response was lost");
    },
    async deleteDnsRecord() {
      dnsDeletes += 1;
      record = undefined;
    },
  };
  await assert.rejects(
    removePreviewDomain({ cloudflare, spec }),
    /response was lost/u,
  );
  assert.equal(domain, undefined);
  assert.ok(record);
  assert.deepEqual(await removePreviewDomain({ cloudflare, spec }), {
    status: "removed",
    hostname: spec.hostname,
  });
  assert.equal(domainDeletes, 1);
  assert.equal(dnsDeletes, 1);
  assert.equal(record, undefined);
});

test("cleanup retry converges after DNS deletion fails", async () => {
  const spec = buildManualPreviewSpec("zoey");
  let domain = activeDomain(spec.hostname);
  let record = ownedRecord(spec);
  let domainDeletes = 0;
  let dnsDeletes = 0;
  const cloudflare = {
    async getPagesDomain() {
      return domain;
    },
    async listDnsRecordsExact() {
      return {
        result: record ? [record] : [],
        resultInfo: { total_pages: 1 },
      };
    },
    async deletePagesDomain() {
      domainDeletes += 1;
      domain = undefined;
    },
    async deleteDnsRecord() {
      dnsDeletes += 1;
      if (dnsDeletes === 1) throw new Error("transient DNS delete failure");
      record = undefined;
    },
  };
  await assert.rejects(
    removePreviewDomain({ cloudflare, spec }),
    /transient DNS delete failure/u,
  );
  assert.equal(domain, undefined);
  assert.ok(record);
  assert.deepEqual(await removePreviewDomain({ cloudflare, spec }), {
    status: "removed",
    hostname: spec.hostname,
  });
  assert.equal(domainDeletes, 1);
  assert.equal(dnsDeletes, 2);
  assert.equal(record, undefined);
});

test("cleanup never deletes a DNS record raced in after association removal", async () => {
  const spec = buildManualPreviewSpec("zoey");
  const record = ownedRecord(spec);
  const foreign = {
    id: "e".repeat(32),
    name: spec.hostname,
    type: "TXT",
    content: "foreign",
    proxied: false,
    comment: "foreign owner",
  };
  let domain = activeDomain(spec.hostname);
  let dnsReads = 0;
  let dnsDeletes = 0;
  await assert.rejects(
    removePreviewDomain({
      cloudflare: {
        async getPagesDomain() {
          return domain;
        },
        async listDnsRecordsExact() {
          dnsReads += 1;
          return {
            result: dnsReads < 3 ? [record] : [foreign],
            resultInfo: { total_pages: 1 },
          };
        },
        async deletePagesDomain() {
          domain = undefined;
        },
        async deleteDnsRecord() {
          dnsDeletes += 1;
        },
      },
      spec,
    }),
    /changed after Pages association removal/u,
  );
  assert.equal(domain, undefined);
  assert.equal(dnsDeletes, 0);
});

test("cleanup requires the complete versioned comment and safe proxied project alias", async () => {
  const spec = buildPrPreviewSpec(42);
  assert.equal(
    isOwnedDnsRecord(
      ownedRecord(
        buildPrPreviewSpec(42, "blue-crystal.atrinik-website.pages.dev"),
      ),
      spec,
      { requireTarget: false },
    ),
    true,
  );
  assert.equal(
    isOwnedDnsRecord(
      ownedRecord(buildPrPreviewSpec(42, "safe.atrinik-website.pages.dev"), {
        content: previewDomainContract.pagesProjectDomain,
      }),
      spec,
      { requireTarget: false },
    ),
    false,
  );
  for (const drift of [
    { comment: "" },
    { comment: "atrinik/website-preview:v0;key=pr-42" },
    { comment: "atrinik/website-preview:v1" },
    { proxied: false },
    { content: "safe.some-other-project.pages.dev" },
    { content: "https://safe.atrinik-website.pages.dev" },
  ]) {
    const record = ownedRecord(
      buildPrPreviewSpec(42, "safe.atrinik-website.pages.dev"),
      drift,
    );
    assert.equal(
      isOwnedDnsRecord(record, spec, { requireTarget: false }),
      false,
    );
    let deletes = 0;
    await assert.rejects(
      removePreviewDomain({
        cloudflare: {
          async getPagesDomain() {
            return activeDomain(spec.hostname);
          },
          async listDnsRecordsExact() {
            return { result: [record], resultInfo: { total_pages: 1 } };
          },
          async deleteDnsRecord() {
            deletes += 1;
          },
          async deletePagesDomain() {
            deletes += 1;
          },
        },
        spec,
      }),
      /unowned or unsafe/u,
    );
    assert.equal(deletes, 0);
  }
});

test("cleanup refuses duplicate exact-name records", async () => {
  const spec = buildPrPreviewSpec(42);
  for (const records of [
    [
      ownedRecord(buildPrPreviewSpec(42, "safe.atrinik-website.pages.dev")),
      {
        id: "e".repeat(32),
        name: spec.hostname,
        type: "TXT",
      },
    ],
  ]) {
    let deletes = 0;
    await assert.rejects(
      removePreviewDomain({
        cloudflare: {
          async getPagesDomain() {
            return activeDomain(spec.hostname);
          },
          async listDnsRecordsExact() {
            return { result: records, resultInfo: { total_pages: 1 } };
          },
          async deleteDnsRecord() {
            deletes += 1;
          },
          async deletePagesDomain() {
            deletes += 1;
          },
        },
        spec,
      }),
    );
    assert.equal(deletes, 0);
  }
});

test("PR ensure rechecks live state and attaches the returned alias", async () => {
  const githubCalls = [];
  const github = {
    async getPullRequest() {
      githubCalls.push("get");
      return pullRequest();
    },
  };
  let domainRead = 0;
  let dnsRead = 0;
  let createdSpec;
  let currentRecord;
  const cloudflare = {
    async listPreviewDeployments() {
      return {
        result: [deployment()],
        resultInfo: { total_pages: 1 },
      };
    },
    async getPagesDomain() {
      domainRead += 1;
      return domainRead === 1
        ? undefined
        : activeDomain("pr.42.testing.atrinik.org");
    },
    async addPagesDomain(hostname) {
      return activeDomain(hostname, { status: "pending" });
    },
    async deletePagesDomain() {},
    async listDnsRecordsExact() {
      dnsRead += 1;
      return {
        result: currentRecord ? [currentRecord] : [],
        resultInfo: { total_pages: 1 },
      };
    },
    async createDnsRecord(spec) {
      createdSpec = spec;
      currentRecord = ownedRecord(spec);
      return currentRecord;
    },
    async updateDnsRecord() {
      assert.fail("no update expected");
    },
    async deleteDnsRecord() {},
  };
  const result = await ensurePullRequestPreview({
    cloudflare,
    github,
    number: 42,
    expectedHeadRef: "feature/blue-crystal",
    expectedHeadSha: headSha,
    deploymentAttempts: 1,
    deploymentDelayMilliseconds: 0,
    readinessAttempts: 1,
    readinessDelayMilliseconds: 0,
    delay: async () => {},
  });
  assert.equal(result.status, "active");
  assert.equal(createdSpec.target, "blue-crystal.atrinik-website.pages.dev");
  assert.equal(githubCalls.length, 3);
  assert.equal(dnsRead, 3);
});

test("PR ensure aborts a close race before any Cloudflare mutation", async () => {
  let githubRead = 0;
  let mutations = 0;
  const cloudflare = {
    async listPreviewDeployments() {
      return { result: [deployment()], resultInfo: { total_pages: 1 } };
    },
    async getPagesDomain() {
      mutations += 1;
    },
  };
  await assert.rejects(
    ensurePullRequestPreview({
      cloudflare,
      github: {
        async getPullRequest() {
          githubRead += 1;
          return pullRequest({ state: githubRead === 1 ? "open" : "closed" });
        },
      },
      number: 42,
      expectedHeadRef: "feature/blue-crystal",
      expectedHeadSha: headSha,
      deploymentAttempts: 1,
      deploymentDelayMilliseconds: 0,
      delay: async () => {},
    }),
    /not open/u,
  );
  assert.equal(githubRead, 2);
  assert.equal(mutations, 0);
});

test("PR ensure removes its exact owned mapping when the PR closes after setup", async () => {
  let githubRead = 0;
  let domain;
  let record;
  const events = [];
  const cloudflare = {
    async listPreviewDeployments() {
      return { result: [deployment()], resultInfo: { total_pages: 1 } };
    },
    async getPagesDomain() {
      return domain;
    },
    async addPagesDomain(hostname) {
      domain = activeDomain(hostname);
      events.push("add-domain");
      return domain;
    },
    async deletePagesDomain() {
      events.push("delete-domain");
      domain = undefined;
    },
    async listDnsRecordsExact() {
      return {
        result: record ? [record] : [],
        resultInfo: { total_pages: 1 },
      };
    },
    async createDnsRecord(spec) {
      events.push("create-dns");
      record = ownedRecord(spec);
      return record;
    },
    async updateDnsRecord() {
      assert.fail("no update expected");
    },
    async deleteDnsRecord() {
      events.push("delete-dns");
      record = undefined;
    },
  };
  await assert.rejects(
    ensurePullRequestPreview({
      cloudflare,
      github: {
        async getPullRequest() {
          githubRead += 1;
          return pullRequest({ state: githubRead < 3 ? "open" : "closed" });
        },
      },
      number: 42,
      expectedHeadRef: "feature/blue-crystal",
      expectedHeadSha: headSha,
      deploymentAttempts: 1,
      deploymentDelayMilliseconds: 0,
      readinessAttempts: 1,
      readinessDelayMilliseconds: 0,
      delay: async () => {},
    }),
    /closed while/u,
  );
  assert.equal(domain, undefined);
  assert.equal(record, undefined);
  assert.deepEqual(events, [
    "add-domain",
    "create-dns",
    "delete-domain",
    "delete-dns",
  ]);
});

test("PR close cleanup is skipped when the pull request is open or reopened", async () => {
  let cloudflareReads = 0;
  assert.deepEqual(
    await removePullRequestPreview({
      cloudflare: {},
      github: {
        async getPullRequest() {
          return pullRequest();
        },
      },
      number: 42,
    }),
    { status: "skipped-open", hostname: "pr.42.testing.atrinik.org" },
  );

  let githubRead = 0;
  const spec = buildPrPreviewSpec(42, "blue-crystal.atrinik-website.pages.dev");
  const result = await removePullRequestPreview({
    cloudflare: {
      async getPagesDomain() {
        cloudflareReads += 1;
        return activeDomain(spec.hostname);
      },
      async listDnsRecordsExact() {
        cloudflareReads += 1;
        return {
          result: [ownedRecord(spec)],
          resultInfo: { total_pages: 1 },
        };
      },
      async deleteDnsRecord() {
        assert.fail("reopened PR DNS must remain");
      },
      async deletePagesDomain() {
        assert.fail("reopened PR domain must remain");
      },
    },
    github: {
      async getPullRequest() {
        githubRead += 1;
        return pullRequest({ state: githubRead === 1 ? "closed" : "open" });
      },
    },
    number: 42,
  });
  assert.deepEqual(result, {
    status: "skipped",
    hostname: "pr.42.testing.atrinik.org",
  });
  assert.equal(githubRead, 2);
  assert.equal(cloudflareReads, 2);
});

test("CLI validates its environment before fetching and never logs secrets", async () => {
  let fetches = 0;
  const logs = [];
  await assert.rejects(
    runPreviewDomainCli({
      env: {
        PREVIEW_ACTION: "ensure-manual",
        PREVIEW_PREFIX: "zoey",
        PREVIEW_HEAD_SHA: headSha,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_ZONE_ID: zoneId,
        CLOUDFLARE_API_TOKEN: "bad token",
      },
      fetchImpl: async () => {
        fetches += 1;
      },
      logger: { log: (message) => logs.push(message) },
    }),
    (error) =>
      !error.message.includes("bad token") &&
      /CLOUDFLARE_API_TOKEN is invalid/u.test(error.message),
  );
  assert.equal(fetches, 0);
  assert.deepEqual(logs, []);
  await assert.rejects(
    runPreviewDomainCli({
      env: {
        PREVIEW_ACTION: "ensure-pr",
        PREVIEW_PR_NUMBER: "42",
        PREVIEW_HEAD_REF: "feature/blue-crystal",
        PREVIEW_HEAD_SHA: headSha,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_ZONE_ID: zoneId,
        CLOUDFLARE_API_TOKEN: apiToken,
        GITHUB_REPOSITORY: "someone/website",
        GITHUB_TOKEN: githubToken,
      },
      fetchImpl: async () => {
        fetches += 1;
      },
      logger: { log: (message) => logs.push(message) },
    }),
    /outside the deployment contract/u,
  );
  assert.equal(fetches, 0);
  assert.equal(
    logs.some((message) => message.includes(apiToken)),
    false,
  );
  assert.equal(
    logs.some((message) => message.includes(githubToken)),
    false,
  );
});

test("GitHub manager uses the fixed repository endpoint", async () => {
  const calls = [];
  const api = createGitHubApi({
    token: githubToken,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return githubResponse(pullRequest());
    },
  });
  assert.deepEqual(await api.getPullRequest(42), pullRequest());
  assert.equal(
    calls[0].url,
    "https://api.github.com/repos/atrinik/website/pulls/42",
  );
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${githubToken}`);
  assert.equal(calls[0].options.headers["X-GitHub-Api-Version"], "2026-03-10");
  assert.throws(
    () =>
      createGitHubApi({
        token: githubToken,
        repository: "someone/website",
        fetchImpl: async () => githubResponse({}),
      }),
    /outside the deployment contract/u,
  );
});
