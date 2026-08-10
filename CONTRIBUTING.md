# Contributing

Contributions are MIT-licensed and independently implemented. Do not copy or
adapt classic/GPL website code, prose, themes, tests, or media. Record the
public design source for material behavior and follow `PROVENANCE.md` for any
candidate historical reuse.

Every media change updates `src/data/media.json` with its exact locally retained
source, Git blob object ID, source and published digests, published dimensions,
author, license, transformations, alt text, and notice. Every download change
records the distinct release repository and artifact role; published release
state; exact revision, versioned artifact, manifest, checksum, release-note,
and SBOM URLs; platform/archive/size/digest details; and complete installation,
compatibility, and software/bundled-asset license boundaries. Independently
verify those fields against the immutable release API and manifest. Missing or
contradictory evidence means the item remains unavailable.

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
For deployed pages, separately inspect delivered HTML, network requests,
cookies, browser storage, and CSP failures so Cloudflare-injected security or
analytics behavior is recorded instead of attributed to the static build.

Cloudflare Pages automatically builds all non-production branches. A pull
request from this repository receives a native `pages.dev` preview link from
the Cloudflare GitHub integration; a fork pull request does not. Preview URLs
are public and must never contain credentials or private material. Cloudflare
adds `X-Robots-Tag: noindex` to preview responses, but immutable deployment URLs
can remain reachable after the pull request closes.

There is no manual upload command or custom testing hostname. Push the reviewed
branch and use the Cloudflare bot's pull-request link. Never add a Pages API
token to this repository merely to publish or clean up a preview.
