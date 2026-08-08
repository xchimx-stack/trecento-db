# v0.8.1 one-time database seeding deployment

For this checkpoint, Vercel's normal build runs:

1. `npm run db:seed`
2. the existing site build

The seed uses the existing generated `data/ulan-import.json`; it does not use
the browser frontend as its source.

Expected Vercel build log lines:

    Source records: ...
    Artist records accepted: ...
    Supabase seed complete.
    Database artists: ...
    Database relationships: ...
    The live website has NOT been switched to Supabase yet.

After the database contents are verified, the next revision should remove
`db:seed` from the deployment build and make ingestion an explicit background/
administrative process rather than something that runs on every deploy.
