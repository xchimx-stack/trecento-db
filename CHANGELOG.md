# Changelog

## 1.1 RC5 — Wikipedia relationship policy hard gate

- Fixes Wikipedia relationship edges appearing on initial load while the network source-policy checkbox is OFF.
- The public graph endpoint now enforces the network's current Wikipedia relationship setting even when an older stored snapshot was published while Wikipedia was enabled.
- Pure Wikipedia edges are removed when OFF; mixed ULAN/Wikipedia evidence retains the ULAN edge but removes Wikipedia as an active source.
- The viewer repeats the policy filter before graph materialization so hidden Wikipedia edges cannot affect topology, degree, spacing, or first render.
- Cached Wikipedia article links and thumbnails remain available in artist drawers; this setting controls relationship sourcing, not media/reference links.
- No SQL migration required.


## 1.1 RC4 — ULAN place parsing repair

- Fixes Getty ULAN Events parsing that passed activity chronology such as `1288-1324` into the Cities filter as if it were a place.
- Leading event chronology is stripped from mixed values such as `1355-1389 Siena (...)`, yielding `Siena`.
- Date-only Event rows are discarded as non-places.
- Getty place hierarchy/type parentheticals are reduced to the human place label used by the viewer.
- Birth/death places use the same normalization.
- Existing cached ULAN profiles are normalized during snapshot publication, so rebuilding a viewer snapshot repairs current networks without a full ULAN refetch.
- City options are generic/alphabetical rather than hard-coded to Trecento or Low Countries city lists.
- No SQL migration required.


## 1.1 RC3 — chronology and source-policy hotfix

- ULAN chronology `0`, null, missing, or unparseable is treated as unknown rather than outside the configured period.
- Unknown chronology remains eligible; only real parsed dates demonstrably outside the network range are `chronology_out`.
- Candidate resolution reports `CHRONOLOGY_UNKNOWN — ULAN did not provide a machine-readable date; candidate retained`.
- The saved Wikipedia relationship policy is now applied before the initial graph materialization/render, so Wikipedia edges do not flash or remain visible when the network setting is OFF.
- RC2 layout, tier sizing, density spacing, media caching, and architecture are unchanged.
- No SQL migration required.


## 1.1 RC2 — production cutover

- Promotes the generic published-snapshot viewer to production `/index.html`.
- Promotes generic network administration to production `/admin.html`.
- Retires parallel v1 and legacy Trecento/Low Countries viewer/admin/discovery pages; old URLs redirect instead of carrying duplicate application code.
- Fixes the actual render path so Core / Expanded / Comprehensive circles use distinct 40 / 31 / 24 px baselines with only a modest connectivity boost.
- Adds density-aware spacing: medium networks receive more breathing room, while very large connected components compress automatically.
- Preserves topology-first workshop clustering and the improved chronology force.
- Removes redundant background chronology lines/year labels.
- Published snapshots identify build version `1.1-rc2`.
- No SQL changes beyond the existing 1.1 RC1 migration.


## 1.1 RC1 — generic network completion candidate

- Core admission is incremental: the admitted artist's own ULAN record is parsed, existing in-network edges become available immediately, outside connections remain candidates, and the viewer snapshot republishes without recrawling the network.
- Tightens topology-first component packing and strengthens the soft chronology anchor while preserving workshop/relationship clustering over geography.
- Adds clear tier-size hierarchy: Core nodes are largest, Expanded moderately smaller, Comprehensive smaller again, with modest degree scaling inside each tier.
- Makes unknown ULAN relationship quarantine conspicuous in Admin; unknown terms withhold only the affected edge, not either artist.
- Adds generic per-network Wikipedia relationship discovery (BETA), separate from media caching, with nondestructive enable/disable behavior. ULAN remains authoritative when Wikipedia conflicts.
- Adds run status for Wikipedia discovery and stored-edge counts.
- Adds destructive network deletion with explicit confirmation, ON DELETE CASCADE cleanup of network-scoped SQL rows, and orphan artist/media cleanup when no other network uses the artist.
- Shared methodology remains global rather than network-specific.
- Generic viewer starts with “Select network” rather than Trecento-specific identity text.
- Adds `supabase/v1.1-rc1-generic-network-completion.sql`.


