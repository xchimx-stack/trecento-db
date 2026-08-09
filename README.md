# Trecento Network v0.13.0.5

Three graph/data refinements.

## 1. Wikipedia chronology: hard 50-year ceiling

All non-family Wikipedia relationship evidence now requires the artists'
representative chronology to be no more than 50 years apart.

This includes:
- pupil/workshop
- collaboration
- direct influence
- influenced by

Thus a loose Wikipedia influence such as Giotto -> Masaccio is excluded from
the graph.

A one-time deployment cleanup reviews existing Wikipedia evidence:
- Wikipedia-only >50-year relationships are marked `rejected_chronology`
- on ULAN+Wikipedia relationships, only the Wikipedia evidence is rejected
- ULAN evidence remains untouched
- rejected evidence stays in Supabase for audit history

The graph API now ignores rejected evidence when constructing source stripes.

Family relationships remain exempt from the blanket 50-year limit.

## 2. More vertical chronology space

The dynamic chronology axis is approximately 16% taller than v0.13.0.4.
Collision resolution remains active, but chronological bands have more breathing
room before horizontal displacement is needed.

## 3. Source-aware node selection

Selection highlighting now respects the independent source checkboxes.

Examples:
- Wikipedia on, ULAN off: only Wikipedia-supported neighbors stay bright
- ULAN on, Wikipedia off: Wikipedia-only neighbors fade/disappear with their
  inactive relationships
- both on: neighbors supported by either active source stay bright
- both off: no relationship neighbors are highlighted

Dual-source relationships remain highlighted under either applicable source.
