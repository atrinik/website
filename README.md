# Atrinik website

This repository is the sole source and deployment owner for the static,
MIT-licensed atrinik.org website. It deliberately contains no account,
gameplay, payment, repository-managed analytics or tracking, advertising, or
server-side runtime.

Atrinik keeps people in creative control of its game world. Generated visual
and audio assets—including pixel art, graphics, animation, music, and sound
effects—are not accepted as final game content. They may be used only as
clearly identified temporary design drop-ins while suitable human-created
replacements are found or made. For maps, quests, dialogue, and lore, a human
content creator may use generative tools to help shape terrain or develop
writing while directing, reviewing, and taking responsibility for the result.
The owning repositories are documenting that policy and auditing the existing
corpus before making an unqualified blanket authorship claim. Human Atrinik
contributors and appropriately licensed work from Crossfire, Daimonin, and
other upstream creators retain their exact authorship, provenance, notices,
and licenses; “human-led” describes creative direction and responsibility, not
solely Atrinik-original work or one shared license.

The project's software is developed primarily through Codex-driven agentic
workflows under human direction, review, provenance controls, tests, and
repository validation. Direct human-written code contributions are welcome
under the same gates. “Generative AI” here means tools that synthesize creative
content or code, not gameplay systems such as creature or NPC AI.

Atrinik began in 2009 under founder and original lead Zoey Rose. She led its
human-developed beginning alongside the wider Atrinik Development Team. The
maintained GPL C Classic line credits Atrinik, Daimonin, Crossfire, and wider
upstream/community contributors through its authoritative records; 2011 was a
major development and release era, not the founding year. The new Go server,
Rust client/editor/renderer/toolkit, and Protobuf protocol are Codex-driven MIT
replacement foundations governed by evidence-gated provenance. Independent
implementation is the default where exact reuse is unproven. Exact historical
reuse follows the [local record](PROVENANCE.md) and
[canonical grant registry](https://github.com/atrinik/atrinik/blob/main/docs/PROVENANCE.md);
admitted destination material may be MIT-relicensed, while the Classic
repository remains GPL-distributed. The foundations are not yet a complete game
release.
Follow the [replacement roadmap](https://github.com/atrinik/atrinik/issues/168)
for current readiness.

Four temporary OpenAI-generated concept images on atrinik.org are not game
content. They remain transparently recorded design drop-ins in
`src/data/media.json` and are tracked for suitable human-created replacements by
[website issue #22](https://github.com/atrinik/website/issues/22).

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
preview fallback until issue #22 supplies approved replacement artwork; routes
can select a more relevant record from the same validated media catalog. The
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

The build writes a self-contained static site to `dist/`. Validation rejects
unproven media, mutable download coordinates, missing attribution or alt text,
unsafe links, repository-authored client JavaScript, broken internal links, and
page-weight budget violations. It permits only inert, locally serialized
`type="application/ld+json"` data blocks; executable scripts, script sources,
event handlers, and JavaScript assets remain forbidden. Generated release
evidence belongs under ignored `build/`.

`src/data/downloads.json` is a reviewed immutable catalog, not a live release
feed. Its closed schema keeps a release repository separate from an artifact
role and binds exact release evidence, including the release coordinate and the
evidenced artifact package version. Drafts, prereleases, zero-asset releases,
and guessed or mutable links fail closed. A deliberately authorized primary
artifact-version mismatch is an explicit closed-contract exception rendered as
a warning; an empty catalog keeps the Classic release-page fallback useful
without JavaScript or a GitHub request.

Cloudflare Pages uses one Git-integrated project. `main` serves the canonical
`atrinik.org`; `www.atrinik.org` permanently redirects to it. Cloudflare builds
all non-production branches and posts its native `pages.dev` preview link on
same-repository pull requests. The repository has no manual upload path,
custom preview hostname, or Cloudflare credential. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the exact preview, domain,
health, and rollback contract.

Zero-JavaScript, cookie, analytics, and tracking claims apply to the built
artifact, not every Cloudflare response. Cloudflare may inject bot/security
JavaScript or a dashboard-managed Web Analytics beacon, set strictly necessary
cookies, or serve a challenge response with different HTML, scripts, cookies,
and CSP. Ordinary static responses retain a `script-src 'none'` CSP that blocks
injected scripts; audit the actual production response as described in
`docs/DEPLOYMENT.md`.

The replacement roadmap is [atrinik/atrinik#168](https://github.com/atrinik/atrinik/issues/168).
