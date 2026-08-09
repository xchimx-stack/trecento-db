# Trecento Network v0.12.4 — Wikipedia chronology guard

This release adds chronological sanity checks to secondary-source relationship
parsing and cleans up already-created Wikipedia candidate edges.

## New Wikipedia rules

### Pupil / student / workshop / teacher / master

The normalized relationship is expected to run teacher/master -> pupil/student.

Reject automatically when:
- the proposed pupil substantially predates the teacher (>10 years), or
- the teacher/pupil layout-date gap exceeds 50 years

### Collaboration / worked with

Reject when the artists' layout dates differ by more than 50 years.

### Influence

No 50-year restriction is applied. A much later artist may legitimately be
influenced by Giotto or another long-dead predecessor.

### Family

No blanket 50-year rule is applied to family relationships.

## ULAN protection

Chronology checks do not override ULAN.

If an edge has ULAN evidence, approximate dates are never used to suppress it.
The automatic cleanup only rejects **Wikipedia-only candidate edges**.

## Existing database cleanup

On first deployment, all existing Wikipedia-only candidate edges are reviewed
using the same chronology rules.

Implausible edges are not deleted. They are changed to:

`review_status = rejected_chronology`

Their Wikipedia evidence is retained and marked the same way.

Rejected edges remain available for audit/history but are excluded from the graph.

This should remove false relationships such as a 15th-century artist being shown
as a pupil/workshop predecessor of Giotto.
