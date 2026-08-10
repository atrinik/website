export interface DownloadRecord {
  releaseRepository: string;
  artifactRole: string;
  primary: boolean;
  version: string;
  tag: string;
  revision: string;
  publishedAt: string;
  verifiedAt: string;
  draft: boolean;
  prerelease: boolean;
  immutable: boolean;
  attested: boolean;
  releaseAssets: number;
  platform: string;
  architecture: string;
  archiveFormat: string;
  artifact: string;
  bytes: number;
  sha256: string;
  url: string;
  releaseNotesUrl: string;
  manifestUrl: string;
  checksumsUrl: string;
  sbomUrl: string;
  softwareLicense: string;
  bundledAssetsLicense: string;
  compatibility: string;
  installation: string;
}

export interface DownloadCatalog {
  schemaVersion: number;
  entries: DownloadRecord[];
}

export const primaryDownload = (catalog: DownloadCatalog) =>
  catalog.entries.find((entry) => entry.primary);

export const formatDownloadBytes = (bytes: number) =>
  `${(bytes / 1024 ** 2).toFixed(2)} MiB (${bytes.toLocaleString("en-US")} bytes)`;

export const platformName = (platform: string) =>
  ({ linux: "Linux", macos: "macOS", windows: "Windows" })[platform] ??
  platform;
