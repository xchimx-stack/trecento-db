# Trecento Network v0.12.3.2 — touching parallel evidence lines

Source evidence is now visualized directly rather than through a mutually
exclusive source filter.

## Evidence-source controls

The upper-right legend uses independent checkboxes:

- ULAN
- Wikipedia

This permits all four states:
- both on
- ULAN only
- Wikipedia only
- both off

The architecture already accommodates RKD as a third checkbox/source later.

## Touching source stripes

A relationship supported by multiple enabled sources is drawn as parallel
source-colored strokes with **no visible gap** between them.

Current colors:
- ULAN — burgundy `#7A3038`
- Wikipedia — light blue `#6E9DB5`
- RKD — gold `#A47B32` reserved

Each stripe is 1.8px wide and adjacent stripe centers are exactly 1.8px apart.
That causes the painted strokes to touch edge-to-edge.

Examples:
- one source: one centered 1.8px line
- two sources: two touching lines centered at -0.9px / +0.9px
- three sources: three touching lines centered at -1.8px / 0 / +1.8px

If one source is switched off, the remaining source stripe automatically
recenters on the original relationship path.

Relationship pattern remains independent:
- solid = pupil/workshop
- dashed = collaboration/direct influence
- dotted = family/general influence

Thus pattern communicates meaning while touching color stripes communicate
independent evidence sources.
