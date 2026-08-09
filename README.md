# Trecento Network v0.11.0 — single-image cache + 50% storage ceiling

## Drawer media

The drawer now displays exactly one representative image.

- requested at ~900px maximum source size
- displayed at the source aspect ratio
- `object-fit: contain`
- no forced crop
- drawer can grow vertically for portrait/tall works

## Wikimedia request control

Artist media enrichment now:
- serializes enrichment work inside a warm serverless runtime
- uses a short browser debounce and aborts obsolete drawer requests
- honors Wikimedia HTTP 429 `Retry-After`
- applies exponential backoff if no Retry-After value is supplied
- drastically reduces query count
- asks Wikipedia for only the lead representative image
- serves fully cached artists without contacting Wikimedia

## Supabase Storage

The first successful representative thumbnail is copied into the public
`artist-thumbnails` Supabase Storage bucket.

Later drawer opens load the image from Supabase, not Wikimedia.

The server stores only presentation-sized thumbnails, not original-resolution
museum/Commons files.

## Hard media storage ceiling

Media caching is hard-capped at **50% of configured Supabase Storage capacity**.

Default capacity assumption:
- 1 GiB project storage
- media limit = 512 MiB

If the Supabase plan changes, set:

`SUPABASE_STORAGE_CAPACITY_BYTES`

in Vercel to the project's actual storage allowance. The 50% fraction remains fixed.

Once the bucket reaches the media limit:
- no new thumbnails are stored
- existing cached thumbnails continue to work
- artist / relationship / text database expansion may continue

This deliberately separates graph growth from media-storage growth.
