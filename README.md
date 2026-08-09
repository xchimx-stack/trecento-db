# Trecento Network v0.13.2 — Core / Expanded Trecento UI

This release turns network scope into an explicit visualization layer.

## Core Trecento

Default view. Connected artists remain in the relational network.

## Expanded Trecento

Adds credible zero-edge artists that can be placed responsibly. An island is
eligible for the map only when the database has:

- a usable representative chronology, and
- an explicit or curated artistic region.

Zero-edge records without either field remain in the database but are withheld
from the graph.

The Core/Expanded transition is deliberately quick. Expanded nodes pop into
place with a short stagger while the Core cloud moves outward to its
pre-computed Expanded layout; toggling back reverses the movement.

## Unmapped artists

The Unmapped panel lists accepted database identities that cannot yet be placed
responsibly. It explains whether chronology and/or region are unresolved and
surfaces Wikipedia, Wikidata, and ULAN links when available.

## Drawer navigation and provenance

Connection rows now:

- identify their evidence source(s), including ULAN and Wikipedia
- use the same source colors as graph edges
- are clickable, selecting and centering the connected artist

## UI cleanup

The Method block and Database Status control have been removed from the normal
interface. Developer validation remains available in the browser console and
API status endpoint.
