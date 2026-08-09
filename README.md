# Atrinik website

This repository is the sole source and deployment owner for the static,
MIT-licensed atrinik.org website. It deliberately contains no account,
gameplay, payment, analytics, advertising, or server-side runtime.

The public information architecture keeps the useful journeys from Atrinik's
former project portal without reviving its forum stack: understand the world,
find the maintained Classic line, follow the next-generation roadmap, and
reach the owning GitHub repositories. Classic and replacement readiness and
licenses remain visibly distinct on every relevant page.

Original website concept artwork is retained under `artwork/originals/` as
provenance evidence. Content-addressed, optimized derivatives are published
from `public/media/`; their exact source Git blob object IDs, digests,
dimensions, transformations, licenses, notices, and alternative text are recorded in
`src/data/media.json`.

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

Cloudflare Pages uses one Git-integrated project. `main` serves the canonical
`atrinik.org`; `www.atrinik.org` permanently redirects to it. Only from a
trusted maintainer-controlled worktree, after running the credential-free gates
above and exporting the scoped Cloudflare token, a maintainer can publish and
remove a public noindex testing hostname with:

```sh
npm run deploy:test -- zoey
npm run undeploy:test -- zoey
```

Never use the manual command from a worktree containing untrusted pull request
code. Eligible same-repository pull requests receive
`pr.<number>.testing.atrinik.org`; fork and Dependabot pull requests do not
receive Cloudflare credentials or custom hostnames. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the exact preview, permission,
DNS, health, cleanup, and rollback contract.

The replacement roadmap is [atrinik/atrinik#168](https://github.com/atrinik/atrinik/issues/168).