## 1.0.14 — Wikipedia/Commons throttle isolation

- Once ULAN → Wikidata yields a Wikipedia sitelink, the identity/link is accepted immediately; the resolver no longer re-fetches the Wikipedia page merely to validate a Wikidata sitelink.
- Adds throttling, maxlag, Retry-After handling, backoff, gzip, and serialized pacing to Wikipedia and Commons Action API calls, not just Wikidata.
- Artwork lookup failure from a transient Wikimedia throttle no longer marks the artist unresolved/invalid. The Wikipedia identity is cached and media is marked `retry` for a short recheck.
- Uses direct local-language Wikidata sitelinks when no English sitelink exists before attempting expensive name searches.
- Wikimedia image binary downloads also honor retry pacing.
- Admin distinguishes unresolved identities from media retries.
- No SQL changes.


## 1.0.13 — Wikimedia throttling and resolver request-budget repair

- Handles Wikidata HTTP 429/503 responses using `Retry-After` when supplied and exponential backoff otherwise.
- Adds `maxlag=5`, serialized request pacing, gzip support, and an informative User-Agent as recommended by Wikimedia API guidance.
- Reduces the unresolved-artist worst case from roughly 20–30 Wikidata calls to a bounded authority search path: exact P245 search, EN/DE validated name fallbacks, then one canonical fallback in IT/FR/NL.
- Admin pauses 900 ms between artist refresh operations so sequential Vercel calls do not form a continuous Wikimedia burst.
- Exact P245 validation remains mandatory; throttling changes do not weaken identity matching.
- No SQL changes.


## 1.0.12 — Wikidata resolver regex repair

- Fixes an escaping error introduced in 1.0.11 where JavaScript regex literals were emitted as `\\d` / `\\s` instead of `\d` / `\s`.
- Valid numeric Getty ULAN IDs such as `500005259` are now accepted by the authority resolver.
- Valid Wikidata Q-IDs such as `Q48319` are now accepted by entity loading.
- ULAN inverted-name whitespace normalization is restored.
- Adds an executable regression test for numeric ULAN IDs, Wikidata Q-IDs, and name normalization.
- No SQL changes.


## 1.0.11 — Wikidata ULAN resolver repair

- Removes Wikidata Query Service/SPARQL from the critical media identity-resolution path.
- Resolves Getty ULAN IDs through the normal Wikidata API, validating the candidate entity's P245 claim exactly against the artist's ULAN ID.
- Uses structured Wikidata search first, then name variants/languages with mandatory P245 validation.
- Reuses the validated Wikidata entity's English Wikipedia sitelink when available.
- Admin media refresh now reports resolved vs unresolved separately and shows recent per-artist resolution traces instead of collapsing failures into an opaque count.
- No SQL changes.


## 1.0.10 — authority-first media, shared methodology, role normalization

- Media identity resolution now uses Getty ULAN ID → Wikidata P245 → English Wikipedia sitelink as the primary path, with English-first title search only as fallback.
- Cached thumbnails no longer use Wikipedia lead images. The cache chooses a stable pseudo-random image from the article body after rejecting portrait/self-portrait, engraving, woodcut, drawing, signature, monument, map, and similar non-work filenames.
- Wikipedia links and selected artwork thumbnails are cached in Admin and published to the snapshot; public drawer clicks remain cache-only.
- Default viewer tier controls no longer mention Trecento before a network is selected.
- Each network receives a stable palette derived from its network identity, selected from readability-safe muted palettes.
- Viewer role filters are fixed semantic buckets derived from raw ULAN roles: Painters, Illuminators, Printmakers, Other / unclassified. ULAN role diversity no longer gates candidate admission.
- Methodology is now site-wide rather than per-network. Admin edits one shared methodology outside the selected-network workspace.
- Adds `v1_site_settings`; run `supabase/v1.0.10-shared-methodology.sql` once.


