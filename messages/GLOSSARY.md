# French glossary

Every French string must use these terms. Keys for the most common ones live in `common.json` under `glossary`.

| English | French |
| --- | --- |
| transaction | opération |
| transactions list (nav, page) | Opérations |
| import (noun) / to import | import / importer |
| category | catégorie |
| subcategory | sous-catégorie |
| rule | règle |
| recurring payment | paiement récurrent (nav: Récurrents) |
| forecast | prévision |
| dashboard / home | Accueil |
| settings | Paramètres |
| Plan (nav tab, page) | Budget |
| More (nav tab, page) | Plus |
| income | revenus |
| spent | dépenses |
| net (month) | bilan |
| backup (database) | sauvegarde |
| balance (of an account) | solde |
| projected balance | solde prévu |
| starting balance | solde de départ |
| your bank's balance | solde de votre banque |
| gap with the bank | écart avec la banque |
| Accept the bank's balance | Accepter le solde de la banque |
| Import a CSV for those dates | Importer un CSV pour ces dates |
| sync (bank) | synchronisation |
| lowest point | point bas |
| overdraft | découvert |
| account | compte |
| All accounts | Tous les comptes |
| sign in | Se connecter |
| sign out | Se déconnecter |
| sign up | Créer un compte |
| undo | annuler |
| review (verb) / to review / reviewed | valider / à valider / validé |
| mark as reviewed | marquer comme validé |
| All caught up | Tout est validé |
| duplicate | doublon |
| uncategorized | non catégorisée |
| bank category | catégorie de la banque |
| guess (noun) / guessed | proposition / proposée |
| guessed category | catégorie proposée |
| accept (a guess) | accepter |
| suggested rule | règle suggérée |
| map to | associer à |
| forget | oublier |
| internal transfer | virement interne |
| link (a transfer) | lier |
| unlink | dissocier |
| merchant | commerçant |
| merchant name | nom du commerçant |
| rename | renommer |
| bank label | libellé de la banque |
| contains / starts with / is exactly | contient / commence par / est exactement |
| budget | budget |
| over budget | budget dépassé |
| left (remaining) | restant |
| split (verb) | répartir |
| split transaction | opération répartie |
| part (of a split) | part |
| left to assign | reste à répartir |
| icon (of a category) | icône |
| remove the icon | retirer l'icône |
| emoji | emoji |
| savings goal / goals (nav) | objectif d'épargne / Objectifs |
| goal reached | objectif atteint |
| on track / behind by X | en bonne voie / en retard de X |
| past target date | date dépassée |
| add money / take out | ajouter de l'argent / retirer |
| progress from | progression depuis |
| price increase | hausse de prix |
| accept new price | accepter le nouveau prix |
| usual amount | montant habituel |
| Price up (pill) | Prix en hausse |
| recurring payment | paiement récurrent |
| export (noun) / to export | export / exporter |
| theme / system / light / dark | thème / système / clair / sombre |
| safe to spend | reste à vivre |
| import reminder | rappel d'import |
| bills still due | factures à venir |
| expected income | revenus attendus |
| budgets left | reste des budgets |
| roll over (budget) | reporter le reste |
| carried over | reporté |
| overspending carried over | dépassement reporté |
| on pace to go over | dépassement prévu à ce rythme |
| last month / 3-month average | mois dernier / moyenne sur 3 mois |
| put aside (per month) | mettre de côté |
| cost per year / X a year | coût annuel / X par an |
| Cancelled? (pill) | Résilié ? |
| mark ended / ended (recurring) | marquer comme terminé / terminé |
| track (a regular payment) / tracked | suivre / suivi |
| still active | toujours actif |
| resume | reprendre |
| regular payments (page title) | Paiements récurrents |
| bills and subscriptions | factures et abonnements |
| To confirm (pill) | À confirmer |
| Price up (pill) | Hausse de prix |
| dismiss (a regular payment) / Dismissed | ignorer / Ignorés |
| ignore (set a transaction aside) / Ignored | écarter / Écartée ("ignorer" is for regular payments) |
| Stop ignoring | Ne plus écarter |
| restore | restaurer |
| Confirm all | Tout confirmer |
| found automatically | trouvé automatiquement |
| charge (of a recurring payment) | prélèvement |
| tag / add a tag / remove the tag | étiquette / ajouter une étiquette / retirer l'étiquette |
| All tags | Toutes les étiquettes |
| note (on a transaction) | note |
| Spent X · Received Y | Dépensé X · Reçu Y |
| year in review | Rétrospective de l'année |
| savings rate | taux d'épargne |
| saved (income − spent) | épargné |
| monthly average | moyenne mensuelle |
| Where the money went | Où est passé l'argent |
| From your balance | Pris sur le solde |
| Other / Other income | Autres / Autres revenus |
| See the year | Voir l'année |
| current account | compte courant |
| savings account | compte épargne |
| move to savings | mettre en épargne |
| saved (Home total) | épargné |

## Style

- Natural French. Address the user with "vous" and imperative forms ("Importez un fichier"). Never "tu".
- No special non-breaking spaces before `: ; ! ?`; use plain spaces.
- Apostrophe: plain `'` everywhere, never the typographic one.
- Plurals use ICU: `{count, plural, one {# opération} other {# opérations}}`. In French, `one` covers 0 and 1.
- Every key must exist in both `en` and `fr` with the same ICU arguments (`src/i18n/messages.test.ts` enforces it).
