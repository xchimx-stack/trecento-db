
# Hidden Low Countries network plan — v0.18.0

Status: staging only; not public and not included in the Trecento graph payload.

Targets:
- Core: 100 artists
- Expanded: 300 artists
- Initial seed queue: 29 geographically/connectively diverse artists
- Scope: Dutch Republic + Southern Netherlands/Flanders, broadly c. 1580–1720
- No guild-membership edges.

Crawl policy:
1. Resolve seed identity against ULAN before crawling.
2. Crawl ULAN one hop into a candidate pool; do not auto-admit.
3. Preserve relationship direction and source evidence.
4. Capture geography immediately for layout planning.
5. Candidate scoring should favor repeated connections to admitted/seed artists, strong teacher/pupil/workshop/collaboration relationships, and chronological/geographic fit.
6. Major hubs (especially Rembrandt and Rubens) must not be allowed to dominate admission merely by degree.
7. Stop Core admission at 100; overflow qualifying candidates remain candidates for Expanded.
8. Stop Expanded admission at 300 unless targets are deliberately changed.
9. RKD integration is deferred until its current machine-access mechanism is verified. Do not repeat the Zeri scraping approach.

Layout plan:
- Separate Low Countries graph session/payload from Trecento.
- Geography primarily drives x; chronology primarily drives y.
- Broad x order: Southern Netherlands/Antwerp -> Brabant/Zeeland -> Holland -> Utrecht -> eastern/northern centers.
- City bands receive adaptive width based on local node density.
- No guild edges, shared-city edges, or other high-density/low-information links.
- Low-information labels/edges should be culled or simplified at low zoom/mobile.
