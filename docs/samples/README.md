# Sample CSV exports

`sample-export.csv` is fully synthetic. `pnpm sample:generate` writes it from
`src/lib/import/sample-export.ts` (fixed seed): three months (July to September 2025), invented
merchants, amounts and references, in the same bank format as a real export. Do not edit it by hand:
change the generator and regenerate. `src/lib/import/sample-export.test.ts` fails if the file and the
script disagree.

It is one example of an export, not the only format franC reads: every import goes through the
column mapping step (`src/lib/import/mapping.ts`). `src/lib/import/golden.test.ts` guards that this
file still imports to the same rows and dedupe hashes.

Columns (ASCII, so Windows-1252 and UTF-8 read the same; `;`-delimited, `DD/MM/YYYY` dates, comma decimal separator):

```
Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;
Informations complementaires;Type operation;Categorie;Sous categorie;
Debit;Credit;Date operation;Date de valeur;Pointage operation
```

Amount is split across `Debit` (negative) / `Credit` (positive) rather than
a single signed column: the mapping's "Debit and credit" amount handles it.
