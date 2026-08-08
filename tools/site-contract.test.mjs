import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  validateDist,
  validateDownload,
  validateMedia,
} from "./site-contract.mjs";

const validDownload = {
  component: "client",
  version: "1.2.3",
  tag: "v1.2.3",
  revision: "0".repeat(40),
  platform: "linux",
  architecture: "x86_64",
  artifact: "client.tar.gz",
  bytes: 10,
  sha256: "1".repeat(64),
  url: "https://github.com/atrinik/client/releases/download/v1.2.3/client.tar.gz",
  license: "MIT",
  compatibility: "Game Protocol 1",
};

test("download coordinates are closed and immutable", () => {
  assert.doesNotThrow(() => validateDownload(validDownload));
  assert.throws(
    () =>
      validateDownload({ ...validDownload, url: "https://example.com/latest" }),
    /mutable/u,
  );
  assert.throws(
    () => validateDownload({ ...validDownload, extra: true }),
    /closed/u,
  );
});

test("media records require complete provenance and safe paths", () => {
  const valid = {
    id: "licensed-image",
    publicPath: "/media/licensed.png",
    sourceRepository: "atrinik/resources",
    sourcePath: "paintings/licensed.png",
    sourceRevision: "2".repeat(40),
    sourceSha256: "3".repeat(64),
    publishedSha256: "4".repeat(64),
    author: "Example Author",
    license: "CC-BY-4.0",
    transformations: ["lossless metadata removal"],
    alt: "A described fixture",
    notice: "Copyright Example Author",
  };
  assert.doesNotThrow(() => validateMedia(valid));
  assert.throws(
    () => validateMedia({ ...valid, publicPath: "/media/../escape.png" }),
    /unsafe/u,
  );
});

test("static output rejects scripts, broken links, and excessive files", async () => {
  const root = await mkdtemp(join(tmpdir(), "atrinik-website-test-"));
  await mkdir(join(root, "about"));
  const shell =
    '<!doctype html><html lang="en"><body><a href="#content">Skip</a><nav aria-label="Primary navigation"></nav><main id="content"><h1>Title</h1></main></body></html>';
  await writeFile(join(root, "index.html"), shell);
  await writeFile(join(root, "about/index.html"), shell);
  assert.equal((await validateDist(root)).javascript, 0);
  await writeFile(join(root, "bad.js"), "alert(1)");
  await assert.rejects(validateDist(root), /performance budget/u);
});
