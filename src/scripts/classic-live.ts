// Progressive enhancement for Classic downloads and official server status.
// Data comes only from this site's /api routes, is validated against closed
// shapes, and is inserted as text nodes. Any failure leaves the static
// fallback untouched.
import {
  isDownloadRecord,
  isStatusResponse,
  type DownloadRecord,
  type PlatformFile,
  type ReleaseFile,
} from "../../server/record.js";

type Platform = "windows" | "linux";

const noteLabels = {
  feature: "New",
  fix: "Fix",
  performance: "Faster",
} as const;

async function getJson(path: string): Promise<unknown> {
  try {
    const response = await fetch(path, {
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (
      !(response.headers.get("content-type") ?? "").startsWith(
        "application/json",
      )
    )
      return null;
    return await response.json();
  } catch {
    return null;
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className !== undefined) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  node.append(...children);
  return node;
}

function link(href: string, text: string, className?: string) {
  const anchor = element(
    "a",
    className === undefined ? { text } : { className, text },
  );
  anchor.href = href;
  return anchor;
}

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} bytes`;
}

function formatDate(timestamp: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(Date.parse(timestamp));
}

function detectPlatform(): Platform | null {
  const hints = navigator as Navigator & {
    userAgentData?: { platform?: unknown };
  };
  const platform = hints.userAgentData?.platform;
  const source = (
    typeof platform === "string" && platform !== ""
      ? platform
      : navigator.userAgent
  ).toLowerCase();
  if (/android|iphone|ipad|cros/u.test(source)) return null;
  if (source.includes("win")) return "windows";
  if (source.includes("linux")) return "linux";
  return null;
}

function checksum(file: PlatformFile) {
  return element("p", { className: "release-checksum" }, [
    "SHA-256 ",
    element("code", { text: file.sha256 }),
  ]);
}

function platformGuide(platform: Platform, record: DownloadRecord) {
  const file = record.platforms[platform];
  if (platform === "windows")
    return element("section", { className: "release-platform" }, [
      element("h3", { text: "Windows" }),
      element("ol", {}, [
        element("li", { text: `Extract ${file.name}.` }),
        element("li", {
          text: "Keep the extracted files together in one folder.",
        }),
        element("li", {}, ["Run ", element("code", { text: "atrinik.exe" })]),
      ]),
      checksum(file),
    ]);
  return element("section", { className: "release-platform" }, [
    element("h3", { text: "Linux" }),
    element("ol", {}, [
      element("li", {}, [
        "Make it executable: ",
        element("code", { text: `chmod +x ${file.name}` }),
      ]),
      element("li", {}, ["Run ", element("code", { text: `./${file.name}` })]),
    ]),
    element("p", {
      text: "Requires x86_64 and glibc 2.39 or newer, for example Ubuntu 24.04 or newer.",
    }),
    checksum(file),
  ]);
}

function downloadButton(
  platform: Platform,
  record: DownloadRecord,
  highlighted: boolean,
) {
  const file = record.platforms[platform];
  const anchor = element(
    "a",
    {
      className: `button release-button ${
        highlighted ? "button--primary" : "button--ghost"
      }`,
    },
    [
      element("span", {
        text:
          platform === "windows"
            ? "Download for Windows"
            : "Download for Linux",
      }),
      element("span", {
        className: "release-button__detail",
        text: `${platform === "windows" ? "Portable ZIP" : "AppImage"} · ${formatSize(file.size)}`,
      }),
    ],
  );
  anchor.href = file.url;
  return anchor;
}

function fileList(files: ReleaseFile[]) {
  return element(
    "ul",
    {},
    files.map((file) =>
      element("li", {}, [
        link(file.url, file.name),
        element("span", { text: ` ${formatSize(file.size)}` }),
      ]),
    ),
  );
}

function renderRelease(record: DownloadRecord, detected: Platform | null) {
  const order: Platform[] =
    detected === "linux" ? ["linux", "windows"] : ["windows", "linux"];
  const children: Node[] = [
    element("p", {
      className: "release-meta",
      text: `Version ${record.version} · Released ${formatDate(record.publishedAt)}`,
    }),
  ];
  if (!record.serverMatch)
    children.push(
      element("p", {
        className: "download-coordinate-warning",
        text: "This is the newest verified release. The official server’s version could not be confirmed, so it may not match the server you want to join.",
      }),
    );
  children.push(
    element(
      "div",
      { className: "card-actions release-actions" },
      order.map((platform) =>
        downloadButton(
          platform,
          record,
          detected === null || detected === platform,
        ),
      ),
    ),
    element(
      "div",
      { className: "download-guidance" },
      order.map((platform) => platformGuide(platform, record)),
    ),
  );
  const notes = element("section", { className: "release-notes" }, [
    element("h3", { text: `What’s new in ${record.version}` }),
  ]);
  if (record.notes.length > 0)
    notes.append(
      element(
        "ul",
        {},
        record.notes.map((note) =>
          element("li", {}, [
            element("strong", { text: noteLabels[note.kind] }),
            note.scope === undefined ? " " : ` (${note.scope}) `,
            note.text,
          ]),
        ),
      ),
    );
  notes.append(
    element("p", {}, [
      link(record.releaseUrl, `Full release notes for ${record.version}`),
    ]),
  );
  children.push(
    notes,
    element("details", { className: "release-files" }, [
      element("summary", { text: "All release files" }),
      element("p", {
        text: "Every file is listed with its size. SHA256SUMS lists the SHA-256 digest of each file, and the SPDX SBOM describes the release contents.",
      }),
      fileList(record.files),
    ]),
  );
  return children;
}

async function enhanceDownload() {
  const target = document.querySelector<HTMLElement>("[data-classic-release]");
  if (!target) return;
  const record = await getJson("/api/downloads/classic");
  if (!isDownloadRecord(record)) return;
  let children: Node[];
  try {
    children = renderRelease(record, detectPlatform());
  } catch {
    return;
  }
  target.replaceChildren(...children);
  for (const fallback of document.querySelectorAll<HTMLElement>(
    "[data-classic-fallback]",
  ))
    fallback.hidden = true;
}

async function enhanceStatus() {
  const targets = document.querySelectorAll<HTMLElement>(
    "[data-server-status]",
  );
  if (targets.length === 0) return;
  const status = await getJson("/api/status");
  let text = "Official server status unavailable";
  if (isStatusResponse(status) && status.available) {
    const server = status.server;
    text = server.online
      ? `Official server: online · ${server.playersCount} ${
          server.playersCount === 1 ? "player" : "players"
        } · version ${server.version}`
      : "Official server: offline";
  }
  for (const target of targets) target.textContent = text;
}

void enhanceDownload();
void enhanceStatus();
