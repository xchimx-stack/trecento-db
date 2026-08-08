# v0.8.4 relationship seed fix

Artist seeding already works: 107 crawler records collapse to 106 unique artists
because the crawler can surface the same ULAN entity through more than one path.

The prior seeder imported zero relationships because it looked for relationship
arrays inside each artist. The crawler's normalized graph relationships are
actually stored at the top level of `data/imported-artists.json`.

This build imports that top-level `relationships` array using:

- `from_ulan` -> Supabase `from_artist_id`
- `to_ulan` -> Supabase `to_artist_id`
- `style` -> `visual_class`
- `directed` -> `directed`
- `source_relation` / `evidence_class` -> `relationship_type`

It also stores ULAN evidence in `relationship_sources`.

Expected log lines:

    Top-level graph relationships found: ...
    Relationship rows accepted: ...
    Relationships skipped for missing endpoints: ...
    Supabase seed complete.
    Database artists: 106
    Database relationships: ...

The live frontend remains JSON-backed until these database counts are verified.
