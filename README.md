# Trecento Network v0.11.1 — browser-side Wikipedia resolution

Wikimedia was returning HTTP 429 to Vercel's server-side IP even after request
reduction and backoff. This version removes all Wikimedia requests from the
Vercel artist-media function.

## Flow

1. `/api/artist-media` reads Supabase cache only.
2. On a cache miss, the user's browser makes one direct Wikipedia REST-summary
   request at a time.
3. English and Italian are supported.
4. `Master of ...` is transformed to `Maestro di/del ...` for Italian.
5. A successful Wikipedia URL and thumbnail URL are saved back to Supabase via
   `/api/cache-artist-media`.
6. Subsequent drawer opens use the cached metadata.

The server no longer calls Wikidata, Wikipedia, or Commons from `/api/artist-media`,
so Vercel-side Wikimedia 429s should disappear.

## Node warning

The Vercel `[DEP0169] url.parse()` message is a Node dependency deprecation warning,
not a build/runtime failure. This application code uses the WHATWG `URL` constructor;
the warning originates in a dependency and can be addressed separately during a
dependency upgrade.

## Media

The drawer uses one proportional thumbnail with no cropping.

The 50% Supabase Storage ceiling remains the policy for later controlled background
media caching. This live browser path stores the remote thumbnail URL only and does
not consume Supabase Storage capacity.
