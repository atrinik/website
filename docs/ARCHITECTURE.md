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

The executable validator intentionally mirrors only the closed required-field
sets and bounds from the two JSON Schemas so the build does not acquire a
general-purpose runtime schema dependency. Source validation compares their
field sets and closed-object flags on every run; contract changes must update
both forms and their fixtures together.

`public/_headers` supplies a no-script CSP and browser hardening for every
static response. The built-output validator additionally enforces at most 16
generated files, 900,000 bytes total, 140,000 aggregate HTML bytes, 40,000
aggregate CSS bytes, 700,000 aggregate raster image bytes, and zero JavaScript.
Published image filenames are content-addressed for immutable caching, and
images below the fold are lazy-loaded. Artwork uses its intrinsic aspect ratio
and an automatic rendered height so neither the portrait hero nor landscape
posters are cropped. The presentation avoids fixed decorative texture layers,
backdrop filters, large CSS blur filters, and image filter/transform effects so
scrolling does not continuously repaint those effects. Accessibility
validation covers language, landmarks, skip navigation, primary navigation
labelling, one page heading, useful image alternatives, focus visibility,
reflow, and reduced-motion policy; manual assistive-technology review remains
a release gate.
