# ADR-0034 — Dépenses, trésorerie réelle et rapprochement au prévisionnel

Statut : Proposed
Date : 2026-10-21
Décideurs : Gracy Omokoso (dirigeante) ; CTO Lalanda (contrat technique). Les points
comptables et fiscaux sont soumis à l'expert-comptable de la dirigeante (§ Décisions
ouvertes).

> **Deuxième module RUN** d'[ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md)
> (« Dépenses et trésorerie réelle — rapprochement de la trésorerie réelle avec le
> prévisionnel. C'est la valeur propre de Lalanda »). **Amende
> [ADR-0012](ADR-0012-modele-rbac-complet.md)** : deux actions, `treasury.read` et
> `treasury.manage`. Applique la règle d'ADR-0018 : « RUN alimente le réalisé, jamais
> le plan figé ». S'aligne sur [ADR-0031](ADR-0031-encaissements-et-realise.md)
> (encaissements, livré en parallèle) pour le pont vers le réalisé.

## Contexte

Le module Ventes émet des factures (ADR-0023) ; ADR-0031 enregistre l'argent reçu. Rien
n'enregistre l'argent **dépensé**, ni **où** est l'argent (caisse, banque, mobile money),
ni ce qu'il en restera dans 7, 30, 90 ou 180 jours. Le plan financier BUILD, lui, prévoit
des charges et une trésorerie (docs/07) ; le réalisé (`actual_periods`, docs/08) se saisit
aujourd'hui à la main, agrégé par mois. Le brief stratégique (§ 5.3 et § 5.5, réflexion
préparée avec un autre assistant, pas un cahier des charges — ADR-0018) demande : dépenses,
caisse, comptes bancaires, multi-devises, charges récurrentes, rapprochements, et des
prévisions de trésorerie à 7 jours, 30 jours, 90 jours et 6 mois exploitant soldes,
échéances, charges et historique, en trois scénarios à hypothèses explicites, avec alertes
de tension et incertitude.

### Ce que les documents disent déjà (sources de cet ADR)

| Règle | Source |
|---|---|
| RUN agrège vers `actual_periods` ; aucun module RUN n'écrit dans un plan ; pas de comptabilité générale certifiée | ADR-0018 § Règles transverses |
| Chaque module fonctionne seul ; hypothèses, prévisions, réalisés et suggestions de l'IA restent distincts et étiquetés | ADR-0018 § Amendement du 18 oct. |
| Chaque donnée réalisée conserve source, auteur, date, pièce éventuelle, devise, taux de conversion, catégorie | docs/08 § Saisie et import |
| Le mapping relie une catégorie réalisée à une ligne du plan ; les éléments non mappés restent dans une file de traitement | docs/08 § Rapprochement |
| Écart : prévu, réalisé, écart absolu, écart relatif si base non nulle ; une charge inférieure au prévu est favorable | docs/08 § Écarts |
| Alertes : trésorerie sous le minimum ; gravité, preuve, période, cause probable | docs/08 § Alertes |
| Toute projection distingue clairement observation et estimation | docs/08 § Critères d'acceptation |
| Ne jamais fabriquer un chiffre : un écart impossible se dit, il ne se comble pas | docs/08 § Règle cardinale |
| Saisie du réalisé bornée aux lignes monétaires du compte d'exploitation (`activite`) du plan validé courant ; prévu mensuel = base annuelle ÷ 12 | docs/08 § Conventions MVP, 2 à 4 |
| Les dates d'encaissement et de décaissement déterminent la trésorerie ; un flux s'additionne, un stock se reporte, le solde final devient l'ouverture suivante | docs/21 § Périodes |
| Le moteur est l'unique source des calculs | CLAUDE.md, docs/21 |
| Pont RUN → réalisé : désactivé par défaut, projet + mois civil d'ouverture de l'exercice 1 choisis par l'utilisateur, idempotent, jamais sur une période clôturée ni sur une saisie manuelle, étiquette `sources[ligne]` | ADR-0031 § 3 |
| Devise : aucun taux appliqué ; un mois contenant un document non convertible n'est pas reporté (`CURRENCY_NOT_CONVERTIBLE`) | ADR-0031 § 3 |
| Mois civil de Kinshasa (UTC+1) | ADR-0027 |
| Fichier téléversé : type déduit du contenu, liste blanche PNG/JPEG/WebP, octets reconstruits, clé tirée au hasard | `account/image-validation.ts`, `storage/object-key.ts` (S22j) |

