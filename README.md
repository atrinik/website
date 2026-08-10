# Atrinik website

This repository is the sole source and deployment owner for the static,
MIT-licensed atrinik.org website. It deliberately contains no account,
gameplay, payment, analytics, advertising, or server-side runtime.

Atrinik's policy reserves new and modified creative game content for people:
generative maps, pixel art, music, sound effects, quests, dialogue, lore, and
other authored world content are not accepted. The owning repositories are
documenting that rule and auditing the existing corpus before making an
unqualified blanket authorship claim. Human Atrinik contributors and
appropriately licensed work from Crossfire, Daimonin, and other upstream
creators retain their exact authorship, provenance, notices, and licenses;
“human-made” does not mean solely Atrinik-original or covered by one license.

The project's software is developed primarily through Codex-driven agentic
workflows under human direction, review, provenance controls, tests, and
repository validation. Direct human-written code contributions are welcome
under the same gates. “Generative AI” in this policy means tools that synthesize
creative content or code, not gameplay systems such as creature or NPC AI.

Atrinik began in 2009 under founder and original lead Zoey Rose. She led its
human-developed beginning alongside the wider Atrinik Development Team. The
maintained GPL C Classic line credits Atrinik, Daimonin, Crossfire, and wider
upstream/community contributors through its authoritative records; 2011 was a
major development and release era, not the founding year. The new Go server,
Rust client/editor/renderer/toolkit, and Protobuf protocol are a Codex-driven
clean-room reimplementation and improvement, not a mechanical source port and
not yet a complete game release.
Follow the [replacement roadmap](https://github.com/atrinik/atrinik/issues/168)
for current readiness.

The game-content policy does not yet describe every image on atrinik.org. Four
temporary OpenAI-generated concept images remain transparently recorded in
`src/data/media.json` and are tracked for replacement by
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
unsafe links, client JavaScript, broken internal links, and page-weight budget
violations. Generated release evidence belongs under ignored `build/`.

`src/data/downloads.json` is a reviewed immutable catalog, not a live release
feed. Its closed schema keeps a release repository separate from an artifact
role and binds exact release evidence. Drafts, prereleases, zero-asset releases,
and guessed or mutable links fail closed; an empty catalog keeps the Classic
release-page fallback useful without JavaScript or a GitHub request.

Cloudflare Pages uses one Git-integrated project. `main` serves the canonical
`atrinik.org`; `www.atrinik.org` permanently redirects to it. Cloudflare builds
all non-production branches and posts its native `pages.dev` preview link on
same-repository pull requests. The repository has no manual upload path,
custom preview hostname, or Cloudflare credential. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the exact preview, domain,
health, and rollback contract.

The replacement roadmap is [atrinik/atrinik#168](https://github.com/atrinik/atrinik/issues/168).
