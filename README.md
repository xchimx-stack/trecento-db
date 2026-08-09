# Trecento Network v0.13.0.1 — graph bootstrap fix

v0.13.0 introduced the elastic layout but omitted the frontend relationship
array declaration during the layout refactor.

The browser therefore failed during graph materialization with:

`relationships is not defined`

This release restores the dedicated frontend relationship array:

`const relationships = [];`

No Supabase data, crawler results, discovery records, relationship evidence, or
expansion data are changed by this patch. It is a frontend bootstrap correction
only.

The v0.13.0 elastic layout and controlled expansion functionality remain intact.
