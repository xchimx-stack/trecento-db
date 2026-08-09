# Trecento Network v0.14.2 — resolver correction

v0.14.1 incorrectly labeled external lookup failures as "no basis — exclude".
That report is invalid and should not be used for admission decisions.

v0.14.2:

- identifies artists already present in Supabase before external discovery
- uses the proven client-side MediaWiki `list=search` resolver from the earlier
  working relationship crawler
- searches Italian Wikipedia first, then English
- supports natural-order names and Master/Maestro title variants
- follows Wikipedia pageprops to Wikidata and Wikidata P245 to ULAN
- uses Zeri only as a fallback basis
- never equates a failed automated lookup with historical nonexistence
- unresolved candidates are explicitly marked `UNRESOLVED — manual review`
- remains report-only and makes no database changes

The candidate seed list itself still has zero authority weight.
<!-- deployment trigger -->
