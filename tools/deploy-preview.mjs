import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const project = "atrinik-website";

export function validatePreviewPrefix(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 30 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(value) ||
    value.startsWith("pr-") ||
    new Set(["atrinik", "main", "meta", "pr", "testing", "www"]).has(value)
  )
    throw new Error(
      "preview prefix must be 1-30 lowercase letters, digits, or interior hyphens and must not be reserved",
    );
  return value;
}

export function deploymentCommands({ prefix, revision, dirty, remove }) {
  const safePrefix = validatePreviewPrefix(prefix);
  if (!/^[0-9a-f]{40}$/u.test(revision))
    throw new Error("Git HEAD must be a complete SHA-1 revision");
  const previewEnvironment = {
    PREVIEW_ACTION: remove ? "remove-manual" : "ensure-manual",
    PREVIEW_PREFIX: safePrefix,
    PREVIEW_HEAD_SHA: revision,
  };
  if (remove) return { previewEnvironment, wrangler: null };
  return {
    previewEnvironment,
    wrangler: [
      resolve(root, "node_modules/wrangler/bin/wrangler.js"),
      "pages",
      "deploy",
      "dist",
      "--project-name",
      project,
      "--branch",
      `manual-${safePrefix}`,
      "--commit-hash",
      revision,
      "--commit-message",
      `manual testing deployment for ${safePrefix}`,
      "--commit-dirty",
      String(dirty),
    ],
  };
}

function run(command, arguments_, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd: root,
      env: options.env ?? process.env,
      stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let stdout = "";
    if (options.capture)
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolvePromise(stdout.trim());
      else
        reject(
          new Error(
            `${command} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
          ),
        );
    });
  });
}

function requireEnvironment(environment) {
  for (const name of [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ZONE_ID",
  ])
    if (!environment[name]?.trim())
      throw new Error(`${name} is required; see docs/DEPLOYMENT.md`);
}

function operationalEnvironment(environment) {
  const allowed = [
    "CI",
    "COMSPEC",
    "FORCE_COLOR",
    "HOME",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "LANG",
    "LC_ALL",
    "NODE_EXTRA_CA_CERTS",
    "NO_PROXY",
    "PATH",
    "PATHEXT",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "SYSTEMROOT",
    "TEMP",
    "TERM",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
    "WINDIR",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "https_proxy",
    "http_proxy",
    "no_proxy",
  ];
  return Object.fromEntries(
    allowed
      .filter((name) => environment[name] !== undefined)
      .map((name) => [name, environment[name]]),
  );
}

export async function deployPreview({
  argv = process.argv.slice(2),
  environment = process.env,
  runCommand = run,
} = {}) {
  const remove = argv[0] === "--remove";
  const operands = remove ? argv.slice(1) : argv;
  if (operands.length !== 1)
    throw new Error(
      `usage: npm run ${remove ? "undeploy:test" : "deploy:test"} -- <prefix>`,
    );
  requireEnvironment(environment);
  const prefix = validatePreviewPrefix(operands[0]);
  const unprivilegedEnvironment = operationalEnvironment(environment);
  const revision = await runCommand("git", ["rev-parse", "--verify", "HEAD"], {
    capture: true,
    env: unprivilegedEnvironment,
  });
  const dirty =
    (
      await runCommand(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=all"],
        {
          capture: true,
          env: unprivilegedEnvironment,
        },
      )
    ).length > 0;
  const commands = deploymentCommands({ prefix, revision, dirty, remove });
  const privilegedBase = operationalEnvironment(environment);
  const cloudflareEnvironment = {
    ...privilegedBase,
    CLOUDFLARE_ACCOUNT_ID: environment.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: environment.CLOUDFLARE_API_TOKEN,
  };
  const helperEnvironment = {
    ...cloudflareEnvironment,
    CLOUDFLARE_ZONE_ID: environment.CLOUDFLARE_ZONE_ID,
    ...commands.previewEnvironment,
  };
  const wranglerEnvironment = {
    ...cloudflareEnvironment,
    WRANGLER_SEND_METRICS: "false",
  };

  if (commands.wrangler) {
    await runCommand("npm", ["run", "deploy:dry-run"], {
      env: unprivilegedEnvironment,
    });
    await runCommand(process.execPath, commands.wrangler, {
      env: wranglerEnvironment,
    });
  }
  await runCommand(
    process.execPath,
    [resolve(root, "tools/cloudflare-preview-domain.mjs")],
    { env: helperEnvironment },
  );
  return `https://${prefix}.testing.atrinik.org/`;
}

if (import.meta.main) {
  try {
    const url = await deployPreview();
    console.log(
      `${process.argv[2] === "--remove" ? "removed" : "ready"}: ${url}`,
    );
  } catch (error) {
    console.error(`preview deployment failed: ${error.message}`);
    process.exitCode = 1;
  }
}
