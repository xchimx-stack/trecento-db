# Trecento Network v0.12.2 — connection-source rendering fix

The database remains at 127 artists after the first controlled one-hop expansion.

## Source rendering

Relationship *pattern* continues to represent meaning:
- solid = pupil/workshop
- dashed = collaborator/direct influence
- dotted = family/general influence

Relationship *color* now represents evidence source:
- ULAN = burgundy `#7A3038`
- Wikipedia = light muted blue `#6E9DB5`
- RKD = gold `#A47B32` reserved for the future Dutch implementation

Every relationship line is explicitly assigned a source color. Grey is no longer
used for graph relationships. Chronology guides remain light grey.

Arrowheads inherit the same source color as their line.

## Source controls

The source key and filters now live in the existing upper-right legend.

Filters:
- All
- ULAN
- Wikipedia

Changing a filter re-renders the native SVG graph and actually omits relationships
whose evidence does not include the selected source.

If an edge eventually has both ULAN and Wikipedia evidence:
- it appears under either source filter
- in All mode it displays using the highest-priority source color (ULAN)
