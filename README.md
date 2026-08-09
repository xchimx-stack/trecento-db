# Trecento Network v0.10.1.1 — ULAN preferred names

This revision replaces heuristic name cleanup with a deterministic ULAN naming policy.

## Canonical naming rule

For every ULAN-backed artist:

**`artists.canonical_name` = the ULAN name explicitly marked `preferred`.**

Display variants, inverted forms, language variants, and other non-preferred ULAN
names are stored in `artist_aliases` for search.

The graph therefore uses ULAN's authority-file preference rather than whichever
name happens to appear in a relationship line or record heading.

## One-time normalization

On the first deployment, all existing ULAN artists in Supabase are checked—not only
obviously malformed records.

The job:
- fetches each ULAN Full Record
- parses the `Names:` section
- selects the entry marked `preferred`
- updates `artists.canonical_name`
- stores the remaining clean names in `artist_aliases`
- records completion in `crawl_runs`

Future ULAN imports use the same preferred-name rule.
