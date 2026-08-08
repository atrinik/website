import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const command = process.argv[2];
if (!new Set(["build", "check", "dev"]).has(command)) {
  throw new Error("usage: astro.mjs build|check|dev");
}
const astro = resolve(
  import.meta.dirname,
  "../node_modules/astro/bin/astro.mjs",
);
const result = spawnSync(process.execPath, [astro, command], {
  cwd: resolve(import.meta.dirname, ".."),
  env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
