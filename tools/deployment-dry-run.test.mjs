import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  validateDeploymentContract,
  validateDeploymentHeaders,
} from "./deployment-dry-run.mjs";

const root = resolve(import.meta.dirname, "..");
const contract = JSON.parse(
  await readFile(resolve(root, "deployment/cloudflare-pages.json"), "utf8"),
);
const headers = await readFile(resolve(root, "public/_headers"), "utf8");

function changedContract(change) {
  const changed = structuredClone(contract);
  change(changed);
  return changed;
}

test("accepts the native Cloudflare Git preview contract", () => {
  assert.doesNotThrow(() => validateDeploymentContract(contract));
  assert.doesNotThrow(() => validateDeploymentHeaders(headers));
});

test("rejects custom preview domains and direct uploads", () => {
  for (const changed of [
    changedContract((value) => {
      value.previewDeployments.customDomains = true;
    }),
    changedContract((value) => {
      value.previewDeployments.directUploads = true;
    }),
    changedContract((value) => {
      value.previewDeployments.providerHostnamesOnly = false;
    }),
  ])
    assert.throws(
      () => validateDeploymentContract(changed),
      /deployment environment boundary drift/u,
    );
});

test("rejects the retired custom-preview contract schema", () => {
  assert.throws(
    () =>
      validateDeploymentContract(
        changedContract((value) => {
          value.schemaVersion = 2;
        }),
      ),
    /Cloudflare Pages deployment contract drift/u,
  );
});

test("rejects preview credentials and an unexpected preview source", () => {
  assert.throws(
    () =>
      validateDeploymentContract(
        changedContract((value) => {
          value.secrets.push("CLOUDFLARE_API_TOKEN");
        }),
      ),
    /dynamic\/privacy boundary/u,
  );
  assert.throws(
    () =>
      validateDeploymentContract(
        changedContract((value) => {
          value.previewDeployments.source = "repository-workflow";
        }),
      ),
    /deployment environment boundary drift/u,
  );
});

test("keeps noindex out of repository headers", () => {
  assert.throws(
    () => validateDeploymentHeaders(`${headers}\n  X-Robots-Tag: noindex\n`),
    /must not mark production as noindex/u,
  );
});

test("requires the content security policy on the global header block", () => {
  assert.throws(
    () =>
      validateDeploymentHeaders(
        "/assets/*\n  Content-Security-Policy: default-src 'none'\n",
      ),
    /lacks security headers/u,
  );
});
