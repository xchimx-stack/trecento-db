# Supabase seed step

This build does **not** change the live site's data source.

It adds `npm run db:seed`, which copies the existing generated ULAN dataset
from `data/ulan-import.json` into the Supabase schema.

Required environment variables:

- `SUPABASE_URL` — project base URL, e.g. `https://xxxx.supabase.co`
- `SUPABASE_SECRET_KEY` — the `sb_secret_...` server key

Never commit the secret key to GitHub.

The seeder:
- does not crawl Getty;
- filters corporate-body records;
- rejects obvious prose-contaminated names;
- upserts artists by ULAN ID;
- stores ULAN external IDs;
- imports explicit relationships present in the current JSON;
- leaves the live frontend unchanged until the database contents are verified.
