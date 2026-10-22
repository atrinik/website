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
  parsing. A signed `ping` returns 204. A signed `release` event for exactly
  `atrinik/classic` with action `published`, `edited`, or `deleted` returns
  202 and schedules a recompute; other release actions are 204 no-ops. A
  60-second webhook gate limits bursts and replays to one recompute per
  minute, and each accepted webhook restarts the visit gate below. The payload
  is only a cue: its URLs and digests are never used. Everything else is a
  bodiless 4xx.
- `GET /api/downloads/classic` returns the stored record with
  `Cache-Control: public, max-age=60`. A refresh gate key with a 15-minute
  `expirationTtl` is the staleness window: a request that finds the gate
  absent writes it and starts one background refresh, whatever that refresh's
  outcome; every other request just reads. With no record, the request that
  takes the gate attempts one synchronous refresh; failure, or a held gate,
  returns 503 `{ "available": false }` with `no-store`.
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
   commits are cached in KV for a day; per-commit protocols are cached
   permanently because commit contents cannot change.
2. `GET /repos/atrinik/classic/releases?per_page=10` is walked newest first,
   with at most ten protocol lookups. A release qualifies only when it is not a
   draft or prerelease, GitHub reports it `immutable`, its tag is `vX.Y.Z`, its
   assets are uploaded with exact canonical download URLs, and
   `atrinik-classic-client-<v>-windows-x86_64.zip`,
   `atrinik-classic-client-<v>-linux-x86_64.AppImage`, and `SHA256SUMS` exist
   with GitHub `sha256:` digests. Its tag protocol must equal the server's.
   `SHA256SUMS` (at most 64 KiB) must hash to its own API digest, parse
   strictly, and list both client digests exactly as the API reports them.
   The 2.7 MB `release-manifest.json` is never downloaded.
3. While the stored release still matches the server's protocol, the walk
   stops at the stored version: a transient failure on a newer release can
   never regress the download to an older one. A downgrade happens only when
   the server's protocol no longer matches the stored release.
4. If the server is unknown or unreachable, or the release list fails, the
   stored record is kept unchanged. If the server is known but no recent
   release matches it, the stored release is kept and restated with
   `serverMatch: false` and the server's version, so the page warns instead of
   claiming compatibility. Only when nothing is stored does the runtime fall
   back to the newest fully verified release, marked `serverMatch: false`
   (with `server: null` when the server is unknown).
5. A record is written only when its content, ignoring `checkedAt`, differs
   from the stored one; `checkedAt` is when the current content was selected.

Release notes are reduced to at most eight plain-text `feature`, `fix`, or
`performance` highlights (each at most 200 characters) from the
semantic-release `Features`, `Bug Fixes`, and `Performance Improvements`
sections; links, emphasis, HTML, control characters, and trailing issue or
commit references are removed. Each line is cut to 1,000 characters and
trimmed before any pattern runs, and every pattern is linear or bounded, so a
hostile body cannot stall parsing. The record (KV key `classic:download:v1`,
`schemaVersion` 1) binds version, tag, commit, publication time, release page,
protocol, server match, both platform files with size and SHA-256, every
release file, the notes, and `checkedAt`. `server/record.js` validates this
closed shape when it is written, when it is read back from KV, and again in
the browser.

Remote fetches use `https` only, with a 5-second timeout, bounded reads, and
manual redirects restricted to `api.github.com`, `raw.githubusercontent.com`,
`classic.meta.atrinik.org`, and GitHub's release download hosts. The required
`GITHUB_TOKEN` is sent only to `api.github.com`; without it the runtime still
works, but at GitHub's unauthenticated limit of 60 requests per hour shared by
every Worker on the same egress address.

KV keys are namespaced by environment: requests to `atrinik.org` use the bare
production keys and every other hostname, including `pages.dev` previews,
prefixes them with `preview:`, so preview code cannot overwrite production keys
even if the namespaces were shared. The runtime derives this from the request
hostname because Pages exposes `CF_PAGES_BRANCH` only at build time.

KV write budget (the free plan allows 1,000 writes a day): in steady state the
refresh gate is written about once per 15 minutes per active Cloudflare
location, about 96 writes a day for a single location, regardless of upstream
failures. Records are written only on an
actual change (a new release or a server change), webhooks add at most one gate
write each (deduplicated to one a minute), tag-commit cache entries are
rewritten about once a day per looked-up tag, and protocol entries once per
new commit. KV is eventually consistent and caches reads (including "not
found") for about 60 seconds per location, so when the gate expires every
location that serves a visit in that window can write it: the real cost is up to
one gate write per active location per window. That is well inside the budget
at this site's traffic, but it is not a hard bound of 96.

A failed refresh still holds the gate, so the next automatic attempt comes 15
minutes later; with no stored record the API answers 503 (and the page keeps its
static fallback) for up to that long. A webhook redelivery bypasses the gate.

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
