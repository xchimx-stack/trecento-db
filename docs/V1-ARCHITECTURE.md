# Art Network Engine 1.0 alpha 1

## Purpose

The 1.0 reset is a generic art-network engine. Trecento Italy and the 17th-century Low Countries are network definitions, not separate applications.

The public 0.20.x viewer remains untouched during the alpha. New work is isolated at `/admin-v1.html`, `/v1.html`, `/api/v1`, and `v1_*` database tables.

## Reproducible network process

1. A curator defines a network and chooses roughly 20–30 **Core** artists.
2. Core artists are resolved to stable Getty ULAN IDs.
3. The engine reads current ULAN relationships from Core.
4. One-hop artist candidates become **Expanded** after scope review/admission.
5. The same engine reads ULAN from admitted Expanded artists.
6. Second-hop candidates become **Comprehensive** after scope review/admission.
7. Curators may add artists, exclude artists, override display placement/tier, or add manual edges without modifying ULAN source facts.

The same code path must work for every future network.

## Source boundaries

### ULAN

ULAN is the primary machine source for identity, roles, chronology, places, and relationships.

Raw ULAN relationship qualifiers are never converted directly into visual edges. They pass through `v1_relationship_rules`, which defines:

- reciprocal qualifier;
- normalized relationship family;
- deterministic direction from the focus record;
- visual class;
- whether the relation is allowed to produce expansion candidates.

Getty's relationship vocabulary is extensible. Any qualifier without an active rule is stored as **quarantined** and cannot create a graph edge or expansion candidate. Admin exposes the unknown-qualifier list for review.

### Manual curation

Manual decisions are overlays. They never overwrite ULAN profiles or ULAN assertions.

- `v1_curatorial_overrides` controls display name, visual placement, or tier for one network.
- `v1_curatorial_relationships` stores curator-supplied edges separately from ULAN.
- `v1_network_memberships.origin` records whether inclusion came from a seed, ULAN expansion, or curatorial addition.

### Wikipedia (BETA)

Wikipedia relationship sourcing is a per-network setting. The alpha establishes this source-policy boundary but intentionally does not migrate the experimental Wikipedia relationship parser yet. Wikipedia assertions will remain independently toggleable and must not change ULAN assertions.

## Display placement vs. source facts

Authority facts and visual layout are separate concepts. A future layout engine may move nodes away from exact chronology/geography anchors to preserve legibility. Source dates and places remain available for drawers.

## Media-cache target

The 1.0 media model is `v1_media_cache`. Drawers should eventually render cached Wikipedia links/thumbnails immediately. Periodic maintenance revalidates stale cache records; ordinary drawer clicks must not depend on live Wikipedia requests.

## Free-tier constraints

The alpha intentionally avoids architecture that requires paid infrastructure:

- ULAN refresh/discovery is browser-orchestrated one artist per Vercel request rather than one long server function.
- Parsed ULAN snapshots are stored; raw Getty HTML is not retained by default.
- Cached images belong in Supabase Storage rather than the Git repository or Vercel bundle.
- The 1.0 tables live in the existing Supabase project, so the reset does not require another active project.
- The new backend adds only one Vercel function (`api/v1.js`) and keeps the consolidated-function approach.

## Acceptance criteria before replacing `/index.html`

1. Trecento can be generated from its Core using the generic workflow.
2. Low Countries can be generated using the identical workflow and tables.
3. A third throwaway network can be created entirely from Admin without schema changes or network-specific code.
4. ULAN refresh is idempotent: if Getty data has not changed, a second refresh produces no substantive changes.
5. Every encountered ULAN qualifier is either deterministically mapped or explicitly quarantined.
6. Manual curation survives ULAN refreshes unchanged.
7. Cached media renders without a live Wikipedia request.
8. The existing visual UI can consume the generic graph payload without network-specific data logic.
