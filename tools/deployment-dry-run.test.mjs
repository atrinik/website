import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  validateDeploymentContract,
  validatePreviewHeaders,
  validatePreviewWorkflow,
} from "./deployment-dry-run.mjs";

const root = resolve(import.meta.dirname, "..");

const validContract = {
  schemaVersion: 2,
  provider: "cloudflare-pages",
  project: "atrinik-website",
  repository: "atrinik/website",
  productionBranch: "main",
  productionDomain: "atrinik.org",
  productionDomains: ["atrinik.org", "www.atrinik.org"],
  buildCommand: "npm ci && npm run build",
  outputDirectory: "dist",
  functions: false,
  analytics: false,
  secrets: [],
  previewAccess: "public-noindex",
  previewDomains: {
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
  },
  rollback:
    "promote the last verified production deployment in Cloudflare Pages",
  healthPath: "/",
};

const validHeaders = `/*
  Content-Security-Policy: default-src 'none'

https://:prefix.testing.atrinik.org/*
  X-Robots-Tag: noindex, nofollow

https://pr.:number.testing.atrinik.org/*
  X-Robots-Tag: noindex, nofollow
`;

const validWorkflow = `name: Manage Pages preview domains
on:
  pull_request_target:
    branches: [main]
    types: [opened, reopened, synchronize, closed]
permissions:
  contents: read
  pull-requests: read
concurrency:
  group: pages-preview-domain-pr-\${{ github.event.pull_request.number }}
  cancel-in-progress: false
jobs:
  preview-domain:
    name: PR preview domain
    if: >-
      github.event.repository.id == 1327107093 &&
      github.event.pull_request.head.repo.full_name == github.repository &&
      github.event.pull_request.user.login != 'dependabot[bot]'
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    environment: cloudflare-preview-domains
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          ref: \${{ github.event.pull_request.base.sha }}
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020
        with:
          node-version-file: .nvmrc
      - name: Attach the successful Pages preview
        if: github.event.action != 'closed'
        env:
          CLOUDFLARE_ACCOUNT_ID: \${{ vars.CLOUDFLARE_ACCOUNT_ID }}
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_PREVIEW_TOKEN }}
          CLOUDFLARE_ZONE_ID: \${{ vars.CLOUDFLARE_ZONE_ID }}
          GITHUB_TOKEN: \${{ github.token }}
          PREVIEW_ACTION: ensure-pr
          PREVIEW_HEAD_REF: \${{ github.event.pull_request.head.ref }}
          PREVIEW_HEAD_SHA: \${{ github.event.pull_request.head.sha }}
          PREVIEW_PR_NUMBER: \${{ github.event.pull_request.number }}
        run: node tools/cloudflare-preview-domain.mjs
      - name: Remove the closed PR hostname
        if: github.event.action == 'closed'
        env:
          CLOUDFLARE_ACCOUNT_ID: \${{ vars.CLOUDFLARE_ACCOUNT_ID }}
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_PREVIEW_TOKEN }}
          CLOUDFLARE_ZONE_ID: \${{ vars.CLOUDFLARE_ZONE_ID }}
          GITHUB_TOKEN: \${{ github.token }}
          PREVIEW_ACTION: remove-pr
          PREVIEW_PR_NUMBER: \${{ github.event.pull_request.number }}
        run: node tools/cloudflare-preview-domain.mjs
`;

test("repository deployment sources satisfy the preview boundary", async () => {
  validateDeploymentContract(
    JSON.parse(
      await readFile(resolve(root, "deployment/cloudflare-pages.json"), "utf8"),
    ),
  );
  validatePreviewHeaders(
    await readFile(resolve(root, "public/_headers"), "utf8"),
  );
  validatePreviewWorkflow(
    await readFile(
      resolve(root, ".github/workflows/pages-preview-domain.yml"),
      "utf8",
    ),
  );
});

test("deployment contract rejects production and preview drift", () => {
  validateDeploymentContract(structuredClone(validContract));
  for (const mutate of [
    (contract) => (contract.schemaVersion = 1),
    (contract) => (contract.productionDomains[1] = "testing.atrinik.org"),
    (contract) => (contract.previewAccess = "private"),
    (contract) => (contract.previewDomains.manualBranchPrefix = "main"),
    (contract) => (contract.previewDomains.cleanupOnPullRequestClose = false),
  ]) {
    const contract = structuredClone(validContract);
    mutate(contract);
    assert.throws(
      () => validateDeploymentContract(contract),
      /deployment|Cloudflare/u,
    );
  }
});

