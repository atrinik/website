# Atrinik website repository guide

- This repository is the sole source and deployment owner for atrinik.org. It
  owns the clean-room MIT Astro/TypeScript website, public content, deployment
  configuration, and operational recovery documentation. Keep it independently
  buildable and deployable from a clean checkout.
- Work from an issue in this repository and preserve its milestone outcome,
  acceptance criteria, dependencies, product specification, and licensing
  constraints. The thin `atrinik/atrinik` wrapper may register and build this
  component but never owns Astro source.
- Treat [atrinik/atrinik#168](https://github.com/atrinik/atrinik/issues/168) as
  the authoritative cross-repository implementation plan. Local issues own
  website delivery units; reflect dependency or exit-gate changes in that plan.
- Pull-request titles and commits use Conventional Commits style. Squash merges
  are released by semantic-release; production deployments must identify the
  exact source revision and immutable inputs they contain.

## Static-first architecture and ownership

- Use Astro with TypeScript and static output by default. Prefer semantic HTML,
  CSS, Markdown or structured data, and minimal progressively enhanced
  JavaScript. Do not add a server runtime, database, CMS, or client framework
  without an issue that proves the static design cannot meet the requirement.
- The website is a public presentation and discovery surface, not a game
  server, account service, game API, metaserver, protocol authority, content
  compiler, release store, or technical-documentation fork.
- Never handle account credentials, characters, gameplay state, payments,
  private community data, or persistent game sessions here. Keep the
  metaserver and any future play service separately owned and independently
  degradable.
- Core pages must render usefully without client JavaScript or live external
  services. Any server-status integration is read-only, bounded, cached as
  appropriate, and has honest empty, stale, unavailable, timeout, and malformed
  states.
- Cloudflare Pages owns preview and production deployment for this repository;
  document project, branch, environments, custom domain and canonical-host
  routing, DNS/TLS ownership, permissions, health checks, cache invalidation,
  rollback, and outage behavior here. Keep `meta.atrinik.org` and any future
  game host separate.
- Do not place secrets in source, static output, browser code, build logs,
  fixtures, preview metadata, or `PUBLIC_` variables. Deployment credentials
  belong in protected environments with least privilege. A Pages Function or
  other dynamic boundary requires an explicit security and ownership issue.

## Releases, content, and media

- Consume immutable, schema-validated release manifests and asset coordinates:
  component, version/tag, source revision, platform/architecture, compatibility,
  artifact name, byte size, digest, signature or provenance where available,
  and exact license. Do not scrape mutable pages or construct guessed download
  URLs.
- Keep classic GPL packages visibly distinct from fresh MIT replacement
  packages throughout coexistence. State protocol, content, platform, and
  launcher compatibility precisely; never imply that the website's MIT license
  covers downloaded binaries, maps, archetypes, graphics, audio, or other
  mixed-license material.
- Treat missing, partial, stale, contradictory, or unverifiable metadata as an
  unavailable download/status, not as permission to publish a likely link or
  claim. Release archives stay with their owning component release service.
- Every visual and media derivative must have recorded source repository/path,
  immutable source revision and digest, author, exact license, transformations,
  required attribution, and useful alt text or an explicit decorative role.
  Build validation must reject unproven media, missing attribution, and missing
  accessibility metadata.
- The approved historical MIT provenance-grantor registry in
  `atrinik/atrinik/AGENTS.md` is exhaustive and authoritative; do not maintain a
  grantor list here. A grant may be used only after complete, non-shallow
  history including renames and moves proves independently separable material
  is the listed grantor's solely authored original work and contains no
  conflicting embedded material. Record all evidence and cite the exact
  wrapper revision containing the registry entry.
- Do not republish archived avatars, biographies, forum posts, accounts, or
  other personal data without a separately reviewed privacy and provenance
  decision. Omit analytics, tracking, cookies, advertising, and third-party
  embeds by default.

## Accessibility, performance, and security

- Meet WCAG-oriented semantic structure, keyboard and visible-focus behavior,
  contrast, headings, labels, error states, zoom/reflow, reduced motion, and
  screen-reader expectations. Accessibility is an acceptance gate, not a later
  visual polish task.
- Establish and enforce page-weight, image, font, script, request, and Core Web
  Vitals or static-proxy budgets on representative mobile and desktop pages.
  Optimize derivatives without discarding their provenance.
- Apply a restrictive tested CSP and appropriate security, privacy, caching,
  content-type, referrer, framing, and permissions headers. Avoid inline code,
  unsafe HTML, remote build execution, and unbounded third-party content.
- Treat Markdown, release metadata, status data, URLs, SVG, and other imported
  input as untrusted. Validate schemas, allowlist protocols and destinations,
  escape output, prevent path traversal and script injection, and bound fetch
  size, redirects, retries, and timeouts.
- Generated output is disposable and must not be committed. Production and
  previews must install from the pinned Node/package-manager version and
  committed lockfile with immutable Actions and least-privilege permissions.

## Milestone order

- M1 pins Astro, TypeScript, Node, npm and the lockfile; establishes the
  `Website validation` contract; and defines content, media, download,
  attribution, privacy, and Cloudflare ownership boundaries. Architecture and
  provenance work can proceed in parallel with the baseline accessible shell.
- M2 relaunches the preserved website product and information architecture from
  this standalone repository. Page/layout work, structured content, redirect
  mapping, release-metadata adapters, and deployment preparation can proceed in
  parallel behind frozen schemas and navigation contracts.
- M3 publishes only verified first-playable replacement metadata and guidance.
  It does not create a game backend or make unreleased packages appear
  available.
- M4 may improve shared-editor imagery and presentation only through proven,
  optimized media derivatives and stable public metadata. Renderer and editor
  implementation remain in their own repositories.
- M5 updates preserved world/gameplay explanations and migration guidance from
  authoritative released sources without duplicating content or game design.
- M6 hardens accessibility, performance, security, deployment, monitoring,
  rollback, compatibility labeling, and cutover. Rehearse previous-deployment
  and domain recovery before changing public defaults. Do not make replacement
  downloads or replacement-default messaging public before whole-content-pack
  equivalence in
  [atrinik/atrinik#280](https://github.com/atrinik/atrinik/issues/280) and the
  coordinated production cutover in
  [atrinik/atrinik#272](https://github.com/atrinik/atrinik/issues/272) are
  complete.

## Validation and handoff

- During the seed stage, package scripts do not exist. Issue #1 owns the pinned
  npm bootstrap and required aggregate `Website validation` check; do not claim
  absent commands passed.
- Once bootstrapped, start from a clean lockfile install and run the
  repository-documented formatting, lint, Astro/type check, static build,
  internal and established-route link checks, media provenance/license checks,
  accessibility tests, performance budgets, dependency/security checks, and
  deployment dry run. At minimum, the stable contract includes `npm ci`,
  `npm run check`, and `npm run build`. Run `git diff --check` for every change.
- Manually review affected pages with keyboard-only navigation, reduced motion,
  representative screen-reader behavior, narrow/mobile and desktop layouts,
  slow/no JavaScript, missing external metadata, and broken-image states. State
  exact URLs, expected results, and browser/tool prerequisites in the handoff.
- Use the thin `./atrinik` wrapper for cross-repository build and supply-chain
  verification once the website has a stable registered build contract. A
  website-only change has no client/server topology or game-state verification.
- Update `atrinik/atrinik/supply-chain/inventory.json` in a coordinated wrapper
  change whenever toolchains, package sources, Actions, images, vendored inputs,
  licenses, owners, update cadence, EOL response, or validation paths change.
  Pin Actions and images immutably, retain updater hints, and do not add Git
  submodules.
- Every deployment-affecting handoff identifies the preview, source revision,
  build inputs, checks, Cloudflare environment, health result, rollback target,
  and anything not exercised. Never change production DNS or deploy from an
  agent task unless the user explicitly requests that external mutation.
