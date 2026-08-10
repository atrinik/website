import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  downloadReleaseUrls,
  readJson,
  validateDist,
} from "./site-contract.mjs";

const expectedProductionDomains = ["atrinik.org", "www.atrinik.org"];
const expectedApplicationPrivacy = {
  analytics: false,
  cookies: false,
  tracking: false,
};
const expectedProviderEdge = {
  htmlTransformation: "provider-controlled",
  securityJavaScript: "conditional",
  securityCookies: "conditional",
  webAnalytics: "dashboard-managed",
};
const expectedContentSecurityPolicy = new Map([
  ["default-src", ["'none'"]],
  ["base-uri", ["'none'"]],
  ["connect-src", ["'none'"]],
  ["font-src", ["'self'"]],
  ["form-action", ["'none'"]],
  ["frame-ancestors", ["'none'"]],
  ["img-src", ["'self'"]],
  ["manifest-src", ["'self'"]],
  ["media-src", ["'self'"]],
  ["object-src", ["'none'"]],
  ["script-src", ["'none'"]],
  ["style-src", ["'self'"]],
  ["upgrade-insecure-requests", []],
]);
const expectedPreviewDeployments = {
  source: "cloudflare-git-integration",
  branches: "all-non-production",
  providerHostnamesOnly: true,
  directUploads: false,
  customDomains: false,
};

export function validateDeploymentContract(contract) {
  if (
    contract.schemaVersion !== 4 ||
    contract.provider !== "cloudflare-pages" ||
    contract.project !== "atrinik-website" ||
    contract.repository !== "atrinik/website" ||
    contract.productionBranch !== "main" ||
    contract.buildCommand !== "npm ci && npm run build" ||
    contract.outputDirectory !== "dist"
  )
    throw new Error("Cloudflare Pages deployment contract drift");
  if (
    contract.functions !== false ||
    !isDeepStrictEqual(
      contract.applicationPrivacy,
      expectedApplicationPrivacy,
    ) ||
    !isDeepStrictEqual(contract.providerEdge, expectedProviderEdge) ||
    !Array.isArray(contract.secrets) ||
    contract.secrets.length !== 0
  )
    throw new Error(
      "static deployment gained an unreviewed dynamic/privacy boundary",
    );
  if (
    contract.productionDomain !== "atrinik.org" ||
    !isDeepStrictEqual(contract.productionDomains, expectedProductionDomains) ||
    contract.previewAccess !== "public-cloudflare-managed-noindex" ||
    !isDeepStrictEqual(contract.previewDeployments, expectedPreviewDeployments)
  )
    throw new Error("deployment environment boundary drift");
}

export function validateDeploymentHeaders(headers) {
  const blocks = [];
  let block;
  for (const line of headers.split(/\r?\n/u)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!/^\s/u.test(line)) {
      block = { selector: line.trim(), headers: new Map() };
      blocks.push(block);
      continue;
    }
    if (!block) throw new Error("built deployment has an orphaned header");
    const separator = line.indexOf(":");
    if (separator < 0)
      throw new Error(`built deployment has an invalid header: ${line.trim()}`);
    const name = line.slice(0, separator).trim().toLowerCase();
    if (block.headers.has(name))
      throw new Error(`built deployment repeats header: ${name}`);
    block.headers.set(name, line.slice(separator + 1).trim());
  }

  const globalBlock = blocks.find(({ selector }) => selector === "/*");
  const contentSecurityPolicy = globalBlock?.headers.get(
    "content-security-policy",
  );
  if (!contentSecurityPolicy)
    throw new Error("built deployment lacks security headers");
  const directives = new Map();
  for (const sourceDirective of contentSecurityPolicy.split(";")) {
    const [rawName, ...values] = sourceDirective.trim().split(/\s+/u);
    if (!rawName) continue;
    const name = rawName.toLowerCase();
    if (directives.has(name))
      throw new Error(`built deployment repeats CSP directive: ${name}`);
    directives.set(name, values);
  }
  if (!isDeepStrictEqual(directives, expectedContentSecurityPolicy))
    throw new Error("built deployment lacks the required no-script CSP");
  if (/^\s*X-Robots-Tag:/imu.test(headers))
    throw new Error("repository headers must not mark production as noindex");
}

export async function runDeploymentDryRun(
  root = resolve(import.meta.dirname, ".."),
) {
  const contract = await readJson(
    resolve(root, "deployment/cloudflare-pages.json"),
  );
  validateDeploymentContract(contract);
  validateDeploymentHeaders(
    await readFile(resolve(root, "dist/_headers"), "utf8"),
  );

  const downloads = await readJson(resolve(root, "src/data/downloads.json"));
  const media = await readJson(resolve(root, "src/data/media.json"));
  const result = await validateDist(resolve(root, "dist"), {
    allowedMedia: new Map(
      media.entries.map((record) => [record.publicPath, record]),
    ),
    allowedReleaseUrls: new Set(downloads.entries.flatMap(downloadReleaseUrls)),
  });
  console.log(
    `deployment dry-run valid for ${contract.project}: ${JSON.stringify(result)}`,
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) await runDeploymentDryRun();
