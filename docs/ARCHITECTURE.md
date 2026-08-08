# Static website architecture

Astro compiles typed local data and `.astro` templates to static HTML and CSS.
No browser JavaScript or server runtime is emitted. `src/data` is the only
published content input; closed validators reject unknown download/media
fields and unsafe coordinates before rendering.

Downloads remain in their owning GitHub releases. A website record must bind
the component, semantic version/tag, 40-character source revision, platform,
architecture, artifact filename/size/SHA-256, exact release URL, license, and
compatibility. Missing or contradictory records render as unavailable.

Media stays absent until a record binds both source and published digests,
repository/path/revision, author, exact license, transformations, alt text,
and notice. The website never imports an asset tree by implication.

`public/_headers` supplies a no-script CSP and browser hardening for every
static response. Source and built-output validators additionally enforce ten
requests, 100 kB total, 40 kB HTML, 24 kB CSS, and zero JavaScript for this M1
shell. Accessibility validation covers language, landmarks, skip navigation,
primary navigation labelling, one page heading, useful image alternatives,
focus visibility, reflow, and reduced-motion policy; manual assistive-
technology review remains a release gate.
