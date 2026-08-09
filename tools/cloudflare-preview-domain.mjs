import { pathToFileURL } from "node:url";

export const previewDomainContract = Object.freeze({
  project: "atrinik-website",
  repository: "atrinik/website",
  repositoryId: 1327107093,
  productionBranch: "main",
  productionDomains: Object.freeze(["atrinik.org", "www.atrinik.org"]),
  baseDomain: "testing.atrinik.org",
  pagesSuffix: ".atrinik-website.pages.dev",
  pagesProjectDomain: "atrinik-website.pages.dev",
  ownerCommentPrefix: "atrinik/website-preview:v1;key=",
});

const cloudflareApiBase = "https://api.cloudflare.com/client/v4";
const githubApiBase = "https://api.github.com";
const terminalDomainStatuses = new Set(["blocked", "deactivated", "error"]);
const pendingDomainStatuses = new Set(["initializing", "pending"]);
const safeToken = /^[A-Za-z0-9._~-]{20,512}$/u;
const cloudflareId = /^[a-f0-9]{32}$/iu;
const fullCommitSha = /^[a-f0-9]{40}$/iu;
const manualPrefix = /^[a-z0-9](?:[a-z0-9-]{0,54}[a-z0-9])?$/u;
const pagesLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const prNumber = /^[1-9][0-9]{0,15}$/u;
const maximumPollAttempts = 60;
const maximumDeploymentPages = 5;
const requestTimeoutMilliseconds = 15_000;

function fail(message) {
  throw new Error(message);
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(`${label} is not an object`);
  return value;
}

function requireFunction(value, label) {
  if (typeof value !== "function") fail(`${label} is not a function`);
  return value;
}

function requireExactString(value, label, pattern) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    (pattern && !pattern.test(value))
  )
    fail(`${label} is invalid`);
  return value;
}

function requirePollAttempts(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximumPollAttempts)
    fail(`${label} must be between 1 and ${maximumPollAttempts}`);
  return value;
}

function requireDelayMilliseconds(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 60_000)
    fail(`${label} must be between 0 and 60000 milliseconds`);
  return value;
}

function requiredEnvironment(env, name, pattern) {
  requireObject(env, "environment");
  return requireExactString(env[name], name, pattern);
}

export function validateManualPrefix(value) {
  requireExactString(value, "manual preview prefix", manualPrefix);
  if (`manual-${value}`.length > 63) fail("manual preview prefix is too long");
  return value;
}

export function validatePrNumber(value) {
  const canonical =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : value;
  requireExactString(canonical, "pull request number", prNumber);
  if (BigInt(canonical) > BigInt(Number.MAX_SAFE_INTEGER))
    fail("pull request number is too large");
  return canonical;
}

export function validateCommitSha(value, label = "commit SHA") {
  return requireExactString(value, label, fullCommitSha).toLowerCase();
}

export function validateHeadRef(value) {
  requireExactString(value, "pull request head ref");
  if (
    value.length > 255 ||
    /[\u0000-\u0020\u007f~^:?*[\\]/u.test(value) ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.startsWith(".") ||
    value.endsWith(".") ||
    value.endsWith(".lock") ||
    value.includes("..") ||
    value.includes("//") ||
    value.includes("@{") ||
    value === previewDomainContract.productionBranch
  )
    fail("pull request head ref is unsafe");
  return value;
}

function ownership(kind, key) {
  const identity = kind === "pr" ? `pr-${key}` : `manual-${key}`;
  return Object.freeze({
    comment: `${previewDomainContract.ownerCommentPrefix}${identity}`,
  });
}

function pagesHostnameFromAlias(value, label = "Pages branch alias") {
  requireExactString(value, label);
  let hostname = value;
  if (value.includes(":")) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      fail(`${label} is invalid`);
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      fail(`${label} is not a bare HTTPS origin`);
    hostname = parsed.hostname;
  }
  if (hostname !== hostname.toLowerCase()) fail(`${label} is not canonical`);
  if (!hostname.endsWith(previewDomainContract.pagesSuffix))
    fail(`${label} is outside the Pages project`);
  const alias = hostname.slice(0, -previewDomainContract.pagesSuffix.length);
  if (
    !pagesLabel.test(alias) ||
    alias === previewDomainContract.productionBranch
  )
    fail(`${label} is not a safe preview alias`);
  return hostname;
}

export function buildManualPreviewSpec(prefix) {
  const key = validateManualPrefix(prefix);
  const branchAlias = `manual-${key}`;
  const owner = ownership("manual", key);
  return Object.freeze({
    kind: "manual",
    key,
    prefix: key,
    hostname: `${key}.${previewDomainContract.baseDomain}`,
    branchAlias,
    target: `${branchAlias}${previewDomainContract.pagesSuffix}`,
    comment: owner.comment,
  });
}

export function buildPrPreviewSpec(number, branchAlias) {
  const key = validatePrNumber(number);
  const owner = ownership("pr", key);
  const target =
    branchAlias === undefined
      ? undefined
      : pagesHostnameFromAlias(branchAlias, "pull request Pages alias");
  return Object.freeze({
    kind: "pr",
    key,
    number: key,
    hostname: `pr.${key}.${previewDomainContract.baseDomain}`,
    ...(target === undefined
      ? {}
      : {
          branchAlias: target.slice(
            0,
            -previewDomainContract.pagesSuffix.length,
          ),
          target,
        }),
    comment: owner.comment,
  });
}

