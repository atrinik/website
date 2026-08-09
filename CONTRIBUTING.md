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
