# Trecento Network v0.13.0.4 — hard collision layout

The elastic v0.13.0 layout expanded the graph correctly, but its collision
handling remained too soft. Spring forces could pull nodes back into overlap.

This release changes overlap prevention from a preference to a post-layout
constraint.

## Layout phases

1. Elastic organization
   - connection springs establish local clustering
   - chronology remains a strong vertical anchor
   - geography remains weak horizontal gravity

2. Hard collision resolution
   - runs AFTER spring layout
   - minimum circle-boundary clearance target: 24px
   - label footprints are protected as geometry
   - up to 220 collision-resolution passes
   - resolution strongly favors horizontal expansion

3. Safe chronology restoration
   - nodes move gently back toward their year anchor only when the move does not
     recreate a circle or label collision

4. Dynamic world bounds
   - SVG expands to fit the resolved node/label cloud
   - nodes are never shrunk just to preserve the old viewport

The goal is no visible node overlap even as the network approaches 250 artists.