function canonicalSpec(spec, requireTarget = true) {
  requireObject(spec, "preview domain specification");
  const canonical =
    spec.kind === "manual"
      ? buildManualPreviewSpec(spec.prefix)
      : spec.kind === "pr"
        ? buildPrPreviewSpec(spec.number, spec.target)
        : fail("preview domain kind is invalid");
  if (requireTarget && canonical.target === undefined)
    fail("preview domain target is required");
  for (const field of ["hostname", "comment"]) {
    if (spec[field] !== canonical[field])
      fail(`preview domain ${field} is not canonical`);
  }
  if (Object.hasOwn(spec, "tags"))
    fail("preview domain specification contains unsupported DNS tags");
  if (spec.target !== canonical.target)
    fail("preview domain target is not canonical");
  return canonical;
}

function validateApiConfiguration({ accountId, zoneId, apiToken }) {
  requireExactString(accountId, "Cloudflare account ID", cloudflareId);
  requireExactString(zoneId, "Cloudflare zone ID", cloudflareId);
  requireExactString(apiToken, "Cloudflare API token", safeToken);
  return { accountId, zoneId, apiToken };
}

async function parseJsonResponse(response, label) {
  if (
    response === null ||
    typeof response !== "object" ||
    typeof response.ok !== "boolean" ||
    !Number.isInteger(response.status) ||
    typeof response.json !== "function"
  )
    fail(`${label} returned an invalid response`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    fail(`${label} returned invalid JSON (HTTP ${response.status})`);
  }
  return payload;
}

async function cloudflareRequest(
  fetchImpl,
  apiToken,
  path,
  { method = "GET", body, allowNotFound = false, label },
) {
  let response;
  try {
    response = await fetchImpl(`${cloudflareApiBase}${path}`, {
      method,
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    fail(`${label} request failed`);
  }
  if (allowNotFound && response.status === 404) return undefined;
  const payload = await parseJsonResponse(response, label);
  if (!response.ok || payload?.success !== true)
    fail(`${label} failed (HTTP ${response.status})`);
  return requireObject(payload, `${label} payload`);
}

function dnsBody(spec) {
  const canonical = canonicalSpec(spec);
  return {
    type: "CNAME",
    name: canonical.hostname,
    content: canonical.target,
    ttl: 1,
    proxied: true,
    comment: canonical.comment,
  };
}

export function createCloudflareApi({
  accountId,
  zoneId,
  apiToken,
  fetchImpl = globalThis.fetch,
}) {
  const configuration = validateApiConfiguration({
    accountId,
    zoneId,
    apiToken,
  });
  requireFunction(fetchImpl, "fetch implementation");
  const account = encodeURIComponent(configuration.accountId);
  const zone = encodeURIComponent(configuration.zoneId);
  const project = encodeURIComponent(previewDomainContract.project);
  const domainsPath = `/accounts/${account}/pages/projects/${project}/domains`;

  return Object.freeze({
    async listPagesDomains({ page = 1, perPage = 100 } = {}) {
      if (!Number.isSafeInteger(page) || page < 1)
        fail("domain page is invalid");
      if (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100)
        fail("domain page size is invalid");
      const query = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
      });
      const payload = await cloudflareRequest(
        fetchImpl,
        configuration.apiToken,
        `${domainsPath}?${query}`,
        { label: "list Pages domains" },
      );
      if (!Array.isArray(payload.result))
        fail("list Pages domains returned invalid data");
      return { result: payload.result, resultInfo: payload.result_info };
    },

    async getPagesDomain(hostname) {
      const safeHostname = validatePreviewHostname(hostname);
      const payload = await cloudflareRequest(
        fetchImpl,
        configuration.apiToken,
        `${domainsPath}/${encodeURIComponent(safeHostname)}`,
        { allowNotFound: true, label: "get Pages domain" },
      );
      if (payload === undefined) return undefined;
      return requireObject(payload.result, "Pages domain");
    },

    async addPagesDomain(hostname) {
      const safeHostname = validatePreviewHostname(hostname);
      const payload = await cloudflareRequest(
        fetchImpl,
        configuration.apiToken,
        domainsPath,
        {
          method: "POST",
          body: { name: safeHostname },
          label: "add Pages domain",
        },
      );
      return requireObject(payload.result, "created Pages domain");
    },

    async deletePagesDomain(hostname) {
      const safeHostname = validatePreviewHostname(hostname);
      await cloudflareRequest(
        fetchImpl,
        configuration.apiToken,
        `${domainsPath}/${encodeURIComponent(safeHostname)}`,
        { method: "DELETE", label: "delete Pages domain" },
      );
    },

    async listPreviewDeployments({ page = 1, perPage = 100 } = {}) {
      if (!Number.isSafeInteger(page) || page < 1)
        fail("deployment page is invalid");
      if (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100)
        fail("deployment page size is invalid");
      const query = new URLSearchParams({
        env: "preview",
        page: String(page),
        per_page: String(perPage),
      });
      const payload = await cloudflareRequest(
        fetchImpl,
        configuration.apiToken,
        `/accounts/${account}/pages/projects/${project}/deployments?${query}`,
        { label: "list Pages preview deployments" },
      );
      if (!Array.isArray(payload.result))
        fail("list Pages preview deployments returned invalid data");
      return { result: payload.result, resultInfo: payload.result_info };
    },

    async listDnsRecordsExact(hostname, { page = 1, perPage = 100 } = {}) {
      const safeHostname = validatePreviewHostname(hostname);
      if (!Number.isSafeInteger(page) || page < 1) fail("DNS page is invalid");
      if (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100)
        fail("DNS page size is invalid");
      const query = new URLSearchParams({
        "name.exact": safeHostname,
        match: "all",
        page: String(page),
        per_page: String(perPage),
      });
      const payload = await cloudflareRequest(
        fetchImpl,
        configuration.apiToken,
        `/zones/${zone}/dns_records?${query}`,
        { label: "list exact DNS records" },
      );
      if (!Array.isArray(payload.result))
        fail("list exact DNS records returned invalid data");
      return { result: payload.result, resultInfo: payload.result_info };
    },

    async createDnsRecord(spec) {
      const payload = await cloudflareRequest(
        fetchImpl,
        configuration.apiToken,
        `/zones/${zone}/dns_records`,
        {
          method: "POST",
          body: dnsBody(spec),
          label: "create preview DNS record",
        },
      );
      return requireObject(payload.result, "created DNS record");
    },

    async updateDnsRecord(id, spec) {
      const safeId = requireExactString(id, "DNS record ID", cloudflareId);
      const payload = await cloudflareRequest(
        fetchImpl,
        configuration.apiToken,
        `/zones/${zone}/dns_records/${encodeURIComponent(safeId)}`,
        {
          method: "PATCH",
          body: dnsBody(spec),
          label: "update preview DNS record",
        },
      );
      return requireObject(payload.result, "updated DNS record");
    },

    async deleteDnsRecord(id) {
      const safeId = requireExactString(id, "DNS record ID", cloudflareId);
      await cloudflareRequest(
        fetchImpl,
        configuration.apiToken,
        `/zones/${zone}/dns_records/${encodeURIComponent(safeId)}`,
        { method: "DELETE", label: "delete preview DNS record" },
      );
    },
  });
}

