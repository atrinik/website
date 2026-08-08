import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { filesBelow } from "./site-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "build/release-dry-run");
await mkdir(resolve(root, "build"), { recursive: true });
await mkdir(output, { recursive: false });

async function gitRevision() {
  const marker = await readFile(resolve(root, ".git"), "utf8").catch(
    () => null,
  );
  const gitDirectory = marker?.startsWith("gitdir: ")
    ? resolve(root, marker.slice(8).trim())
    : resolve(root, ".git");
  const head = (await readFile(resolve(gitDirectory, "HEAD"), "utf8")).trim();
  if (/^[0-9a-f]{40}$/u.test(head)) return head;
  if (!head.startsWith("ref: ")) throw new Error("unsupported Git HEAD");
  const commonMarker = await readFile(
    resolve(gitDirectory, "commondir"),
    "utf8",
  ).catch(() => ".");
  const commonDirectory = resolve(gitDirectory, commonMarker.trim());
  const reference = head.slice(5);
  const loose = await readFile(
    resolve(commonDirectory, reference),
    "utf8",
  ).catch(() => null);
  if (loose && /^[0-9a-f]{40}$/u.test(loose.trim())) return loose.trim();
  const packed = await readFile(
    resolve(commonDirectory, "packed-refs"),
    "utf8",
  );
  const line = packed
    .split("\n")
    .find((item) => item.endsWith(` ${reference}`));
  if (!line || !/^[0-9a-f]{40} /u.test(line))
    throw new Error("Git HEAD ref is unresolved");
  return line.slice(0, 40);
}

const revision = await gitRevision();
const records = [];
for (const path of await filesBelow(resolve(root, "dist"))) {
  const bytes = await readFile(path);
  records.push({
    path: path.slice(resolve(root, "dist").length + 1),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await writeFile(
  resolve(output, "deployment-provenance.json"),
  `${JSON.stringify({ schemaVersion: 1, revision, node: process.version, packageManager: "npm@11.16.0", source: "atrinik/website", files: records }, null, 2)}\n`,
  { flag: "wx" },
);
const { openSync } = await import("node:fs");
execFileSync("npm", ["sbom", "--sbom-format", "cyclonedx"], {
  cwd: root,
  stdio: [
    "ignore",
    openSync(resolve(output, "sbom.cdx.json"), "wx"),
    "inherit",
  ],
});
console.log(`release dry-run evidence written for ${revision}`);
