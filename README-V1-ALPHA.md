# 1.0 alpha 2 — parallel architecture reset

This package retains the existing 0.20.20 public site unchanged and adds a parallel generic network engine.

## Install

1. Deploy the package normally.
2. In Supabase SQL Editor, run `supabase/v1.0-alpha1-generic-network-engine.sql` once.
3. Open `/admin-v1.html`.
4. Enter the existing admin/crawl token.
5. Create a test network and add Core artists.

Do not replace `/index.html` with `/v1.html`; the latter is only a data-contract validation page in this alpha.

See `docs/V1-ARCHITECTURE.md` for the design contract and acceptance criteria.


## Alpha 2 authentication hotfix
The v1 admin now reuses the existing project admin/crawl credential with trimmed header handling, Bearer fallback, session-only token persistence, and an explicit Verify token control. No database migration changes from alpha 1.


## v1.0.2
Unified Admin authentication for protected GET and POST actions. This corrects both Core display and Core-to-Expanded scanning without changing the generic network engine.


## v1.0.3 viewer
`/v1.html` is now a functional generic network viewer. Run `supabase/v1.0.3-viewer-methodology.sql` once on an existing alpha database to enable per-network methodology editing.


## v1.0.4 published snapshots
The viewer reads a prebuilt `v1_published_networks.payload`. Run `supabase/v1.0.4-published-network-snapshots.sql`, then use **Build / rebuild viewer snapshot** in Admin once for each existing network.


## v1.0.7 viewer parity and media cache
Run `supabase/v1.0.7-ui-media-parity.sql` once. In Admin, use **Wikipedia media cache → Refresh missing / stale media** to resolve Wikipedia/Wikidata links and store representative thumbnails in Supabase Storage. The published viewer snapshot carries the stored Supabase thumbnail URL, so ordinary drawer clicks make no live Wikimedia request. Media entries are due for revalidation after 90 days.