Ce qui **n'est pas** sourcé (charge HT ou TTC, TVA déductible, change, valeurs par défaut des
scénarios, fiche fournisseur, justificatif PDF) est listé en décisions ouvertes ; quand le
logiciel doit pourtant se comporter d'une façon, il prend la **plus prudente** et le dit à
l'écran.

## Options considérées

### O1 — Où se calculent soldes, agrégats, rapprochement et prévision

1. Dans l'API. Écarté (CLAUDE.md).
2. **Module pur `packages/engine/src/treasury/`**, sans horloge ni base, arithmétique exacte
   en centimes entiers (`bigint`), montants échangés en chaînes décimales signées. **Retenu.**

### O2 — Catégories de dépense

1. Catégories libres. Écarté : impossibles à rattacher au plan et à comparer d'une
   organisation à l'autre.
2. Les lignes du plan comme catégories. Écarté : le compte d'exploitation des modèles est
   agrégé (`charges_operationnelles` regroupe personnel, loyer et divers) et diffère d'un
   modèle à l'autre ; une organisation sans plan (RUN seul) n'aurait aucune catégorie.
3. **Liste fermée de quatorze postes alignés sur les hypothèses des modèles BUILD**
   (`personnel_mois`, `loyer_mois`, `marketing_mois`, `outils_logiciels_mois`,
   `transport_stock_mois`, `charges_diverses_mois`, achats variables, impôt sur les
   bénéfices, investissements, emprunt…), et une **table de correspondance choisie par
   l'utilisateur** catégorie → ligne de charge du plan. **Retenu** (docs/08 § Rapprochement).

### O3 — Récurrences

1. Créer automatiquement les dépenses à l'échéance. Écarté : une dépense prévue n'est pas
   payée ; le réalisé serait fabriqué.
2. **La règle récurrente prévoit ; l'utilisateur confirme chaque occurrence**, qui devient
   alors une dépense ordinaire liée à `(règle, date d'occurrence)` (index unique : confirmer
   deux fois ne crée qu'une dépense). Les occurrences futures alimentent la prévision ; les
   occurrences passées non confirmées sont listées « à confirmer ». **Retenu.**

### O4 — Permissions

1. Réutiliser `actuals.import` / `analytics.read`. Écarté : le Conseiller (externe) lirait le
   détail des dépenses et des fournisseurs ; l'Administrateur saisirait des décaissements.
2. Réutiliser `sales.*`. Écarté : les dépenses ne sont pas des ventes.
3. **Deux actions `treasury.read` et `treasury.manage`.** **Retenu.**

## Décision

### 1. Catégories (`EXPENSE_CATEGORIES`, moteur)

| Code | Libellé | Nature |
|---|---|---|
| `achats` | Achats de marchandises et matières | exploitation |
| `personnel` | Salaires et charges sociales | exploitation |
| `loyer` | Loyer et charges locatives | exploitation |
| `transport` | Transport et logistique | exploitation |
| `marketing` | Marketing et publicité | exploitation |
| `outils_logiciels` | Outils, logiciels et abonnements | exploitation |
| `energie_telecom` | Énergie, eau et télécommunications | exploitation |
| `services_exterieurs` | Honoraires et services extérieurs | exploitation |
| `impots_taxes` | Impôts et taxes (hors impôt sur les bénéfices) | exploitation |
| `impot_benefices` | Impôt sur les bénéfices | exploitation |
| `frais_financiers` | Frais bancaires et intérêts | exploitation |
| `charges_diverses` | Charges diverses | exploitation |
| `investissement` | Investissements (immobilisations) | investissement |
| `remboursement_emprunt` | Remboursement du capital emprunté | financement |

La nature n'est pas une qualification comptable certifiée (ADR-0018 : pas de comptabilité
générale) ; elle sert seulement à empêcher un rattachement absurde : seules les catégories
d'**exploitation** peuvent être rattachées à une ligne du compte d'exploitation.

