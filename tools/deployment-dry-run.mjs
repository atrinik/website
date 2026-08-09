import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { readJson, validateDist } from "./site-contract.mjs";

const expectedProductionDomains = ["atrinik.org", "www.atrinik.org"];
const expectedPreviewDomains = {
  baseDomain: "testing.atrinik.org",
  manualPattern: "<prefix>.testing.atrinik.org",
  pullRequestPattern: "pr.<number>.testing.atrinik.org",
  manualBranchPrefix: "manual-",
  sameRepositoryPullRequestsOnly: true,
  cleanupOnPullRequestClose: true,
  githubEnvironment: "cloudflare-preview-domains",
  tokenSecret: "CLOUDFLARE_PREVIEW_TOKEN",
  accountIdVariable: "CLOUDFLARE_ACCOUNT_ID",
  zoneIdVariable: "CLOUDFLARE_ZONE_ID",
};
const expectedNoindexSelectors = [
  "https://:prefix.testing.atrinik.org/*",
  "https://pr.:number.testing.atrinik.org/*",
];

function equalJson(actual, expected) {
  return isDeepStrictEqual(actual, expected);
}

export function validateDeploymentContract(contract) {
  if (
    contract.schemaVersion !== 2 ||
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
    contract.analytics !== false ||
    !Array.isArray(contract.secrets) ||
    contract.secrets.length !== 0
  )
    throw new Error(
      "static deployment gained an unreviewed dynamic/privacy boundary",
    );
  if (
    contract.productionDomain !== "atrinik.org" ||
    !equalJson(contract.productionDomains, expectedProductionDomains) ||
    contract.previewAccess !== "public-noindex" ||
    !equalJson(contract.previewDomains, expectedPreviewDomains)
  )
    throw new Error("deployment environment boundary drift");
}

function headerBlocks(source) {
  const blocks = [];
  let block;
  for (const line of source.split(/\r?\n/u)) {
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
    const value = line.slice(separator + 1).trim();
    block.headers.set(name, value);
  }
  return blocks;
}

export function validatePreviewHeaders(source) {
  const blocks = headerBlocks(source);
  const globalBlock = blocks.find(({ selector }) => selector === "/*");
  if (!globalBlock?.headers.has("content-security-policy"))
    throw new Error("built deployment lacks security headers");

  const noindexBlocks = blocks.filter((block) =>
    block.headers.get("x-robots-tag")?.toLowerCase().includes("noindex"),
  );
  const selectors = noindexBlocks.map(({ selector }) => selector).sort();
  if (!equalJson(selectors, [...expectedNoindexSelectors].sort()))
    throw new Error("preview noindex header boundary drift");
  for (const block of noindexBlocks) {
    if (block.headers.get("x-robots-tag") !== "noindex, nofollow")
      throw new Error("preview robots policy drift");
  }
}

