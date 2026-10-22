# Atrinik website

This repository is the sole source and deployment owner for the MIT-licensed
atrinik.org website. Its pages are static; a small Cloudflare Pages Functions
runtime answers only `/api/*` to keep the Classic download current and show
official server status ([#75](https://github.com/atrinik/website/issues/75)).
It deliberately contains no account, gameplay, payment, repository-managed
analytics or tracking, cookies, or advertising.

Atrinik's creators shape its maps, quests, dialogue, lore, art, and sound, and
review what goes into the game. Atrinik contributors and appropriately licensed work from Crossfire,
Daimonin, and other upstream creators retain their exact authorship,
provenance, notices, and licenses.

The project's software is developed in the open under review, provenance
controls, tests, and repository validation. Contributions are welcome under
the same checks.

Atrinik began in 2009 under founder and original lead Zoey Rose. She led its
human-developed beginning alongside the wider Atrinik Development Team. The
maintained GPL C Classic line credits Atrinik, Daimonin, Crossfire, and wider
upstream/community contributors through its authoritative records; 2011 was a
major development and release era, not the founding year. The new Go server,
Rust client/editor/renderer, content toolkit, and Protobuf protocol are MIT
replacement foundations governed by evidence-gated provenance. Independent
implementation is the default where exact reuse is unproven. Exact historical
reuse follows the [local record](PROVENANCE.md) and
[canonical grant registry](https://github.com/atrinik/atrinik/blob/main/docs/PROVENANCE.md);
admitted destination material may be MIT-relicensed, while the Classic
repository remains GPL-distributed. The foundations are not yet a complete game
release.
Follow the [replacement roadmap](https://github.com/atrinik/atrinik/issues/168)
for current readiness.

Four concept images on atrinik.org are concept artwork by Zoey Rose. They are
presentation material, not game content, and are recorded in
`src/data/media.json`.

The public information architecture keeps the useful journeys from Atrinik's
former project portal without reviving its forum stack: understand the world,
find the maintained Classic line, follow the next-generation roadmap, and
reach the owning GitHub repositories. Classic and replacement readiness and
licenses remain visibly distinct on every relevant page.

Original website concept artwork is retained under `artwork/originals/` as
provenance evidence. Content-addressed, optimized derivatives are published
from `public/media/`; their exact source Git blob object IDs, digests,
dimensions, transformations, licenses, notices, and alternative text are
recorded in `src/data/media.json`.

Every indexable route constructs a closed, typed page identity through
`src/lib/metadata.ts`: one unique title and description, canonical URL, robots
policy, internally consistent Open Graph/Twitter fields, preview image
dimensions, and alternative text. `atrinik-now` is the documented sitewide
preview image; routes can select a more relevant record from the same
validated media catalog. The
homepage also emits the canonical Atrinik `WebSite` identity as safely
serialized inert JSON-LD. The 404 is noindex and deliberately has no canonical,
social-preview, or structured identity.

The new crystal favicon and pinned-tab mask are compact repository-authored SVG
files. Their closed authorship, license, source, hash, Git blob, dimensions,
transformation, purpose, and notice records live in `src/data/icons.json`.

## Development

Use Node 24.18.1 and npm 11.16.0:

```sh
npm ci
npm run check
npm run build
npm run deploy:dry-run
```

`npm run check` also renders feature, fix, and breaking-change release notes
through the configured semantic-release plugin using local fixture commits.
This exercises the actual preset and writer without invoking publication hooks.
The [stable release-note generator](https://github.com/semantic-release/release-notes-generator/blob/v14.1.1/package.json)
uses writer 8, so the Conventional Commits preset uses the compatible major 9
caret range. [Preset major 10 changed its rendering API](https://github.com/conventional-changelog/conventional-changelog/blob/master/packages/conventional-changelog-conventionalcommits/CHANGELOG.md#1000-2026-06-26)
and requires writer 9. Upgrade that preset with a stable compatible generator;
the behavior test verifies rendered sections, breaking changes, and links.

CI runs `node scripts/audit-delta.mjs` before dependency lifecycle scripts.
It freshly installs both revisions with scripts disabled and audits the complete
graphs, including development, optional, peer, and bundled packages. An isolated
standard npm lock refresh fills omitted bundle records; validation requires the
original package identities and dependency maps to remain unchanged and proves
added records against installed bundle manifests. Repository locks are untouched.
For pull requests it compares the event's exact base revision with the tested
merge commit and verifies both parents; for main pushes it compares the event's
`before` revision with its tested `after` revision. Missing history, initial
pushes without a baseline, mismatched revisions, installation failures, audit
service failures, and malformed or incomplete reports fail closed.

Every new advisory/affected-package pair at any severity, or an increased
severity for an existing pair, fails validation. Existing findings remain
warnings with the full reports visible in the job log; removals and severity
reductions pass. Advisory identity uses its GHSA URL and affected package names,
not installed versions or paths, so normal upgrades and fixes remain possible.
No advisory allowlist, known-good dependency version list, or persisted audit
snapshot is used. Standard dependency locks and immutable action references
remain in place. Both audits use the same current Node/npm toolchain and registry;
advisory changes between requests can require a rerun. Only manifests and locks
are extracted from the baseline; historical repository scripts and npm config
are never executed. Changes to the comparison runner and workflow require the
same review as other CI code.

The build writes a self-contained static site to `dist/`. Validation rejects
unproven media, guessed release links, missing attribution or alt text,
unsafe links, broken internal links, and page-weight budget violations. It
permits inert, locally serialized `type="application/ld+json"` data blocks and
exactly the Astro-bundled same-origin module script under `/assets/` (at most
20,000 bytes, no HTML sinks, storage, cookies, or external origins); inline
scripts, external script sources, and event handlers remain forbidden.
`_routes.json` limits Pages Functions to `/api/*`. Generated release evidence
belongs under ignored `build/`.

The Classic download is selected at runtime, not checked in. The `/api`
runtime (`functions/` routes, `server/` logic) picks the newest published,
immutable Classic release whose Windows ZIP and Linux AppImage checksums match
GitHub's digests and whose protocol matches the official server, stores it in
Cloudflare KV, and refreshes it on a signed release webhook or when it is more
than 15 minutes old. A failed lookup never replaces a good record or
downgrades a release that still matches the server. The
downloads page works without JavaScript through a link to the latest Classic
release; the page module adds direct platform buttons, checksums, and
release-note highlights. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
for the selection rules and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the
KV, secret, and webhook setup.

Cloudflare Pages uses one Git-integrated project. `main` serves the canonical
`atrinik.org`; `www.atrinik.org` permanently redirects to it. Cloudflare builds
all non-production branches and posts its native `pages.dev` preview link on
same-repository pull requests. The repository has no manual upload path,
custom preview hostname, or Cloudflare credential. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the exact preview, domain,
health, and rollback contract.

Cookie, analytics, and tracking claims apply to the repository output and
`/api` runtime, not every Cloudflare response. Cloudflare may inject
bot/security JavaScript or a dashboard-managed Web Analytics beacon, set
strictly necessary cookies, or serve a challenge response with different HTML,
scripts, cookies, and CSP. Ordinary static responses retain a same-origin
`script-src 'self'` and `connect-src 'self'` CSP that blocks injected
third-party scripts; audit the actual production response as described in
`docs/DEPLOYMENT.md`.

The replacement roadmap is [atrinik/atrinik#168](https://github.com/atrinik/atrinik/issues/168).
