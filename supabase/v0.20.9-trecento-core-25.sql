-- v0.20.9 — persist the curated 25-artist Trecento Core.
-- Safe to run more than once.
-- Comprehensive-only records are preserved as Comprehensive.

begin;

-- First move the old broad Trecento Core into Expanded. Low Countries records
-- are outside this chronology window, so this does not affect that network.
update public.artists
set manual_tier = 'expanded'
where coalesce(manual_tier, '') <> 'comprehensive'
  and coalesce(layout_year, floruit_start, birth_year) between 1250 and 1450
  and coalesce(review_status, '') not in ('rejected_non_artist','merged','rejected');

-- Curated Core: 25 explanatory anchors across Florence, Siena, Rome, Rimini,
-- Venice/Veneto and the northern transition. Name variants are included where
-- the database may use a fuller canonical form.
update public.artists
set manual_tier = 'core'
where lower(trim(canonical_name)) in (
  'cimabue',
  'giotto', 'giotto di bondone',
  'bernardo daddi',
  'taddeo gaddi',
  'agnolo gaddi',
  'andrea di cione', 'orcagna', 'andrea di cione (orcagna)',
  'jacopo di cione',
  'andrea di bonaiuto', 'andrea bonaiuti',
  'niccolò di pietro gerini', 'niccolo di pietro gerini',
  'mariotto di nardo',
  'lorenzo monaco',
  'lorenzo di bicci',
  'bicci di lorenzo',
  'duccio', 'duccio di buonisegna', 'duccio di buoninsegna',
  'simone martini',
  'pietro lorenzetti',
  'ambrogio lorenzetti',
  'lippo memmi',
  'bartolo di fredi',
  'andrea di bartolo',
  'taddeo di bartolo',
  'pietro cavallini',
  'giovanni baronzio',
  'altichiero', 'altichiero da zevio',
  'paolo veneziano'
)
  and coalesce(review_status, '') not in ('rejected_non_artist','merged','rejected');

commit;

-- Verification: should return 25 logical Core artists (variants should not
-- normally coexist as separate accepted records).
select canonical_name, manual_tier, layout_year, region
from public.artists
where manual_tier = 'core'
  and coalesce(layout_year, floruit_start, birth_year) between 1250 and 1450
order by canonical_name;