test("preview headers are host-specific and leave production indexable", () => {
  validatePreviewHeaders(validHeaders);
  assert.throws(
    () =>
      validatePreviewHeaders(
        validHeaders.replace(
          "https://pr.:number.testing.atrinik.org/*",
          "https://atrinik.org/*",
        ),
      ),
    /noindex header boundary/u,
  );
  assert.throws(
    () =>
      validatePreviewHeaders(
        validHeaders.replace("noindex, nofollow", "nofollow"),
      ),
    /noindex header boundary/u,
  );
  assert.throws(
    () =>
      validatePreviewHeaders(
        validHeaders.replace("/*", "https://atrinik.org/*"),
      ),
    /lacks security headers/u,
  );
});

test("preview workflow keeps privileged execution on trusted base code", () => {
  validatePreviewWorkflow(validWorkflow);
  for (const source of [
    validWorkflow.replace("pull_request_target:", "pull_request:"),
    validWorkflow.replace(
      "ref: \${{ github.event.pull_request.base.sha }}",
      "ref: \${{ github.event.pull_request.head.sha }}",
    ),
    validWorkflow.replace("contents: read", "contents: write"),
    validWorkflow.replace("node-version-file: .nvmrc", "node-version: 20"),
    validWorkflow.replace(
      "cancel-in-progress: false",
      "cancel-in-progress: true",
    ),
    validWorkflow.replace(
      "    types: [opened, reopened, synchronize, closed]",
      "    # types: [opened, reopened, synchronize, closed]",
    ),
    validWorkflow.replace(
      "      github.event.repository.id == 1327107093 &&",
      "      # github.event.repository.id == 1327107093 &&",
    ),
    validWorkflow.replace(
      "      github.event.pull_request.user.login != 'dependabot[bot]'",
      "      # github.event.pull_request.user.login != 'dependabot[bot]'",
    ),
    validWorkflow.replace(
      "        if: github.event.action == 'closed'",
      "        # if: github.event.action == 'closed'",
    ),
    validWorkflow.replace(
      "          PREVIEW_ACTION: remove-pr",
      "          # PREVIEW_ACTION: remove-pr",
    ),
    validWorkflow.replace(
      "github.event.pull_request.head.repo.full_name == github.repository &&",
      "true",
    ),
    validWorkflow.replace(
      "github.event.pull_request.user.login != 'dependabot[bot]'",
      "true",
    ),
    validWorkflow.replace(
      "types: [opened, reopened, synchronize, closed]",
      "types: [opened, reopened, synchronize]",
    ),
    validWorkflow.replace(
      "run: node tools/cloudflare-preview-domain.mjs",
      "uses: actions/download-artifact@deadbeef",
    ),
    validWorkflow.replace(
      "      - name: Attach the successful Pages preview",
      "      - uses: example/untrusted@deadbeef\n      - name: Attach the successful Pages preview",
    ),
    validWorkflow.replace(
      "CLOUDFLARE_ZONE_ID: \${{ vars.CLOUDFLARE_ZONE_ID }}",
      "CLOUDFLARE_ZONE_ID: missing",
    ),
    validWorkflow.replace("jobs:", "defaults:\n  run:\n    shell: bash\njobs:"),
    validWorkflow.replace(
      "        run: node tools/cloudflare-preview-domain.mjs",
      "        shell: bash\n        run: node tools/cloudflare-preview-domain.mjs",
    ),
    validWorkflow.replace(
      "        run: node tools/cloudflare-preview-domain.mjs",
      "        working-directory: untrusted\n        run: node tools/cloudflare-preview-domain.mjs",
    ),
    validWorkflow.replace(
      "          node-version-file: .nvmrc",
      "          node-version-file: .nvmrc\n          token: \${{ secrets.EXTRA_TOKEN }}",
    ),
    validWorkflow.replace(
      "      - name: Attach the successful Pages preview",
      "      - name: Untrusted action\n        uses: example/untrusted@0123456789012345678901234567890123456789\n      - name: Attach the successful Pages preview",
    ),
  ])
    assert.throws(() => validatePreviewWorkflow(source), /unsafe preview/u);
});
