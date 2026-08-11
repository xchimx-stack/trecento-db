-- v0.20.8 one-time cleanup of known malformed/non-artist admissions.
-- Safe/auditable: rows are retained but excluded from the graph.
update artists
set review_status = 'rejected_non_artist',
    manual_tier = null,
    manual_override_note = coalesce(manual_override_note || E'\n','') || 'v0.20.8 cleanup: year/date article admitted as artist'
where trim(canonical_name) ~ '^(12|13|14)[0-9]{2}$'
  and coalesce(review_status,'') not like 'rejected%';

update artists
set review_status = 'rejected_malformed_name',
    manual_tier = null,
    manual_override_note = coalesce(manual_override_note || E'\n','') || 'v0.20.8 cleanup: malformed leading-comma duplicate/name'
where canonical_name ~ '^\\s*,'
  and coalesce(review_status,'') not like 'rejected%';
