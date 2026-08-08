# v0.8.3 Supabase seed dedupe fix

The previous build successfully reached Supabase but failed with PostgreSQL
error `21000` because duplicate ULAN IDs appeared more than once in the same
`ON CONFLICT DO UPDATE` statement.

This version deduplicates before writing:

- artists by `ulan_id`
- non-ULAN fallback artists by canonical name
- external IDs by `(source, external_id)`

The crawler and live frontend are otherwise unchanged.

Expected build log now includes:

    Source records: 107
    Artist records accepted: ...
    Unique ULAN artists after dedupe: ...
    Unique external IDs after dedupe: ...
    Supabase seed complete.
    Database artists: ...
    Database relationships: ...
