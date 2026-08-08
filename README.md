# Trecento Network v0.7.7 — compact Florence-centered geography

Data ingestion and relationship validation are unchanged from v0.7.6.

## Geographic order
South / Rome / Pisa -> Siena -> Florence -> Bologna -> Rimini -> Veneto

Siena and Florence are deliberately flipped from the previous build so the
larger Florentine network occupies the visual center of the populated graph.

## Regional whitespace
Regional boundaries now receive only 18px of additional territory separation.
A post-layout compaction pass removes any larger empty horizontal corridor
between adjacent regional territories.

Node and label collision clearance remains unchanged, so regions can flow
together without allowing nodes to overlap.

## Startup
The graph still opens centered on Giotto.
