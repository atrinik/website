# Contributing

Contributions are MIT-licensed and independently implemented. Do not copy or
adapt classic/GPL website code, prose, themes, tests, or media. Record the
public design source for material behavior and follow `PROVENANCE.md` for any
candidate historical reuse.

Every media change updates `src/data/media.json` with its exact locally retained
source, Git blob object ID, source and published digests, published dimensions,
author, license, transformations, alt text, and notice. Every download change
uses an immutable owner release URL and complete compatibility/license
metadata. Missing evidence means the item remains unavailable.

Pull-request titles and commits use Conventional Commits. Run:

```sh
npm ci
npm run check
npm run build
npm run deploy:dry-run
git diff --check
```

Review the built pages at narrow and desktop widths with keyboard-only input,
reduced motion, no JavaScript, and representative screen-reader navigation.

Maintainers may publish a public, search-excluded build only from a trusted,
maintainer-controlled worktree. Complete the credential-free commands above,
inspect `git status --short`, and only then export the scoped Cloudflare token:

```sh
npm run deploy:test -- zoey
npm run undeploy:test -- zoey
```

Use a personal lowercase prefix and always remove its hostname after review.
Never use the manual command to review an untrusted pull request worktree.
Never commit Cloudflare credentials or place a token in a command argument,
tracked `.env` file, build output, or pull request metadata.

Eligible non-Dependabot pull requests whose head branch belongs to
`atrinik/website` receive `pr.<number>.testing.atrinik.org`. The hostname is
public and sends `X-Robots-Tag: noindex, nofollow`. Fork and Dependabot pull
requests intentionally receive only the normal validation jobs: privileged
preview automation never checks out or executes pull request code or artifacts,
and neither class receives a Cloudflare token. Closing an eligible pull request
triggers ownership-checked hostname removal; retry a failed cleanup job.
Cloudflare may retain an opaque deployment internally after successful cleanup.
