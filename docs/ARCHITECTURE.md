# Website architecture

Astro compiles typed local data and `.astro` templates to static HTML and CSS.
Two narrow dynamic pieces, defined by
[atrinik/website#75](https://github.com/atrinik/website/issues/75), sit beside
that static output: Cloudflare Pages Functions that answer only `/api/*`, and
one self-hosted module script that progressively enhances the downloads and
home pages. Every page remains complete without either. Besides that module,
the only permitted `script` element is inert `type="application/ld+json"`
data generated locally with `<`, `>`, `&`, and JavaScript line separators
escaped before raw HTML insertion. `src/data` is the schema-validated catalog
input, the typed metadata factory owns page identity, and `.astro` templates
contain authored page prose. Closed validators reject unknown media/icon fields
and unsafe coordinates before rendering. Cloudflare can transform a deployed
response after this build boundary; provider-injected security or performance
code is not part of `dist/` and is audited separately.

Every indexable page supplies an explicit metadata object with a unique title,
description, canonical route, index policy, and matched Open Graph/Twitter
identity. Social images resolve only through `src/data/media.json`, including
their canonical local URL, dimensions, and alternative text. The
`atrinik-now` concept image is the explicit sitewide fallback;
pages may choose a more relevant proven catalog record. The homepage alone owns
the canonical `WebSite` JSON-LD record for `https://atrinik.org/` and its two
verified Atrinik GitHub identities. The 404 emits no canonical, preview, or
structured identity and retains `noindex, nofollow`.

## Classic downloads and server status

Downloads remain in their owning GitHub releases; the site never hosts a
binary. The static downloads page links to
`https://github.com/atrinik/classic/releases/latest` with Windows ZIP and
Linux AppImage guidance, so it works without JavaScript, without the API, and
when any lookup fails.

The `/api` runtime is plain ESM JavaScript checked with `// @ts-check`.
`functions/` holds only three thin routes; the logic lives in `server/`,
outside the routed tree, and is unit tested with `node --test` against mocked
upstreams, an in-memory KV namespace, and a fake `waitUntil`:

- `POST /api/github/release` requires `GITHUB_WEBHOOK_SECRET`, a well-formed
  `X-Hub-Signature-256`, and a body of at most 1 MiB (declared and actually
  read). The HMAC-SHA256 is verified with Web Crypto over the raw bytes before
  parsing. A signed `ping` returns 204; a signed `release` event for exactly
  `atrinik/classic` returns 202 and schedules a recompute. The payload is only
  a cue: its URLs and digests are never used. Everything else is a bodiless
  4xx.
- `GET /api/downloads/classic` returns the stored record with
  `Cache-Control: public, max-age=60`. A record older than 15 minutes is still
  served while a background refresh runs behind a 120-second KV lock. With no
  record, one synchronous refresh is attempted; failure returns 503
  `{ "available": false }` with `no-store`.
- `GET /api/status` reads `https://classic.meta.atrinik.org/index.json`
  (256 KiB, 5 s), caches the result for 60 s (30 s for failures) in memory and
  the Cache API, and returns only `available`, `generatedAt`, and the official
  entry's `online`, `name`, `version`, and `playersCount`. The official entry is
  matched by `OFFICIAL_SERVER_HOST` (default `game.atrinik.com`). An expired,
  malformed, or unreachable directory yields 503 `{ "available": false }`.

Other methods return 405. API responses carry `X-Content-Type-Options:
nosniff`, a `default-src 'none'` CSP, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, and same-origin resource policy, because
`_headers` applies only to static assets.

A recompute selects a release as follows, failing closed at every step:

1. The official server's version comes from the directory entry for
   `OFFICIAL_SERVER_HOST`. Its protocol is the integer `protocol_version` in
   `protocol/schema/game-commands.json` at the commit of tag `v<version>`,
   resolved through the GitHub API (annotated tags are dereferenced). Tag
   commits and per-commit protocols are cached permanently in KV.
2. `GET /repos/atrinik/classic/releases?per_page=20` is walked newest first,
   with at most ten protocol lookups. A release qualifies only when it is not a
   draft or prerelease, GitHub reports it `immutable`, its tag is `vX.Y.Z`, its
   assets are uploaded with exact canonical download URLs, and
   `atrinik-classic-client-<v>-windows-x86_64.zip`,
   `atrinik-classic-client-<v>-linux-x86_64.AppImage`, and `SHA256SUMS` exist
   with GitHub `sha256:` digests. Its tag protocol must equal the server's.
   `SHA256SUMS` (at most 64 KiB) must hash to its own API digest, parse
   strictly, and list both client digests exactly as the API reports them.
   The 2.7 MB `release-manifest.json` is never downloaded.
3. If the server is unknown or unreachable, or no recent release matches, the
   stored record is kept unchanged. Only when nothing is stored does the
   runtime fall back to the newest fully verified release, marked
   `serverMatch: false` with `server: null`.

Release notes are reduced to at most eight plain-text `feature`, `fix`, or
`performance` highlights (each at most 200 characters) from the
semantic-release `Features`, `Bug Fixes`, and `Performance Improvements`
sections; links, emphasis, HTML, control characters, and trailing issue or
commit references are removed. The record (KV key `classic:download:v1`,
`schemaVersion` 1) binds version, tag, commit, publication time, release page,
protocol, server match, both platform files with size and SHA-256, every
release file, the notes, and `checkedAt`. `server/record.js` validates this
closed shape when it is written, when it is read back from KV, and again in
the browser.

Remote fetches use `https` only, with a 5-second timeout, bounded reads, and
manual redirects restricted to `api.github.com`, `raw.githubusercontent.com`,
`classic.meta.atrinik.org`, and GitHub's release download hosts. The optional
`GITHUB_TOKEN` is sent only to `api.github.com`.

The browser module (`src/scripts/classic-live.ts`, bundled by Astro to one
hashed file under `/assets/`) fetches only `/api/downloads/classic` and
`/api/status`, validates both responses, and builds all DOM with
`createElement` and `textContent`. It shows Windows and Linux buttons with the
detected platform first and highlighted, version and date, install steps,
SHA-256 digests, release-note highlights, and an "All release files" list. The
status line is an `aria-live="polite"` region. It uses no cookies, storage,
analytics, or third-party code.

Media stays absent until a record binds both source and published digests,
repository/path, a durable Git blob object ID, published dimensions, author,
exact license, transformations, alt text, and notice. Same-repository sources
are digest-checked from a traversal-safe path. The website never imports an
asset tree by implication.

The two SVG site icons use a separate closed catalog because they are
repository-native vector interface artwork rather than page media. Each record
binds the exact checked-in source/published bytes to a Git blob object ID and
SHA-256, 64×64 view box, author, MIT license, transformation, purpose, and
notice. Source validation rejects SVG scripts, event attributes, and external
references; built pages must link both canonical local files.

The executable validator checks the JSON Schema's locally expressible field
sets, patterns, formats, bounds, constants, primary-artifact restrictions, and
archive suffix rules on every run, without adding a general-purpose runtime
schema dependency. Cross-field identity rules remain executable-only: the tag
must equal the version, evidence URLs must share the record's repository and
tag, the artifact URL and suffix must match its filename and format, review
cannot precede publication, and the primary filename and SBOM name must match
the reviewed Classic release. Tests exercise valid and adversarial forms and
contract changes must update both representations and their fixtures together.

`public/_headers` supplies a same-origin CSP (`script-src 'self'`,
`connect-src 'self'`, everything else unchanged) and browser hardening for
every static response. Inert JSON-LD does not relax it. The built-output
validator accepts only JSON-LD and empty `<script type="module"
src="/assets/<name>.<hash>.js">` elements whose files exist; it rejects inline
or external scripts, other script attributes, event handlers, unreferenced
JavaScript files, and module code that uses HTML sinks, storage, cookies,
beacons, dynamic code, unreviewed origins, or unreviewed `/api` paths. It also
requires `_routes.json` to include exactly `/api/*`. It parses the JSON-LD,
compares it with visible metadata and canonical identity, and enforces at most
18 generated files, 900,000 bytes total, 140,000 aggregate HTML bytes, 40,000
aggregate CSS bytes, 700,000 aggregate raster image bytes, and 20,000
JavaScript bytes.
Published image filenames are content-addressed for immutable caching, and
images below the fold are lazy-loaded. Artwork uses its intrinsic aspect ratio
and an automatic rendered height so neither the portrait hero nor landscape
posters are cropped. The presentation avoids fixed decorative texture layers,
backdrop filters, large CSS blur filters, and image filter/transform effects so
scrolling does not continuously repaint those effects. Accessibility
validation covers language, landmarks, skip navigation, primary navigation
labelling, one page heading, useful image alternatives, focus visibility,
reflow, and reduced-motion policy; manual assistive-technology review remains
a release gate.

The JavaScript budget covers repository output. Cloudflare may inject
bot/security JavaScript or a dashboard-managed Web Analytics beacon, set
strictly necessary cookies, or serve a challenge with its own HTML, scripts,
cookies, and CSP. Ordinary deployed pages retain `script-src 'self'`, which
blocks injected third-party scripts. Public privacy language therefore
distinguishes the repository output from this provider edge boundary.

## Deployment topology

One Git-integrated Cloudflare Pages project serves every environment. The
`main` deployment owns canonical `atrinik.org`, and a Cloudflare permanent
redirect maps `www.atrinik.org` to the apex without changing path or query.
Every non-production branch uses Cloudflare's native `pages.dev` preview; there
are no custom preview domains or direct uploads.

Cloudflare's GitHub integration builds same-repository pull requests and posts
the preview link without a repository workflow or API credential. Each commit
has an immutable provider URL, while the normalized branch alias follows the
latest deployment for that branch. Fork pull requests do not receive a Pages
preview. These provider URLs are public and Cloudflare adds
`X-Robots-Tag: noindex`; an immutable deployment URL may remain reachable after
the branch or pull request closes.

Repository `_headers` therefore contains production-safe security and cache
rules only. It must not add a global noindex response: Cloudflare owns the
preview-only indexing header at the edge while production stays indexable.
The same edge may inject provider code based on hostname, request, or dashboard
state, so a clean static artifact does not prove that every delivered response
is script-, cookie-, or analytics-free.