export function validatePreviewHostname(hostname) {
  requireExactString(hostname, "preview hostname");
  if (
    hostname !== hostname.toLowerCase() ||
    !hostname.endsWith(`.${previewDomainContract.baseDomain}`) ||
    hostname === previewDomainContract.baseDomain ||
    hostname.includes("*") ||
    previewDomainContract.productionDomains.includes(hostname)
  )
    fail("preview hostname is outside the managed namespace");
  const labels = hostname.split(".");
  if (hostname.length > 253 || labels.some((label) => !pagesLabel.test(label)))
    fail("preview hostname is invalid");
  const isManual =
    labels.length === 4 && hostname.endsWith(".testing.atrinik.org");
  const isPr =
    labels.length === 5 &&
    labels[0] === "pr" &&
    prNumber.test(labels[1]) &&
    hostname.endsWith(".testing.atrinik.org");
  if (!isManual && !isPr)
    fail("preview hostname does not match a managed shape");
  return hostname;
}

export function validateLivePullRequest(
  payload,
  number,
  { requiredState, expectedHeadRef, expectedHeadSha } = {},
) {
  const pull = requireObject(payload, "GitHub pull request");
  const expectedNumber = validatePrNumber(number);
  if (String(pull.number) !== expectedNumber)
    fail("live pull request number changed");
  if (!new Set(["open", "closed"]).has(pull.state))
    fail("live pull request state is invalid");
  if (requiredState !== undefined && pull.state !== requiredState)
    fail(`live pull request is not ${requiredState}`);
  const base = requireObject(pull.base, "pull request base");
  const head = requireObject(pull.head, "pull request head");
  const baseRepository = requireObject(
    base.repo,
    "pull request base repository",
  );
  const headRepository = requireObject(
    head.repo,
    "pull request head repository",
  );
  if (
    base.ref !== previewDomainContract.productionBranch ||
    baseRepository.full_name !== previewDomainContract.repository ||
    headRepository.full_name !== previewDomainContract.repository ||
    baseRepository.id !== previewDomainContract.repositoryId ||
    headRepository.id !== previewDomainContract.repositoryId ||
    baseRepository.id !== headRepository.id
  )
    fail("pull request is outside the trusted same-repository main boundary");
  const headRef = validateHeadRef(head.ref);
  const headSha = validateCommitSha(head.sha, "live pull request head SHA");
  if (
    expectedHeadRef !== undefined &&
    headRef !== validateHeadRef(expectedHeadRef)
  )
    fail("live pull request head ref changed");
  if (
    expectedHeadSha !== undefined &&
    headSha !==
      validateCommitSha(expectedHeadSha, "expected pull request head SHA")
  )
    fail("live pull request head SHA changed");
  return Object.freeze({
    number: expectedNumber,
    state: pull.state,
    headRef,
    headSha,
  });
}

