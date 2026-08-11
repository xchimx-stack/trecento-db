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
