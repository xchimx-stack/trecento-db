# Trecento Network v0.9.1 — normalized DB cloud

This build repairs the initial Supabase migration and makes the database the only historical-data source used by the browser.

- hard-coded prototype artist and relationship arrays are empty
- duplicate Giotto/Orcagna nodes are eliminated
- NULL dates are never converted to year 0
- one-time DB normalization fetches each still-unreviewed ULAN record and stores layout year/region in Supabase
- after normalization, future builds print `no unreviewed rows; nothing to crawl`
- layout uses soft geographic gravity + relationship attraction + label collision avoidance, producing a cloud rather than regional columns
- Florence is the geographic center, Siena immediately west, Bologna/Rimini/Veneto east
