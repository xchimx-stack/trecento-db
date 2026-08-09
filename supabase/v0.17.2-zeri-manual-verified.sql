
alter table public.zeri_associations
  drop constraint if exists zeri_associations_identity_basis_check;

alter table public.zeri_associations
  add constraint zeri_associations_identity_basis_check
  check (identity_basis in ('ULAN','VIAF','MANUAL_VERIFIED'));
