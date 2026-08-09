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

Cloudflare Pages uses Git integration with production branch `main`, build
command `npm ci && npm run build`, and output directory `dist`. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for preview, permissions, domain,
health, and rollback ownership.

The replacement roadmap is [atrinik/atrinik#168](https://github.com/atrinik/atrinik/issues/168).