export function createGitHubApi({
  token,
  repository = previewDomainContract.repository,
  fetchImpl = globalThis.fetch,
}) {
  requireExactString(token, "GitHub API token", safeToken);
  if (repository !== previewDomainContract.repository)
    fail("GitHub repository is outside the deployment contract");
  requireFunction(fetchImpl, "fetch implementation");
  return Object.freeze({
    async getPullRequest(number) {
      const key = validatePrNumber(number);
      let response;
      try {
        response = await fetchImpl(
          `${githubApiBase}/repos/atrinik/website/pulls/${key}`,
          {
            method: "GET",
            signal: AbortSignal.timeout(requestTimeoutMilliseconds),
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${token}`,
              "X-GitHub-Api-Version": "2026-03-10",
            },
          },
        );
      } catch {
        fail("get live pull request request failed");
      }
      if (!response?.ok)
        fail(
          `get live pull request failed (HTTP ${response?.status ?? "unknown"})`,
        );
      const payload = await parseJsonResponse(
        response,
        "get live pull request",
      );
      return requireObject(payload, "GitHub pull request");
    },
  });
}

function matchingDeploymentAlias(
  deployment,
  headRef,
  headSha,
  requireGitIntegration,
) {
  const record = requireObject(deployment, "Pages deployment");
  const metadata = record.deployment_trigger?.metadata;
  if (
    record.environment !== "preview" ||
    metadata?.branch !== headRef ||
    typeof metadata?.commit_hash !== "string" ||
    metadata.commit_hash.toLowerCase() !== headSha ||
    record.latest_stage?.status !== "success"
  )
    return undefined;
  if (
    record.latest_stage.name !== "deploy" ||
    record.is_skipped !== false ||
    record.uses_functions !== false
  )
    fail("matching Pages deployment is not proven static");
  if (requireGitIntegration) {
    const source = record.source;
    if (
      source?.type !== "github" ||
      source.config?.owner !== "atrinik" ||
      source.config?.repo_name !== "website" ||
      source.config?.production_branch !==
        previewDomainContract.productionBranch ||
      String(source.config?.repo_id) !==
        String(previewDomainContract.repositoryId)
    )
      fail("matching Pages deployment is not from the trusted Git integration");
  }
  if (!Array.isArray(record.aliases))
    fail("matching Pages deployment has no aliases");
  const aliases = new Set(
    record.aliases.map((alias) => pagesHostnameFromAlias(alias)),
  );
  if (aliases.size !== 1)
    fail("matching Pages deployment has ambiguous branch aliases");
  return [...aliases][0];
}

export function selectPagesBranchAlias(
  deployments,
  { headRef, headSha, expectedAlias, requireGitIntegration = false } = {},
) {
  if (!Array.isArray(deployments)) fail("Pages deployments are invalid");
  const safeRef = validateHeadRef(headRef);
  const safeSha = validateCommitSha(headSha);
  const aliases = new Set();
  for (const deployment of deployments) {
    const alias = matchingDeploymentAlias(
      deployment,
      safeRef,
      safeSha,
      requireGitIntegration,
    );
    if (alias !== undefined) aliases.add(alias);
  }
  if (aliases.size === 0) return undefined;
  if (aliases.size !== 1)
    fail("successful Pages deployments disagree on their branch alias");
  const alias = [...aliases][0];
  if (
    expectedAlias !== undefined &&
    alias !== pagesHostnameFromAlias(expectedAlias, "expected Pages alias")
  )
    fail("Pages returned an unexpected branch alias");
  return alias;
}

function resultPageCount(resultInfo) {
  if (resultInfo === undefined) return 1;
  if (resultInfo === null || typeof resultInfo !== "object")
    fail("Cloudflare pagination metadata is invalid");
  const pages = resultInfo.total_pages;
  if (!Number.isSafeInteger(pages) || pages < 1)
    fail("Cloudflare page count is invalid");
  return Math.min(pages, maximumDeploymentPages);
}

export async function pollPagesBranchAlias({
  cloudflare,
  headRef,
  headSha,
  expectedAlias,
  requireGitIntegration = false,
  attempts = 30,
  delayMilliseconds = 10_000,
  delay = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  requireObject(cloudflare, "Cloudflare API manager");
  requireFunction(cloudflare.listPreviewDeployments, "deployment list method");
  requireFunction(delay, "delay implementation");
  requirePollAttempts(attempts, "deployment poll attempts");
  requireDelayMilliseconds(delayMilliseconds, "deployment poll delay");
  const safeSha = validateCommitSha(headSha);
  const safeRef = validateHeadRef(headRef);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const first = await cloudflare.listPreviewDeployments({
      page: 1,
      perPage: 100,
    });
    const pages = resultPageCount(first.resultInfo);
    let alias = selectPagesBranchAlias(first.result, {
      headRef: safeRef,
      headSha: safeSha,
      expectedAlias,
      requireGitIntegration,
    });
    if (alias !== undefined) return alias;
    for (let page = 2; page <= pages; page += 1) {
      const next = await cloudflare.listPreviewDeployments({
        page,
        perPage: 100,
      });
      alias = selectPagesBranchAlias(next.result, {
        headRef: safeRef,
        headSha: safeSha,
        expectedAlias,
        requireGitIntegration,
      });
      if (alias !== undefined) return alias;
    }
    if (attempt < attempts) await delay(delayMilliseconds);
  }
  fail("timed out waiting for the successful Pages branch deployment");
}

function assertExactDnsResults(response, hostname) {
  const result = requireObject(response, "exact DNS response");
  if (!Array.isArray(result.result)) fail("exact DNS results are invalid");
  if (
    result.resultInfo === null ||
    typeof result.resultInfo !== "object" ||
    !Number.isSafeInteger(result.resultInfo.total_pages) ||
    result.resultInfo.total_pages !== 1
  )
    fail("exact DNS lookup was not exhaustive");
  for (const record of result.result) {
    requireObject(record, "DNS record");
    if (record.name !== hostname)
      fail("exact DNS lookup returned a different hostname");
  }
  return result.result;
}

export function isOwnedDnsRecord(record, spec, { requireTarget = true } = {}) {
  if (record === null || typeof record !== "object" || Array.isArray(record))
    return false;
  let canonical;
  try {
    canonical = canonicalSpec(spec, requireTarget);
  } catch {
    return false;
  }
  if (
    !cloudflareId.test(record.id) ||
    record.name !== canonical.hostname ||
    record.type !== "CNAME" ||
    record.comment !== canonical.comment ||
    record.proxied !== true
  )
    return false;
  if (requireTarget) return record.content === canonical.target;
  if (canonical.kind === "manual") return record.content === canonical.target;
  if (typeof record.content !== "string" || record.content.includes(":"))
    return false;
  try {
    pagesHostnameFromAlias(record.content, "owned PR DNS target");
  } catch {
    return false;
  }
  return true;
}

function isNewPagesManagedRecord(record, spec) {
  return (
    record !== null &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    cloudflareId.test(record.id) &&
    record.name === spec.hostname &&
    record.type === "CNAME" &&
    record.content === previewDomainContract.pagesProjectDomain &&
    record.proxied === true &&
    (record.comment === undefined ||
      record.comment === null ||
      record.comment === "") &&
    (record.tags === undefined ||
      record.tags === null ||
      (Array.isArray(record.tags) && record.tags.length === 0))
  );
}

function validateStableDomainIdentity(value) {
  return requireExactString(
    value,
    "Pages domain identity",
    /^[A-Za-z0-9._-]{1,512}$/u,
  );
}

function validatePagesDomain(domain, hostname) {
  const record = requireObject(domain, "Pages domain");
  if (record.name !== hostname) fail("Pages domain identity is invalid");
  validateStableDomainIdentity(record.id);
  return record;
}

export function classifyPagesDomainStatus(domain) {
  const record = requireObject(domain, "Pages domain");
  const statuses = {
    domain: record.status,
    validation: record.validation_data?.status,
    verification: record.verification_data?.status,
  };
  for (const [name, status] of Object.entries(statuses)) {
    if (typeof status !== "string")
      fail(`Pages domain ${name} status is missing`);
    if (terminalDomainStatuses.has(status))
      return Object.freeze({ ready: false, terminal: true, name, status });
    if (status !== "active" && !pendingDomainStatuses.has(status))
      fail(`Pages domain ${name} status is unknown`);
  }
  return Object.freeze({
    ready: Object.values(statuses).every((status) => status === "active"),
    terminal: false,
    statuses: Object.freeze(statuses),
  });
}

export async function pollPagesDomainReady({
  cloudflare,
  hostname,
  attempts = 30,
  delayMilliseconds = 10_000,
  delay = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  requireObject(cloudflare, "Cloudflare API manager");
  requireFunction(cloudflare.getPagesDomain, "Pages domain get method");
  const safeHostname = validatePreviewHostname(hostname);
  requirePollAttempts(attempts, "domain poll attempts");
  requireDelayMilliseconds(delayMilliseconds, "domain poll delay");
  requireFunction(delay, "delay implementation");
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const domain = await cloudflare.getPagesDomain(safeHostname);
    if (domain !== undefined) {
      validatePagesDomain(domain, safeHostname);
      const state = classifyPagesDomainStatus(domain);
      if (state.ready) return domain;
      if (state.terminal)
        fail(
          `Pages domain reached terminal ${state.name} status ${state.status}`,
        );
    }
    if (attempt < attempts) await delay(delayMilliseconds);
  }
  fail("timed out waiting for the Pages domain to become active");
}

async function exactDnsRecords(cloudflare, hostname) {
  return assertExactDnsResults(
    await cloudflare.listDnsRecordsExact(hostname, {
      page: 1,
      perPage: 100,
    }),
    hostname,
  );
}

async function safelyDeleteCreatedRecord(cloudflare, record, spec) {
  if (!record || !isOwnedDnsRecord(record, spec)) return;
  const current = await exactDnsRecords(cloudflare, spec.hostname);
  if (
    current.length === 1 &&
    current[0].id === record.id &&
    isOwnedDnsRecord(current[0], spec)
  )
    await cloudflare.deleteDnsRecord(record.id);
}

function isSameOwnedDnsRecord(current, previous, spec) {
  return (
    current !== null &&
    typeof current === "object" &&
    previous !== null &&
    typeof previous === "object" &&
    current.id === previous.id &&
    current.name === previous.name &&
    current.type === previous.type &&
    current.content === previous.content &&
    current.proxied === previous.proxied &&
    current.comment === previous.comment &&
    isOwnedDnsRecord(current, spec, { requireTarget: false })
  );
}

function isSamePagesManagedDnsRecord(current, previous, spec) {
  return (
    current !== null &&
    typeof current === "object" &&
    previous !== null &&
    typeof previous === "object" &&
    current.id === previous.id &&
    current.name === previous.name &&
    current.type === previous.type &&
    current.content === previous.content &&
    current.proxied === previous.proxied &&
    current.comment === previous.comment &&
    isNewPagesManagedRecord(current, spec)
  );
}

async function safelyRollbackCreatedResources({
  cloudflare,
  createdDomain,
  createdRecord,
  spec,
}) {
  if (createdDomain) {
    const current = await cloudflare.getPagesDomain(spec.hostname);
    if (current !== undefined) {
      const validated = validatePagesDomain(current, spec.hostname);
      if (validated.id !== createdDomain.id)
        fail("Pages domain changed before setup rollback");
      await cloudflare.deletePagesDomain(spec.hostname);
      if ((await cloudflare.getPagesDomain(spec.hostname)) !== undefined)
        fail("Pages domain remained after setup rollback");
    }
  }
  await safelyDeleteCreatedRecord(cloudflare, createdRecord, spec);
}

export async function ensurePreviewDomain({
  cloudflare,
  spec,
  readinessAttempts = 30,
  readinessDelayMilliseconds = 10_000,
  delay,
}) {
  requireObject(cloudflare, "Cloudflare API manager");
  for (const method of [
    "getPagesDomain",
    "addPagesDomain",
    "deletePagesDomain",
    "listDnsRecordsExact",
    "createDnsRecord",
    "updateDnsRecord",
    "deleteDnsRecord",
  ])
    requireFunction(cloudflare[method], `Cloudflare ${method} method`);
  const canonical = canonicalSpec(spec);
  const preflightDomainValue = await cloudflare.getPagesDomain(
    canonical.hostname,
  );
  const preflightDomain =
    preflightDomainValue === undefined
      ? undefined
      : validatePagesDomain(preflightDomainValue, canonical.hostname);
  const preflightRecords = await exactDnsRecords(
    cloudflare,
    canonical.hostname,
  );
  if (preflightRecords.length > 1)
    fail("preview hostname has conflicting DNS records");
  const preflightRecord = preflightRecords[0];
  const preflightPagesManagedRecord = Boolean(
    preflightDomain &&
    preflightRecord &&
    isNewPagesManagedRecord(preflightRecord, canonical),
  );
  if (
    preflightRecord &&
    !isOwnedDnsRecord(preflightRecord, canonical, { requireTarget: false }) &&
    !preflightPagesManagedRecord
  )
    fail("preview hostname has an unowned DNS record");
  if (preflightDomain && !preflightRecord)
    fail("existing Pages domain has no owned DNS record");

  let createdDomain;
  let createdRecord;
  let record = preflightRecord;
  try {
    if (!preflightDomain) {
      createdDomain = validatePagesDomain(
        await cloudflare.addPagesDomain(canonical.hostname),
        canonical.hostname,
      );
    }

    if (!record) {
      const afterDomain = await exactDnsRecords(cloudflare, canonical.hostname);
      if (afterDomain.length > 1)
        fail("Pages domain creation produced conflicting DNS records");
      if (afterDomain.length === 0) {
        try {
          record = await cloudflare.createDnsRecord(canonical);
        } catch (error) {
          const racedRecords = await exactDnsRecords(
            cloudflare,
            canonical.hostname,
          );
          if (
            racedRecords.length === 1 &&
            createdDomain &&
            isNewPagesManagedRecord(racedRecords[0], canonical)
          )
            record = await cloudflare.updateDnsRecord(
              racedRecords[0].id,
              canonical,
            );
          else throw error;
        }
      } else if (
        createdDomain &&
        isNewPagesManagedRecord(afterDomain[0], canonical)
      ) {
        record = await cloudflare.updateDnsRecord(afterDomain[0].id, canonical);
      } else {
        fail("Pages domain creation found an unexpected DNS record");
      }
      createdRecord = record;
    } else if (!isOwnedDnsRecord(record, canonical)) {
      if (preflightPagesManagedRecord) {
        const currentDomain = await cloudflare.getPagesDomain(
          canonical.hostname,
        );
        if (
          currentDomain === undefined ||
          validatePagesDomain(currentDomain, canonical.hostname).id !==
            preflightDomain.id
        )
          fail("Pages domain changed before claiming managed DNS");
        const currentRecords = await exactDnsRecords(
          cloudflare,
          canonical.hostname,
        );
        if (
          currentRecords.length !== 1 ||
          !isSamePagesManagedDnsRecord(
            currentRecords[0],
            preflightRecord,
            canonical,
          )
        )
          fail("Pages-managed DNS changed before it could be claimed");
        record = currentRecords[0];
      }
      record = await cloudflare.updateDnsRecord(record.id, canonical);
    }

    if (!isOwnedDnsRecord(record, canonical))
      fail("Cloudflare did not preserve the owned DNS record contract");
    const verifiedRecords = await exactDnsRecords(
      cloudflare,
      canonical.hostname,
    );
    if (
      verifiedRecords.length !== 1 ||
      !isSameOwnedDnsRecord(verifiedRecords[0], record, canonical) ||
      !isOwnedDnsRecord(verifiedRecords[0], canonical)
    )
      fail("owned DNS record changed before Pages readiness");
    record = verifiedRecords[0];

    const activeDomain = await pollPagesDomainReady({
      cloudflare,
      hostname: canonical.hostname,
      attempts: readinessAttempts,
      delayMilliseconds: readinessDelayMilliseconds,
      ...(delay === undefined ? {} : { delay }),
    });
    return Object.freeze({
      status: "active",
      hostname: canonical.hostname,
      target: canonical.target,
      pagesDomainId: activeDomain.id,
      dnsRecordId: record.id,
    });
  } catch (error) {
    try {
      await safelyRollbackCreatedResources({
        cloudflare,
        createdDomain,
        createdRecord,
        spec: canonical,
      });
    } catch {
      fail("preview domain setup failed and its owned rollback also failed");
    }
    throw error;
  }
}

export async function removePreviewDomain({
  cloudflare,
  spec,
  authorizeRemoval = async () => true,
}) {
  requireObject(cloudflare, "Cloudflare API manager");
  for (const method of [
    "getPagesDomain",
    "deletePagesDomain",
    "listDnsRecordsExact",
    "deleteDnsRecord",
  ])
    requireFunction(cloudflare[method], `Cloudflare ${method} method`);
  requireFunction(authorizeRemoval, "removal authorization callback");
  const canonical = canonicalSpec(spec, false);
  const domainValue = await cloudflare.getPagesDomain(canonical.hostname);
  const domain =
    domainValue === undefined
      ? undefined
      : validatePagesDomain(domainValue, canonical.hostname);
  const records = await exactDnsRecords(cloudflare, canonical.hostname);
  if (!domain && records.length === 0)
    return Object.freeze({ status: "absent", hostname: canonical.hostname });
  if (records.length > 1) fail("preview cleanup found conflicting DNS records");
  const record = records[0];
  let recordKind;
  if (!record) recordKind = "none";
  else if (isOwnedDnsRecord(record, canonical, { requireTarget: false }))
    recordKind = "owned";
  else if (domain && isNewPagesManagedRecord(record, canonical))
    recordKind = "pages-managed";
  else fail("preview cleanup refused an unowned or unsafe DNS record");
  if ((await authorizeRemoval()) !== true)
    return Object.freeze({ status: "skipped", hostname: canonical.hostname });

  const currentDomainValue = await cloudflare.getPagesDomain(
    canonical.hostname,
  );
  const currentDomain =
    currentDomainValue === undefined
      ? undefined
      : validatePagesDomain(currentDomainValue, canonical.hostname);
  if (
    Boolean(domain) !== Boolean(currentDomain) ||
    (domain && currentDomain.id !== domain.id)
  )
    fail("Pages domain changed during cleanup authorization");
  const currentRecords = await exactDnsRecords(cloudflare, canonical.hostname);
  if (recordKind === "none" && currentRecords.length !== 0)
    fail("DNS records appeared during domain-only cleanup authorization");
  if (
    recordKind === "owned" &&
    (currentRecords.length !== 1 ||
      !isSameOwnedDnsRecord(currentRecords[0], record, canonical))
  )
    fail("DNS ownership changed during cleanup authorization");
  if (
    recordKind === "pages-managed" &&
    (currentRecords.length !== 1 ||
      !currentDomain ||
      !isSamePagesManagedDnsRecord(currentRecords[0], record, canonical))
  )
    fail("Pages-managed DNS record changed during cleanup authorization");
  if ((await authorizeRemoval()) !== true)
    return Object.freeze({ status: "skipped", hostname: canonical.hostname });

  if (recordKind === "pages-managed") {
    await cloudflare.deleteDnsRecord(record.id);
    const afterDnsDelete = await exactDnsRecords(
      cloudflare,
      canonical.hostname,
    );
    if (afterDnsDelete.length !== 0)
      fail("DNS changed or remained after Pages-managed record deletion");
    await cloudflare.deletePagesDomain(canonical.hostname);
    if ((await cloudflare.getPagesDomain(canonical.hostname)) !== undefined)
      fail("Pages domain remained after cleanup deletion");
    if ((await exactDnsRecords(cloudflare, canonical.hostname)).length !== 0)
      fail("DNS appeared after Pages-managed cleanup");
    return Object.freeze({ status: "removed", hostname: canonical.hostname });
  }

  if (currentDomain) {
    await cloudflare.deletePagesDomain(canonical.hostname);
    if ((await cloudflare.getPagesDomain(canonical.hostname)) !== undefined)
      fail("Pages domain remained after cleanup deletion");
  }

  const remainingRecords = await exactDnsRecords(
    cloudflare,
    canonical.hostname,
  );
  if (remainingRecords.length === 0)
    return Object.freeze({ status: "removed", hostname: canonical.hostname });
  if (recordKind === "none")
    fail("DNS appeared after domain-only Pages cleanup");
  if (
    remainingRecords.length !== 1 ||
    !isSameOwnedDnsRecord(remainingRecords[0], record, canonical)
  )
    fail("DNS record changed after Pages association removal");
  if ((await authorizeRemoval()) !== true)
    return Object.freeze({ status: "skipped", hostname: canonical.hostname });
  await cloudflare.deleteDnsRecord(record.id);
  return Object.freeze({ status: "removed", hostname: canonical.hostname });
}

export async function ensurePullRequestPreview({
  cloudflare,
  github,
  number,
  expectedHeadRef,
  expectedHeadSha,
  deploymentAttempts = 30,
  deploymentDelayMilliseconds = 10_000,
  readinessAttempts = 30,
  readinessDelayMilliseconds = 10_000,
  delay,
}) {
  requireObject(github, "GitHub API manager");
  requireFunction(github.getPullRequest, "GitHub pull request get method");
  const key = validatePrNumber(number);
  const first = validateLivePullRequest(await github.getPullRequest(key), key, {
    requiredState: "open",
    expectedHeadRef,
    expectedHeadSha,
  });
  const alias = await pollPagesBranchAlias({
    cloudflare,
    headRef: first.headRef,
    headSha: first.headSha,
    requireGitIntegration: true,
    attempts: deploymentAttempts,
    delayMilliseconds: deploymentDelayMilliseconds,
    ...(delay === undefined ? {} : { delay }),
  });
  validateLivePullRequest(await github.getPullRequest(key), key, {
    requiredState: "open",
    expectedHeadRef: first.headRef,
    expectedHeadSha: first.headSha,
  });
  const spec = buildPrPreviewSpec(key, alias);
  const result = await ensurePreviewDomain({
    cloudflare,
    spec,
    readinessAttempts,
    readinessDelayMilliseconds,
    ...(delay === undefined ? {} : { delay }),
  });
  const finalPayload = await github.getPullRequest(key);
  try {
    validateLivePullRequest(finalPayload, key, {
      requiredState: "open",
      expectedHeadRef: first.headRef,
      expectedHeadSha: first.headSha,
    });
  } catch (error) {
    let final;
    try {
      final = validateLivePullRequest(finalPayload, key);
    } catch {
      final = undefined;
    }
    if (final?.state === "closed") {
      await removePreviewDomain({ cloudflare, spec });
      fail("pull request closed while its preview domain was being attached");
    }
    throw error;
  }
  return result;
}

export async function removePullRequestPreview({ cloudflare, github, number }) {
  requireObject(github, "GitHub API manager");
  requireFunction(github.getPullRequest, "GitHub pull request get method");
  const key = validatePrNumber(number);
  const first = validateLivePullRequest(await github.getPullRequest(key), key);
  if (first.state === "open")
    return Object.freeze({
      status: "skipped-open",
      hostname: buildPrPreviewSpec(key).hostname,
    });
  return removePreviewDomain({
    cloudflare,
    spec: buildPrPreviewSpec(key),
    authorizeRemoval: async () => {
      const current = validateLivePullRequest(
        await github.getPullRequest(key),
        key,
      );
      return (
        current.state === "closed" &&
        current.headRef === first.headRef &&
        current.headSha === first.headSha
      );
    },
  });
}

function cliCloudflare(env, fetchImpl) {
  return createCloudflareApi({
    accountId: requiredEnvironment(env, "CLOUDFLARE_ACCOUNT_ID", cloudflareId),
    zoneId: requiredEnvironment(env, "CLOUDFLARE_ZONE_ID", cloudflareId),
    apiToken: requiredEnvironment(env, "CLOUDFLARE_API_TOKEN", safeToken),
    fetchImpl,
  });
}

function cliGitHub(env, fetchImpl) {
  const repository = requiredEnvironment(env, "GITHUB_REPOSITORY");
  if (repository !== previewDomainContract.repository)
    fail("GITHUB_REPOSITORY is outside the deployment contract");
  if (env.GITHUB_API_URL !== undefined && env.GITHUB_API_URL !== githubApiBase)
    fail("GITHUB_API_URL is outside the deployment contract");
  return createGitHubApi({
    token: requiredEnvironment(env, "GITHUB_TOKEN", safeToken),
    repository,
    fetchImpl,
  });
}

export async function runPreviewDomainCli({
  env = process.env,
  fetchImpl = globalThis.fetch,
  delay,
  logger = console,
  deploymentAttempts,
  deploymentDelayMilliseconds,
  readinessAttempts,
  readinessDelayMilliseconds,
} = {}) {
  requireObject(env, "environment");
  requireFunction(fetchImpl, "fetch implementation");
  requireObject(logger, "logger");
  requireFunction(logger.log, "logger log method");
  const action = requiredEnvironment(env, "PREVIEW_ACTION");
  if (
    !new Set(["ensure-manual", "remove-manual", "ensure-pr", "remove-pr"]).has(
      action,
    )
  )
    fail("PREVIEW_ACTION is invalid");
  const cloudflare = cliCloudflare(env, fetchImpl);
  let result;
  if (action === "ensure-manual") {
    const spec = buildManualPreviewSpec(
      requiredEnvironment(env, "PREVIEW_PREFIX"),
    );
    const headSha = validateCommitSha(
      requiredEnvironment(env, "PREVIEW_HEAD_SHA"),
      "PREVIEW_HEAD_SHA",
    );
    const alias = await pollPagesBranchAlias({
      cloudflare,
      headRef: spec.branchAlias,
      headSha,
      expectedAlias: spec.target,
      ...(deploymentAttempts === undefined
        ? {}
        : { attempts: deploymentAttempts }),
      ...(deploymentDelayMilliseconds === undefined
        ? {}
        : { delayMilliseconds: deploymentDelayMilliseconds }),
      ...(delay === undefined ? {} : { delay }),
    });
    if (alias !== spec.target)
      fail("manual Pages alias did not match its exact deployment contract");
    result = await ensurePreviewDomain({
      cloudflare,
      spec,
      ...(readinessAttempts === undefined ? {} : { readinessAttempts }),
      ...(readinessDelayMilliseconds === undefined
        ? {}
        : { readinessDelayMilliseconds }),
      ...(delay === undefined ? {} : { delay }),
    });
  } else if (action === "remove-manual") {
    result = await removePreviewDomain({
      cloudflare,
      spec: buildManualPreviewSpec(requiredEnvironment(env, "PREVIEW_PREFIX")),
    });
  } else if (action === "ensure-pr") {
    result = await ensurePullRequestPreview({
      cloudflare,
      github: cliGitHub(env, fetchImpl),
      number: requiredEnvironment(env, "PREVIEW_PR_NUMBER"),
      expectedHeadRef: requiredEnvironment(env, "PREVIEW_HEAD_REF"),
      expectedHeadSha: requiredEnvironment(env, "PREVIEW_HEAD_SHA"),
      ...(deploymentAttempts === undefined ? {} : { deploymentAttempts }),
      ...(deploymentDelayMilliseconds === undefined
        ? {}
        : { deploymentDelayMilliseconds }),
      ...(readinessAttempts === undefined ? {} : { readinessAttempts }),
      ...(readinessDelayMilliseconds === undefined
        ? {}
        : { readinessDelayMilliseconds }),
      ...(delay === undefined ? {} : { delay }),
    });
  } else {
    result = await removePullRequestPreview({
      cloudflare,
      github: cliGitHub(env, fetchImpl),
      number: requiredEnvironment(env, "PREVIEW_PR_NUMBER"),
    });
  }
  logger.log(
    `preview domain ${action} ${result.status}: ${result.hostname}${
      result.target ? ` -> ${result.target}` : ""
    }`,
  );
  return result;
}

function isDirectExecution() {
  return (
    typeof process.argv[1] === "string" &&
    import.meta.url === pathToFileURL(process.argv[1]).href
  );
}

if (isDirectExecution()) {
  try {
    await runPreviewDomainCli();
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "preview domain lifecycle failed unexpectedly",
    );
    process.exitCode = 1;
  }
}
