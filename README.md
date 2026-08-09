# Trecento Network v0.12.6.1 — Wikipedia section/list-context parser

This release fixes a structural blind spot in the bilingual Wikipedia
relationship crawler.

## Problem

Some Wikipedia articles express relationships through section structure rather
than repeating the relationship in each list item.

Example:

- heading: `Pupils`
- lead-in: `Among Orcagna's pupils and legacy were:`
- list item: `Jacopo di Cione, brother of Andrea...`

The old crawler inspected each paragraph/list item independently, so Jacopo's
list item did not contain the words `pupil of` and no edge was proposed.

## New behavior

The crawler now understands bounded section/list context.

Recognized English contexts include:
- Pupil / Pupils
- Student / Students
- Disciple / Disciples
- Collaborator / Collaborators
- Collaboration
- Workshop

Recognized Italian contexts include:
- Allievo / Allievi
- Discepolo / Discepoli
- Collaboratore / Collaboratori
- Collaborazione / Collaborazioni
- Bottega

A relationship-bearing heading or short lead-in can establish context for the
nearby list that follows.

The linked artists in those list items are then proposed using that inherited
relationship type.

## Safeguards retained

- identity disambiguation remains active
- chronology guard remains active
- ULAN remains authoritative
- Wikipedia does not override conflicting ULAN relationships
- mere links and co-mentions still do not create edges
- inherited context is bounded and stops at the next heading / after the
  relationship-bearing list

After deploying this version, rerun `/wiki-crawl.html` once. Existing evidence
is deduplicated; newly discovered section/list relationships are added to
Supabase.
