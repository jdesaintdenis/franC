# Sample CSV exports

`sample-export.csv` is fully synthetic. `pnpm sample:generate` writes it from
`src/lib/import/sample-export.ts` (fixed seed): three months (July to September 2025), invented
merchants, amounts and references, in the same bank format as a real export. Do not edit it by hand:
change the generator and regenerate. `src/lib/import/sample-export.test.ts` fails if the file and the
script disagree.

Columns (ASCII, so Windows-1252 and UTF-8 read the same; `;`-delimited, `DD/MM/YYYY` dates, comma decimal separator):

```
Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;
Informations complementaires;Type operation;Categorie;Sous categorie;
Debit;Credit;Date operation;Date de valeur;Pointage operation
```

Amount is split across `Debit` (negative) / `Credit` (positive) rather than
a single signed column — the Slice 3 parser needs to account for that. This
is the source of truth for CSV parsing (Slice 3): columns, delimiter, and
date/number format should all be taken from here.