## 1.0.9 — adaptive layout, network switching, cached media correction

- Replaces region-column generic placement with a topology-first adaptive layout. Connected components are solved internally from graph structure, chronology is a soft vertical anchor, same-region artists receive only gentle cohesion, documented long edges receive strong shortening pressure, and components are packed compactly around the primary/Core component.
- Graph world dimensions are derived from the nodes actually present rather than a fixed Dutch-like canvas.
- v1 network navigation is now a compact dropdown. With no network in the URL it displays `Select network` rather than automatically opening the first network.
- Adds a Windows-style `×` **Close network** control to Admin so the selected network workspace can be dismissed and another network chosen quickly.
- Fixes the transplanted drawer's lingering `Loading image…` state. Cached thumbnail renders immediately; absence of cache displays `No cached image` immediately.
- Keeps the production-style Wikipedia button directly below the thumbnail, reading its cached URL from the published snapshot.
- Wikipedia media refresh now attempts English Wikipedia first for every network, then falls back to an existing/local-language cache and other relevant languages.
- No SQL changes.


## 1.0.8 — production UI transplant

- Replaces the reconstructed v1 viewer with a literal transplant of the current production `public/index.html` renderer and interaction layer.
- v1 now uses the same production drawer DOM/CSS, atmospheric cursor repulsion, selected-node pressure, pan/zoom/touch handling, tier animation, source stripes, directional arrow clipping, search, artist list, overflow drawer, relationship key, and responsive/mobile behavior.
- Only the data/bootstrap layer is replaced: an adapter converts the generic published v1 snapshot into the record shape expected by the production renderer.
- Generic chronology uses each network's configured start/end years; generic geography uses occupied ULAN/curatorial regions with the production soft-geography force profile.
- Drawer media remains cache-only from the v1 published snapshot. Public node clicks do not query Wikipedia/Wikimedia.
- Network selector and methodology are generated from `v1_networks`.
- Legacy production `/index.html` remains unchanged.
- No SQL changes.


## 1.0.7 — viewer UI parity + cache-first Wikipedia media

- Brings the mature production interaction model onto the generic v1 snapshot viewer without reintroducing legacy data-resolution logic.
- Adds continuous restrained node motion, cursor repulsion, collision avoidance, selected-node nudge, and geography/year anchoring.
- Adds circle-only tap/click selection with drag-to-pan behavior that remains usable on touch/mobile.
- Adds collapsible artist drawer, selection/neighbor emphasis, search/jump, Unmapped drawer, dense-connection `ADDITIONAL +N` overflow, source legend, and viewport-preserving tier/city/role filtering.
- Restores directed relationship arrows with source colors, solid/dashed/dotted classes, clipped endpoints, and parallel offsets for multiple relationships between the same pair.
- Adds Admin-driven Wikipedia media resolution and 90-day revalidation. Representative Wikimedia thumbnails are downloaded into the public `v1-media` Supabase Storage bucket; the public viewer reads only the stored Supabase URL and never fetches a thumbnail from Wikipedia/Wikimedia on drawer click.
- Media refresh remains independent of the per-network experimental Wikipedia relationship-source switch.
- Enforces the project media-storage safety policy at 50% of configured Supabase Storage capacity (default assumes the current 1 GB free-tier allowance; override with `SUPABASE_STORAGE_CAP_BYTES` if the plan changes).
- Adds `supabase/v1.0.7-ui-media-parity.sql`.
- Legacy `/index.html` remains untouched.


## 1.0.6 — visible SVG canvas hotfix

- Fixes the v1 graph canvas having no explicit CSS width/height, which could leave the SVG at its intrinsic viewport while graph coordinates were laid out on an ~1800×1000 canvas.
- `#canvas` now explicitly fills the browser viewport with `width:100%; height:100%` and the SVG element carries matching width/height attributes.
- Adds a visible diagnostic if a nonempty published snapshot produces zero artists after tier/city/role filters instead of silently showing an empty graph.
- No database or SQL changes.


