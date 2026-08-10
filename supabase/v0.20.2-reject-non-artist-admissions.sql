-- v0.20.2 cleanup for institutional records accidentally admitted as artists.
-- Safe: records are retained for audit but excluded from graph queries via review_status.
update artists
set review_status = 'rejected_non_artist',
    default_visible = false,
    manual_tier = null,
    manual_override_note = coalesce(manual_override_note || ' | ', '') || 'v0.20.2: rejected institutional/non-artist admission'
where lower(canonical_name) in ('galleria dell''accademia');
