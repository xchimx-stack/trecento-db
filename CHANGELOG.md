# Changelog

## 0.20.21 — Trecento directionality hotfix

- Replaces the unsafe Trecento ULAN direction repair introduced in 0.20.19.
- The old Trecento importer sometimes stored the normalized `from` artist as the evidence source URL, so reciprocal terms could later be interpreted from the wrong artist perspective and reverse entire workshop trees.
- Direction repair now fetches the actual ULAN records for both endpoints, reparses the reciprocal relationship fresh, and writes a direction only when both available authority records agree on one canonical orientation.
- Conflicting or unresolvable pairs are skipped rather than guessed.
- Low Countries direction rows are left untouched by this hotfix because that pipeline preserved the original ULAN focus record correctly.
- No SQL migration required.


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