## 1.0.5 — snapshot builder relationship fix

- Fixes snapshot publishing failure caused by asking PostgREST to embed `v1_curatorial_overrides` through `v1_network_memberships`, which have no direct foreign-key relationship.
- Snapshot publishing now reads memberships + artists, then fetches curatorial overrides separately by `network_id` and member `artist_id`, and merges them deterministically in memory.
- No schema changes and no new SQL migration.
- Published-snapshot architecture from v1.0.4 remains unchanged.


## 1.0.4 — published graph snapshots

- Public `/v1.html` no longer assembles artists, profiles, media, and relationships on demand.
- Adds `v1_published_networks`, storing one compact publish-ready JSON payload per network.
- `/api/v1?action=graph` now performs one snapshot-row read and never reconstructs the network live.
- Adds **Build / rebuild viewer snapshot** to Admin with artist/relationship counts and publication timestamp.
- Bulk admissions, ULAN refreshes, curatorial artist additions, manual relationships, display overrides, source-policy changes, and methodology edits rebuild the snapshot after the underlying operation completes.
- Snapshot generation itself is restricted to ULAN assertions whose focus IDs are current network members, reducing admin-side database work.
- Viewer returns a clear “publish first” error for networks without a snapshot rather than silently falling back to expensive live assembly.
- Adds `supabase/v1.0.4-published-network-snapshots.sql`.
- Legacy `/index.html` remains untouched.


## 1.0.3 — generic viewer integration

- Replaces the buried validation list with a functional generic SVG network viewer at `/v1.html`.
- Network cards are clickable; direct network URLs use `?network=<slug>`.
- Ports the proven interaction model without reintroducing legacy data-resolution logic: Core/Expanded/Comprehensive, Cities, Roles, ULAN/Manual source filters, optional Wikipedia (BETA) source visibility, pan/zoom, selection drawer, loading indicator, and methodology popup.
- Viewer layout treats chronology/geography as anchors and allows force/collision adjustment for legibility.
- Extends the generic graph payload with ULAN roles, chronology, active/birth/death places, and cached media metadata.
- Adds per-network `methodology_text` editable from `/admin-v1.html`.
- Adds `supabase/v1.0.3-viewer-methodology.sql` for existing v1 installs.
- Legacy `/index.html` remains untouched.


## 1.0.2 — unified v1 Admin authentication

- Fixes `Scan Core → Expanded candidates` returning `Invalid admin token` after a successful token verification.
- Fixes `Show current Core` failing for the same reason.
- Root cause: protected GET requests did not use the same authentication path as POST requests.
- The centralized v1 Admin request helper now attaches the verified credential to every API request when a token is present, including protected GET endpoints such as `frontier` and `list-candidates`.
- No network-generation, relationship-normalization, database-schema, or production `index.html` behavior changed.
- No SQL changes from 1.0.1.


## 1.0-alpha.2 — v1 admin authentication hotfix

- Keeps all alpha-1 network-generation/data behavior unchanged.
- Reuses the established project admin credential and accepts `x-crawl-token`, `x-admin-token`, or Bearer authentication.
- Trims accidental whitespace on both the configured and supplied token.
- Adds a **Verify token** control to `/admin-v1.html` before long ULAN operations.
- Persists the token only in browser `sessionStorage` for the current tab/session.
- Authentication errors now distinguish an unconfigured deployment from a mismatched token.
- No SQL changes from alpha 1.


## 0.20.20 — ULAN role propagation hotfix

- Fixes Trecento ULAN role backfill so artists whose authority ID lives in `external_ids` are included, not only rows with `artists.ulan_id` already populated.
- Uses a dedicated parser for the Getty `Roles:` section and writes the recovered role string back to `artists.ulan_roles`.
- Adds a visible **Roles · Getty ULAN** section to Trecento artist drawers.
- The Painter / Illuminator / Other filter now receives the populated ULAN role values after the one-time backfill.
- Methodology/version updated to v0.20.20.
- No new SQL migration beyond the v0.20.19 `ulan_roles` column.