function activeWorkflowSource(source) {
  return source
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("#"))
    .map((line) => line.replace(/\s+#.*$/u, "").trimEnd())
    .filter((line) => line.trim() !== "")
    .join("\n");
}

function requireWorkflowBlock(source, lines, label) {
  if (!source.includes(lines.join("\n")))
    throw new Error(`unsafe preview workflow: missing active ${label}`);
}

export function validatePreviewWorkflow(source) {
  const activeSource = activeWorkflowSource(source);
  requireWorkflowBlock(
    activeSource,
    [
      "on:",
      "  pull_request_target:",
      "    branches: [main]",
      "    types: [opened, reopened, synchronize, closed]",
    ],
    "pull request target event contract",
  );
  requireWorkflowBlock(
    activeSource,
    ["permissions:", "  contents: read", "  pull-requests: read"],
    "read-only GitHub permissions",
  );
  requireWorkflowBlock(
    activeSource,
    [
      "concurrency:",
      "  group: pages-preview-domain-pr-${{ github.event.pull_request.number }}",
      "  cancel-in-progress: false",
    ],
    "serialized pull request concurrency",
  );
  requireWorkflowBlock(
    activeSource,
    [
      "  preview-domain:",
      "    name: PR preview domain",
      "    if: >-",
      "      github.event.repository.id == 1327107093 &&",
      "      github.event.pull_request.head.repo.full_name == github.repository &&",
      "      github.event.pull_request.user.login != 'dependabot[bot]'",
      "    runs-on: ubuntu-24.04",
      "    timeout-minutes: 15",
      "    environment: cloudflare-preview-domains",
    ],
    "same-repository job guard",
  );
  requireWorkflowBlock(
    activeSource,
    [
      "      - name: Attach the successful Pages preview",
      "        if: github.event.action != 'closed'",
      "        env:",
      "          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_PREVIEW_TOKEN }}",
      "          CLOUDFLARE_ZONE_ID: ${{ vars.CLOUDFLARE_ZONE_ID }}",
      "          GITHUB_TOKEN: ${{ github.token }}",
      "          PREVIEW_ACTION: ensure-pr",
      "          PREVIEW_HEAD_REF: ${{ github.event.pull_request.head.ref }}",
      "          PREVIEW_HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
      "          PREVIEW_PR_NUMBER: ${{ github.event.pull_request.number }}",
      "        run: node tools/cloudflare-preview-domain.mjs",
    ],
    "attach step",
  );
  requireWorkflowBlock(
    activeSource,
    [
      "      - name: Remove the closed PR hostname",
      "        if: github.event.action == 'closed'",
      "        env:",
      "          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}",
      "          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_PREVIEW_TOKEN }}",
      "          CLOUDFLARE_ZONE_ID: ${{ vars.CLOUDFLARE_ZONE_ID }}",
      "          GITHUB_TOKEN: ${{ github.token }}",
      "          PREVIEW_ACTION: remove-pr",
      "          PREVIEW_PR_NUMBER: ${{ github.event.pull_request.number }}",
      "        run: node tools/cloudflare-preview-domain.mjs",
    ],
    "close cleanup step",
  );
  if (
    /^\s*pull_request\s*:/mu.test(activeSource) ||
    /\bpermissions:[\s\S]*?\bwrite\b/u.test(activeSource) ||
    /actions\/(?:cache|download-artifact)@/u.test(activeSource) ||
    /(?:^|\s|[{,])["']?(?:defaults|shell|working-directory)["']?\s*:/mu.test(
      activeSource,
    ) ||
    /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\./u.test(activeSource) ||
    /^\s*repository\s*:/mu.test(activeSource)
  )
    throw new Error("unsafe preview workflow privilege boundary");

  const actions = [
    ...activeSource.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)\s*$/gmu),
  ].map((match) => match[1]);
  if (
    actions.length !== 2 ||
    !/^actions\/checkout@[0-9a-f]{40}$/u.test(actions[0]) ||
    !/^actions\/setup-node@[0-9a-f]{40}$/u.test(actions[1])
  )
    throw new Error("unsafe preview workflow action boundary");

  const exactOccurrences = new Map([
    ["environment: cloudflare-preview-domains", 1],
    ["ref: ${{ github.event.pull_request.base.sha }}", 1],
    ["persist-credentials: false", 1],
    ["node-version-file: .nvmrc", 1],
    ["if: github.event.action != 'closed'", 1],
    ["if: github.event.action == 'closed'", 1],
    ["CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}", 2],
    ["CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_PREVIEW_TOKEN }}", 2],
    ["CLOUDFLARE_ZONE_ID: ${{ vars.CLOUDFLARE_ZONE_ID }}", 2],
    ["GITHUB_TOKEN: ${{ github.token }}", 2],
    ["PREVIEW_ACTION: ensure-pr", 1],
    ["PREVIEW_ACTION: remove-pr", 1],
    ["PREVIEW_HEAD_REF: ${{ github.event.pull_request.head.ref }}", 1],
    ["PREVIEW_HEAD_SHA: ${{ github.event.pull_request.head.sha }}", 1],
    ["PREVIEW_PR_NUMBER: ${{ github.event.pull_request.number }}", 2],
  ]);
  for (const [fragment, count] of exactOccurrences) {
    if (activeSource.split(fragment).length - 1 !== count)
      throw new Error(`unsafe preview workflow: expected ${count} ${fragment}`);
  }

  const cloudflareSecretExpression = "${{ secrets.CLOUDFLARE_PREVIEW_TOKEN }}";
  for (const [expression, count] of [
    [cloudflareSecretExpression, 2],
    ["${{ github.token }}", 2],
  ]) {
    if (activeSource.split(expression).length - 1 !== count)
      throw new Error(
        `unsafe preview workflow: expected ${count} credential mappings`,
      );
  }
  if (
    /\bsecrets\b/u.test(activeSource.replaceAll(cloudflareSecretExpression, ""))
  )
    throw new Error("unsafe preview workflow secret context boundary");

  const commands = [...activeSource.matchAll(/^\s*run:\s*(.+)$/gmu)].map(
    (match) => match[1].trim(),
  );
  if (
    commands.length !== 2 ||
    commands.some(
      (command) => command !== "node tools/cloudflare-preview-domain.mjs",
    )
  )
    throw new Error("unsafe preview workflow command boundary");
}

export async function runDeploymentDryRun(
  root = resolve(import.meta.dirname, ".."),
) {
  const contract = await readJson(
    resolve(root, "deployment/cloudflare-pages.json"),
  );
  validateDeploymentContract(contract);
  validatePreviewHeaders(
    await readFile(resolve(root, "dist/_headers"), "utf8"),
  );
  validatePreviewWorkflow(
    await readFile(
      resolve(root, ".github/workflows/pages-preview-domain.yml"),
      "utf8",
    ),
  );
  const downloads = await readJson(resolve(root, "src/data/downloads.json"));
  const media = await readJson(resolve(root, "src/data/media.json"));
  const result = await validateDist(resolve(root, "dist"), {
    allowedMedia: new Map(
      media.entries.map((record) => [record.publicPath, record]),
    ),
    allowedReleaseUrls: new Set(downloads.entries.map((record) => record.url)),
  });
  console.log(
    `deployment dry-run valid for ${contract.project}: ${JSON.stringify(result)}`,
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) await runDeploymentDryRun();
