# v0.8.2 corrected Supabase seed deployment

The prior build failed because the database seeder ran before the ULAN importer
created its output file, and it referenced the wrong filename.

Correct build order:

1. `npm run site:build`
   - runs the existing ULAN importer
   - creates `data/imported-artists.json`
   - builds the unchanged site

2. `npm run db:seed`
   - reads `data/imported-artists.json`
   - writes artists / ULAN IDs / relationships to Supabase

Expected build-log lines after the ULAN crawl:

    Source records: ...
    Artist records accepted: ...
    Supabase seed complete.
    Database artists: ...
    Database relationships: ...

This remains a temporary migration step. Once Supabase is verified, DB seeding
will be removed from ordinary Vercel deployments.