## 0.20.19 — roles, manual evidence, loading state, directionality repair

- Adds a Trecento **Roles** filter driven only by persisted Getty ULAN roles: Painters, Illuminators, Other/unclassified. Multi-role artists remain visible when either matching role is selected.
- Adds **Manual** as a third relationship-source checkbox beside ULAN and Wikipedia (BETA). Manual artist metadata overrides remain effective independent of edge-source filters.
- Adds a visible staged loading indicator while artists/relationships/layout are prepared.
- Existing-artist override form now populates with the artist's currently effective tier, region, chronology and existing override note.
- Adds an admin ULAN-role backfill tool for existing Trecento artists.
- Adds a network-wide ULAN directionality repair tool for Trecento and Low Countries, using the ULAN evidence source record to interpret reciprocal terms correctly. Chronology-based arrow reversal has been removed.
- Adds regression coverage for Rembrandt → Gerrit Dou and Otto van Veen → Rubens normalization.
- Methodology updated to v0.20.19.
- Requires the included SQL migration adding `artists.ulan_roles`.


## 0.20.18 — curator workflow + Core defaults

- Both Trecento and 17th-c. Low Countries now open on **Core** by default.
- Tier changes continue to preserve exact pan, zoom, selected artist and drawer state.
- Adds **Add artist from ULAN** to `admin.html`: enter a name or ULAN ID, preview the resolved authority record and existing-network ULAN connections, correct only required placement exceptions, then admit.
- Manual ULAN additions default to **Expanded**. Required placement fields are canonical identity/ULAN ID, layout year, graph region and tier; other authority fields are optional enrichment.
- Proposed ULAN relationships are shown before admission and may be individually excluded.
- Trecento relationship diagnostic now accepts either artist names or ULAN IDs and resolves ULAN identifiers stored through `external_ids`.
- Keeps `Wikipedia (BETA)` labeling and prevents Wikipedia-parsed relationship claims from driving workshop-location inheritance.
- Admin control descriptions retained/cleaned; Low Countries admin now reflects the 25-artist Core target.
- Methodology updated to v0.20.18.
- No SQL migration required.


## 0.20.17 — release-candidate hardening
- Preserve exact pan/zoom viewport and selected artist when switching Core/Expanded/Comprehensive in both networks.
- Label relationship source as `Wikipedia (BETA)` in public source controls and connection drawer.
- Restrict Trecento workshop/teacher placement inheritance to Getty ULAN-backed relationships only.
- Add read-only Trecento pair evidence diagnostic to `admin.html` with exact relationship evidence URLs/text.
- Simplify `admin.html` into a control center and add a plain-English sentence for every admin action; link prominently to Low Countries controls.
- Remove the Low Countries public `BETA` status badge while retaining the `17th-c. Low Countries` network label.
- Retain Trecento Core 25 and curated Expanded target of ~80 total artists.
- Methodology updated to v0.20.17.

# v0.20.16

- Low Countries unresolved geography can inherit a known city from an incoming ULAN pupil/workshop parent node; provenance is shown as `workshop / parent-node fallback`.
- Trecento unresolved geography gets the same conservative workshop-parent fallback after deeper Wikipedia enrichment; chronology-only stragglers can receive a clearly labeled workshop-neighbor layout year.
- Trecento Expanded is now a curated middle layer targeting 80 total visible artists (25 Core + ~55 Expanded), with remaining defensibly mapped artists in Comprehensive.
- Trecento Wikipedia placement enrichment now audits connected unresolved artists too, rather than only zero-degree records.
- Low Countries drawer now surfaces Wikidata and VIAF authority links resolved during the same identity-verified Wikipedia pass used for media, matching Trecento drawer behavior.

## 0.20.15

