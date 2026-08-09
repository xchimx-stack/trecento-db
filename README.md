# Trecento Network v0.11.3 — color-aware representative artwork

## Drawer diagnostic

The temporary resolver diagnostic is renamed to:

`Wikipedia match confidence score: N`

The number remains Trecento Network's own match-confidence score, not a score supplied by Wikipedia.

## Representative image selection

After a Wikipedia article is matched:

1. Retrieve a bounded list of up to 12 article images through the browser-side
   Wikipedia Action API.
2. Ignore obvious logos, maps, signatures, flags, and similar non-artwork assets.
3. Inspect at most the first 8 usable thumbnails.
4. Downsample each candidate in-browser and measure pixel saturation.
5. Choose the first image with meaningful color.
6. If no color image qualifies, fall back to Wikipedia's normal lead image.

This is intended to prefer a color reproduction of an artist's work over a
black-and-white Vasari portrait/engraving when both are present.

Exactly one image is displayed, uncropped and at its natural proportions.
Successful media metadata is still cached in Supabase.