### 2. Dépense (`treasury_expenses`)

| Champ | Règle |
|---|---|
| `spentOn` | date civile `AAAA-MM-JJ` (Kinshasa), jamais future (`EXPENSE_IN_FUTURE`) |
| `amount`, `currency` | montant **payé**, chaîne décimale > 0, deux décimales au plus ; `CDF` ou `USD` |
| `category` | l'une des quatorze catégories |
| `label` | libellé, 1 à 200 caractères |
| `supplierName` | fournisseur en **texte simple** (120 car.), facultatif ; l'interface propose les noms déjà saisis |
| `accountId` | compte de trésorerie qui a payé, facultatif ; actif, de la même devise (`EXPENSE_ACCOUNT_CURRENCY_MISMATCH`), dépense postérieure à son ouverture (`EXPENSE_BEFORE_ACCOUNT_OPENING`) |
| `deductibleVat` | TVA déductible **déclarée par l'utilisateur**, facultative, ≤ montant ; **conservée, affichée, jamais utilisée dans un calcul** (décision ouverte n° 1) |
| `reference` | n° de pièce, de reçu ou de transaction, facultatif (100 car.) |
| `attachment` | pièce justificative : image PNG, JPEG ou WebP de 2 Mio au plus, **assainie** par le validateur existant (type déduit du contenu, métadonnées EXIF retirées, octets reconstruits), stockée sous une clé tirée au hasard `expense-receipts/<id>` ; servie seulement par `GET /treasury/expenses/:id/attachment` (`treasury.read`, en-têtes inertes) |
| `recurrence` | `{ recurringExpenseId, occurrenceDate }` si la dépense confirme une occurrence |
| `status` | `recorded` ou `cancelled` (motif obligatoire, jamais d'effacement) |

Toute écriture est journalisée (`audit_events` : `treasury.expense.recorded|updated|cancelled`,
`treasury.account.*`, `treasury.transfer.*`, `treasury.actuals.synced`). Modifier exige la
révision attendue (`STALE_REVISION`).

### 3. Dépenses récurrentes (`treasury_recurring_expenses`)

Libellé, montant, devise, catégorie, fournisseur, compte facultatif, fréquence
(`weekly`, `monthly`, `quarterly`, `yearly`), date de début, date de fin facultative,
active ou non. Occurrences (moteur, `occurrencesOf`) : la date de début, puis tous les 7
jours, ou le **même quantième** chaque mois, trimestre ou année, **ramené au dernier jour du
mois** quand il n'existe pas (31 janvier → 28 ou 29 février → 31 mars). Une occurrence
**passée et non confirmée** depuis 90 jours au plus est listée « à confirmer » ;
`POST /treasury/recurring-expenses/:id/occurrences/:date/confirm` crée la dépense
(idempotent). Les montants d'une règle peuvent être corrigés à la confirmation.

### 4. Comptes de trésorerie et mouvements

**Compte** (`treasury_accounts`) : nom, nature (`cash` caisse, `bank` banque,
`mobile_money`), établissement ou opérateur facultatif, devise (**non modifiable**), solde
d'ouverture (décimal signé : un découvert est possible) à une date d'ouverture (non
modifiable), actif ou non.

**Mouvements** — le solde d'un compte à la date `D` est calculé par le moteur
(`computeAccountBalances`) :

```
solde(D) = solde d'ouverture (au début du jour d'ouverture)
         + Σ entrées − Σ sorties datées de [ouverture, D]
```

| Mouvement | Sens | Origine |
|---|---|---|
| Dépense rattachée au compte | sortie | `treasury_expenses` (non annulée) |
| Virement interne | sortie du compte source, entrée du compte cible | `treasury_movements` (`transfer`) |
| Autre entrée hors ventes (apport, prêt reçu…) | entrée | `treasury_movements` (`other_in`) |
| Autre sortie hors dépenses (prélèvement de l'exploitant…) | sortie | `treasury_movements` (`other_out`) |
| Encaissement d'une vente | entrée | **ADR-0031** (`sales_receipts`) — voir ci-dessous |

Un virement entre comptes de **même devise** exige montant sortant = montant entrant
(`TRANSFER_AMOUNTS_DIFFER`) : il ne change pas le total. Entre devises différentes (achat de
dollars), l'utilisateur saisit **les deux montants** constatés ; le logiciel ne calcule ni
taux ni écart de change (décision ouverte n° 3).

**Encaissements (ADR-0031).** Un encaissement n'a pas encore de compte de trésorerie. Le
contrat retenu : l'API lit les encaissements par un **port** (`TREASURY_RECEIPTS_SOURCE`)
qui rend `{ id, accountId | null, receivedOn, amount, currency }`. Tant qu'ADR-0031 n'est
pas fusionné, le port rend une liste vide et la prévision le signale
(`RECEIPTS_NOT_INTEGRATED`). À la fusion : champ facultatif `accountId` sur
`sales_receipts` (même règle de devise) ; un encaissement sans compte reste hors des soldes
et est compté comme incertitude, comme une dépense sans compte.

### 5. Pont vers le réalisé BUILD (dépenses → `actual_periods`)

Mêmes principes qu'ADR-0031 § 3, configuration propre (`treasury_settings.bridge`),
**désactivée par défaut** :

- **projet** de l'organisation et **mois civil d'ouverture de l'exercice 1** (`AAAA-MM`),
  choisis par l'utilisateur ; la période d'une dépense est le mois civil de `spentOn`,
  converti en (exercice, mois) ; hors exercices 1 à 5, elle n'est pas reportée
  (`OUTSIDE_PLAN_HORIZON`) ;
- **table de correspondance** catégorie → ligne : chaque cible est une ligne monétaire du
  compte d'exploitation du plan validé courant (`UNKNOWN_LINE`), **de sens charge**
  (`LINE_NOT_A_CHARGE` : ni produit, ni solde) ; seules les catégories d'exploitation sont
  rattachables (`CATEGORY_NOT_OPERATING`) ; plusieurs catégories peuvent viser la même
  ligne ; une catégorie non rattachée reste dans la **file des non rattachées**, affichée
  avec ses montants (docs/08 § Rapprochement) ;
- **montant reporté = montant payé** (TTC si une TVA a été payée) : choix **prudent**, la
  charge n'est pas minorée (décision ouverte n° 1) ;
- **devise** : une dépense dans la devise du projet est reportée telle quelle ; sinon elle
  n'est pas convertible et la case (ligne, mois) qui la contient n'est **pas** reportée
  (`CURRENCY_NOT_CONVERTIBLE`, dépenses listées) ;
- **écriture** (`POST /treasury/actuals-bridge/sync`, `dryRun` possible) : valeur identique →
  `unchanged` ; période ouverte, ligne vide ou déjà issue des dépenses → `written` avec
  `sources[ligne] = { source: 'run.expenses', at, by, version, documents, fingerprint }` ;
  période clôturée → jamais modifiée (`PERIOD_CLOSED`, écart rendu) ; ligne saisie à la main
  ou alimentée par une autre source RUN (`run.sales`) → jamais écrasée
  (`MANUAL_VALUE_PRESENT`, `OTHER_SOURCE_PRESENT`) ; valeur issue des dépenses devenue sans
  objet sur une période ouverte → retirée (`removed`). Rejouer la synchronisation ne change
  rien ;
- **verrou** : tant que le pont est actif, la saisie manuelle d'une ligne portant
  `run.expenses` est refusée (`409 LINE_FED_BY_RUN`). Une saisie manuelle pose désormais
  `sources[ligne] = { source: 'manual', at, by }` ; une période ancienne sans `sources` est
  lue comme « saisie manuelle d'origine inconnue ».

### 6. Réalisé vs prévu (rapprochement, moteur `reconcileExpenses`)

Pour un exercice du projet relié, et pour chaque ligne visée par la table de
correspondance : par mois, le **prévu** (base annuelle ÷ 12, résolue exactement comme
docs/08 convention 2 — `projection.<ligne>_annuel_N`, ou `activite × 12` pour l'exercice 1 ;
`null` si le plan ne publie pas l'exercice), le **réalisé RUN** (somme exacte des dépenses
rattachées), la **valeur portée par `actual_periods`** et son origine, l'**écart** RUN −
prévu et son statut (charge : sous le prévu = favorable). Total de l'exercice sur les seuls
mois porteurs de dépenses (comparaison à périmètre identique, docs/08 convention 8).

**Écarts expliqués** : contribution de chaque catégorie, trois plus fortes dépenses de la
ligne (pièces), et des **constats** codés : `NOT_SYNCED` (le réalisé porté diffère des
dépenses), `PERIOD_CLOSED`, `MANUAL_VALUE_PRESENT`, `CURRENCY_NOT_CONVERTIBLE`,
`NO_PLAN_BASE`. Jamais de prévu à zéro ni d'écart de −100 % quand le plan n'a pas de base.

**RUN sans BUILD** : la page Dépenses donne les totaux par mois, catégorie et devise sans
projet ni plan ; « Réalisé vs prévu » explique qu'il faut relier un projet validé.

### 7. Prévision de trésorerie (moteur `forecastTreasury`)

Une prévision par **devise** (CDF ou USD, aucune conversion), du lendemain de la date du jour
(Kinshasa) à **180 jours**, rendue jour par jour et résumée aux horizons **7, 30, 90 et 180
jours** (solde de clôture, solde minimal et sa date, entrées, sorties, par origine).

| Composante | Règle | Observation ou estimation |
|---|---|---|
| Solde d'ouverture | Σ des soldes des comptes actifs de la devise au jour J | observation |
| Échéances clients | reste à encaisser des factures finales de la devise ; date attendue = échéance (ou émission + *délai sans échéance*) + *retard du scénario*, au plus tôt J+1 ; montant × *taux d'encaissement* | estimation |
| Dépenses récurrentes | occurrences non confirmées de ]J, J+180] et occurrences en retard (comptées à J+1) × *facteur de dépenses* | estimation |
| Plan BUILD (facultatif) | si le pont relie un projet validé **dans la même devise** : rythme journalier (mensuel × 12 ÷ 365) des lignes de produit × *taux de réalisation des ventes* et des lignes de charge × *facteur de charges*, soldes exclus ; une ligne de charge visée par une catégorie qui a une règle récurrente est **diminuée** de l'équivalent mensuel de ces règles (jamais sous zéro) pour ne pas compter deux fois le loyer | estimation |

