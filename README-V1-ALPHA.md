# 1.0 alpha 1 — parallel architecture reset

This package retains the existing 0.20.20 public site unchanged and adds a parallel generic network engine.

## Install

1. Deploy the package normally.
2. In Supabase SQL Editor, run `supabase/v1.0-alpha1-generic-network-engine.sql` once.
3. Open `/admin-v1.html`.
4. Enter the existing admin/crawl token.
5. Create a test network and add Core artists.

Do not replace `/index.html` with `/v1.html`; the latter is only a data-contract validation page in this alpha.

See `docs/V1-ARCHITECTURE.md` for the design contract and acceptance criteria.