- Fixes Low Countries ULAN place propagation end-to-end.
- Adds dedicated place-only refresh actions for seeds and candidates; place refresh no longer changes candidate review status.
- Treats a literal `Unknown` geography bucket as unresolved so ULAN active/death/birth evidence can replace it.
- Adds graph-time geography fallback: active location → death place → birth place → Unknown.
- Merges richer place evidence when the same ULAN identity exists in both the seed queue and candidate pool.
- Adds a Helmont ULAN fixture regression covering Antwerp birth / Brussels death fallback.
- Updates Methodology version text to 0.20.15.

## 0.20.13

- Fixes the Getty ULAN relationship parser so dotted leader formatting no longer causes valid relationship rows to be dropped.
- Adds a Low Countries admin “Repair relationship rows” batch that recrawls all ULAN-backed seeds (including held curated seeds) and eligible first-degree candidates.
- Adds a relationship-degree audit to the Low Countries admin page (0 / 1 / 2+ neighbors) to expose remaining islands.
- Preserves held review status while still allowing a curated seed’s relationship rows to be repaired.
- Updates Methodology version text to 0.20.13.

## v0.20.12
- Added admin Low Countries relationship diagnostic for artist identity/tier/edge tracing.
- Removed BETA from the public Low Countries network selector.
- Updated methodology version text.

# Changelog

## 0.20.11
- Fixes desktop node selection by committing selection on pointerdown before atmospheric SVG re-rendering can replace the target.
- Restores the v0.20.8 Dutch/Flemish organic layout by removing post-collision regional clamping that affected a large share of sparse records.
- Renames the network selector to `17th-c. Low Countries · BETA`.
- Updates Methodology version text to 0.20.11.

## 0.20.10
- Removes the accidental visible double-ring hit target; the enlarged click target is now an invisible rectangle covering circle + label.
- Prevents canvas pan/drag state from arming on node press so artist nodes select reliably on the first click.
- Rolls back the v0.20.9 all-node Dutch geographic envelope that compressed regions into columns and caused overlaps.
- Applies post-collision regional recovery only to sparse (0–1 edge) Dutch/Flemish outliers, preserving the organic v0.20.8 cloud for connected artists.
- Adds sparse-recovery diagnostics without changing well-connected node coordinates.
- Updates Trecento and Dutch/Flemish Methodology text to version 0.20.10 and current tier/resolver/layout behavior.

## 0.20.9
- Curates Trecento Core to 25 artists; remaining mapped Trecento artists become Expanded.
- Dutch/Flemish now opens on Core for progressive network exploration.
- Core/Expanded/Comprehensive changes preserve artist selection and drawer state.
- Tier and city filters no longer leak hidden connections through selection.
- Selected-artist viewport stays anchored while Trecento tiers expand/contract.
- City filtering with an active selection no longer refits or moves the viewport.
- Node labels/circles share a larger one-click target; stale drag suppression is cleared.
- Dutch post-collision geography now has a regional envelope and runtime diagnostics for outliers.
- Dutch edge opacity increased again.
- Resolver now merges English + Italian Wikipedia prose/categories when available, improving geography for anonymous masters.
- Retains v0.20.8 resolver repairs, body-image rule, interface styling, and bad-entity protections.
- Removes superseded per-version regression files and release-note fragments from the deployment ZIP.

## 0.20.0–0.20.8
Historical releases added three-tier networks, illuminator discovery, entity rejection, tier counts, Wikidata chronology/geography repair, city filters, organic Low Countries layout, cursor atmosphere, museum-catalogue styling, and drawer/interface refinements. Git/deployment history remains the detailed audit trail.

## 0.20.12-rev1
- Low Countries ULAN enrichment now parses structured active, birth and death places.
- Layout geography fallback is active location → death place → birth place → Unknown.
- The artist drawer shows ULAN active/birth/death place evidence and the layout-location source.
- Node interaction is circle-only; labels never expand or block the click target.
- Low Countries admin enrichment can backfill the new structured place fields.