**Scénarios** — hypothèses **explicites**, renvoyées avec chaque prévision, modifiables par
`treasury.manage` (`PUT /treasury/settings`). Valeurs par défaut **proposées** (décision
ouverte n° 4) :

| Hypothèse | Optimiste | Probable | Pessimiste |
|---|---:|---:|---:|
| Taux d'encaissement des échéances clients | 100 % | 90 % | 70 % |
| Retard après l'échéance (jours) | 0 | 15 | 45 |
| Délai supposé pour une facture sans échéance (jours après émission) | 30 | 30 | 30 |
| Facteur des dépenses récurrentes | 100 % | 100 % | 110 % |
| Taux de réalisation des ventes du plan | 100 % | 80 % | 60 % |
| Facteur des charges du plan | 100 % | 100 % | 110 % |

**Alerte de tension** (docs/08 § Alertes) : pour chaque scénario, le premier jour où le solde
passe **sous zéro** (`critique`) ou **sous le minimum** fixé par l'organisation pour la devise
(`tension`, minimum facultatif, `0` par défaut), avec date, solde, horizon, et **cause
probable** (la plus forte sortie prévue jusqu'à ce jour). **Incertitude** : écart optimiste –
pessimiste à chaque horizon, et constats codés : `RECEIVABLES_WITHOUT_DUE_DATE`,
`RECEIVABLES_OTHER_CURRENCY`, `ACCOUNTS_OTHER_CURRENCY`, `NO_ACCOUNT`,
`EXPENSES_WITHOUT_ACCOUNT`, `OVERDUE_RECURRING`, `PLAN_NOT_USED`, `RECEIPTS_NOT_INTEGRATED`.
La prévision n'est **jamais** écrite dans le réalisé ni dans un plan.

**Reste à encaisser avant ADR-0031.** Sans le module Encaissements, le reste à encaisser
d'une facture finale (série réelle, hors avoirs) est sa part `CREDIT` déclarée au gel
(`amountOnCredit`) ; les avoirs et paiements ultérieurs ne sont pas encore imputés, ce que la
prévision signale. À la fusion, la source devient `computeSettlement` (ADR-0031 § 2), avec
l'échéance facultative de la facture.

### 8. Permissions

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `treasury.read` — consulter dépenses, comptes, soldes, prévision | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| `treasury.manage` — enregistrer dépenses, comptes, virements, récurrences, réglages | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |

Plateforme : `treasury.read` sous accès délégué pour le super-administrateur et le support ;
`treasury.manage` sous accès délégué pour le seul super-administrateur ; aucune n'est un
interdit absolu. Les rôles attribuables par chacun ne changent pas.

| Route | Permission |
|---|---|
| `GET /treasury/categories` · `/accounts` · `/expenses` · `/expenses/:id` · `/expenses/:id/attachment` · `/expenses/summary` · `/suppliers` · `/recurring-expenses` · `/recurring-expenses/due` · `/movements` · `/forecast` · `/settings` · `/actuals-bridge` | `treasury.read` |
| `POST`/`PUT` comptes, dépenses, pièce, récurrences, confirmation d'occurrence, virements, mouvements, annulations ; `PUT /treasury/settings` | `treasury.manage` |
| `GET /treasury/reconciliation` | `treasury.read` **et** `analytics.read` |
| `PUT /treasury/actuals-bridge` · `POST /treasury/actuals-bridge/sync` | `actuals.import` **et** `treasury.read` |

### 9. Moteur

`packages/engine/src/treasury/` (`TREASURY_VERSION = '1.0.0'`), fonctions pures, date du
jour en paramètre : `occurrencesOf`, `computeAccountBalances`, `aggregateExpenses`,
`planExpenseActuals`, `reconcileExpenses`, `forecastTreasury`. Tests par propriétés
(générateur pseudo-aléatoire à graine fixe, arithmétique de contrôle propre au test).

## Conséquences

- Nouvelles collections : `treasury_accounts`, `treasury_expenses`,
  `treasury_recurring_expenses`, `treasury_movements`, `treasury_settings` ; champ
  additionnel `sources` sur `actual_periods` (même forme qu'ADR-0031).
- Nouvel espace web **Trésorerie** : onglets « Dépenses », « Trésorerie » (comptes, soldes,
  mouvements, prévision avec graphique) et « Réalisé vs prévu ».
- Deux actions RBAC ; docs/12 et la matrice de test sont amendées. À la fusion avec
  ADR-0031 : l'ordre des actions dans `ACTIONS` suit l'ordre de fusion.

## Plan de validation

Moteur : récurrences (quantième ramené, bornes), soldes (somme exacte, virements neutres),
agrégats, pont (idempotence, devises, horizon, non rattachées), rapprochement, prévision
(ordre des scénarios, conservation, alertes). E2E API : multi-devises, récurrences
confirmées une seule fois, rapprochement, synchronisation idempotente, période clôturée,
saisie manuelle protégée, isolation entre organisations, RBAC. Web : modèles des écrans.
Essai de la dirigeante : deux comptes (caisse CDF, banque USD), un loyer mensuel récurrent,
trois dépenses dont une avec photo du reçu, un virement, la prévision à 30 jours, puis le pont
activé sur un projet de test.

## Décisions ouvertes — pour la dirigeante et son expert-comptable

1. **Charge HT ou TTC.** Une organisation assujettie récupère la TVA payée : sa charge
   serait le montant hors taxe. Aucune règle du dépôt ne le fixe. Aujourd'hui : le réalisé
   reçoit le **montant payé** (prudent, la charge n'est pas minorée) et la TVA déductible
   déclarée est seulement conservée. Faut-il reporter `montant − TVA déductible` pour une
   organisation assujettie ?
2. **Fiche fournisseur.** Texte simple aujourd'hui (les achats complets sont refusés,
   ADR-0018). Faut-il une fiche minimale (NIF, téléphone) ?
3. **Change.** Dépense en USD d'un projet en CDF, virement CDF → USD : quel taux (BCC du
   jour ?), où se constate l'écart de change ? Aujourd'hui : non reporté au réalisé, aucun
   taux calculé.
4. **Valeurs par défaut des scénarios** (tableau § 7) : à valider ou remplacer.
5. **Minimum de trésorerie** par devise : à fixer par l'organisation (0 par défaut).
6. **Justificatif PDF.** Seules les images sont acceptées : le validateur assaini ne sait pas
   analyser un PDF. Faut-il un analyseur PDF (surface d'attaque supplémentaire) ?
7. **L'Administrateur** peut-il enregistrer une dépense ? Proposé : non, comme un
   encaissement (ADR-0031, décision ouverte n° 9).
8. **Réalisé de trésorerie.** Investissements et remboursements d'emprunt ne vont dans aucune
   ligne du compte d'exploitation ; il faudrait que le réalisé accepte des lignes de
   trésorerie (ADR-0031, décision ouverte n° 7).
9. **Plan des exercices 2 à 5.** La prévision utilise le rythme mensuel du compte
   d'exploitation du plan (exercice 1) ; les exercices suivants ne publient que le CA et le
   résultat (docs/08 § Reste à faire).
10. **Un seul réglage d'exercice.** Le pont des ventes (ADR-0031) et celui des dépenses ont
    chacun projet et mois d'ouverture ; deux valeurs différentes rendraient le réalisé
    incohérent. Proposé à la fusion : un réglage commun.

## Liens

- [ADR-0012](ADR-0012-modele-rbac-complet.md) (amendé) ; [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) ;
  [ADR-0023](ADR-0023-factures-et-avoirs.md) § S25e.8 ; [ADR-0027](ADR-0027-numerotation-des-factures.md) ;
  [ADR-0031](ADR-0031-encaissements-et-realise.md).
- [docs/07](../07-PLAN-FINANCIER.md) ; [docs/08](../08-PREVISIONNEL-REALISE.md) ;
  [docs/12](../12-ROLES-PERMISSIONS.md) ; [docs/21](../21-MOTEUR-FINANCIER.md).
- Brief stratégique ERP (hors dépôt), § 5.3 et § 5.5.
- Code : `packages/engine/src/treasury/`, `apps/api/src/treasury/`,
  `apps/web/src/app/(app)/tresorerie/`.
