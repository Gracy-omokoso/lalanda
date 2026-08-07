# ADR-0011 — Contrats d'intégration des chantiers parallèles S18

Statut : Accepted
Date : 2026-08-07
Décideurs : CTO Lalanda (délégation Gracy Omokoso)

## Contexte

Quatre chantiers démarrent **en parallèle** sur `main` (vert, 183 tests) :

| Dev | Chantier | Docs de référence |
|---|---|---|
| K | FIN-001 — engine : horizon 5 exercices, bilan prévisionnel équilibré, BFR, CAF, seuil de rentabilité | docs/07, docs/21 |
| L | Réalisé : périodes mensuelles, clôture, écarts vs plan validé (S16c), projection actualisée | docs/08 |
| M | Wizard de saisie par étapes, validation 3 niveaux, auto-save | docs/06 |
| N | Canvas + Objectifs, taux d'atteinte simple | docs/05, docs/01 |

Sans contrat explicite, les quatre PR convergeront avec des conflits sur les
templates YAML, la forme de sortie de l'évaluateur et les conventions de
nommage. Cet ADR fixe les périmètres, les interfaces partagées, l'ordre de
merge et les règles de non-régression. Il signale aussi les contradictions de
documentation découvertes pendant le cadrage.

## Périmètres et propriété des fichiers

Règle générale : **un fichier = un seul écrivain** pendant S18. Toute
exception passe par le CTO.

| Zone | Propriétaire | Les autres |
|---|---|---|
| `packages/engine/**` (dont structure financière des templates YAML : drivers, feuilles, lignes) | **K** | lecture seule |
| `packages/engine/src/dsl/schema.ts` — clés de **présentation** wizard uniquement (voir Contrat 3) | K (merge), M (proposition) | — |
| `apps/api/src/evaluate/evaluation-view.ts` | **K** | lecture seule |
| `apps/api/src/actuals/**` (nouveau) | **L** | ne pas créer |
| `apps/api/src/canvas/**`, `apps/api/src/objectives/**` (nouveaux) | **N** | ne pas créer |
| `apps/web/src/app/(app)/projects/_components/` — onglets **résultats** (sheet-tabs, tables d'états) | **K** | — |
| `apps/web/src/app/(app)/projects/_components/` — composants **wizard** (nouveaux fichiers préfixés `wizard-`) | **M** | — |
| Onglet web « Réalisé » (nouveaux fichiers préfixés `actuals-`) | **L** | — |
| Pages web Canvas / Objectifs (nouveaux répertoires dédiés) | **N** | — |
| `apps/api/src/app.module.ts` | partagé — **ajout d'imports de module uniquement**, une ligne par dev, conflits triviaux | tous |

Interdictions explicites :

- **L ne touche pas à l'engine.** Les écarts se calculent contre le snapshot
  `FinancialPlan` (S16c), jamais par ré-exécution du moteur historique
  (docs/07 § Limite connue).
- **M ne modifie ni drivers ni feuilles des templates.** Uniquement des
  métadonnées de présentation additives (Contrat 3).
- **N ne calcule aucun total financier.** Le taux d'atteinte est une
  comparaison cible/valeur observée (voir Contrat 4), pas un calcul moteur.

## Contrats d'interface

### Contrat 1 — Forme de sortie de l'évaluateur (K → L, M, N)

`EvaluationView` (`apps/api/src/evaluate/evaluation-view.ts`) est le contrat
consommé par le dashboard, les plans figés, les rapports et — demain — les
écarts (L) et le taux d'atteinte (N). Règles :

- **Évolution additive uniquement** : aucun champ existant renommé, retypé ou
  supprimé ; aucune ligne (`sheetId`/`lineId`) existante renommée. Les
  nouvelles feuilles s'ajoutent dans `lines` avec la même forme
  `EvaluatedLineView`.
- Le passage à 5 exercices **étend** les tableaux annuels
  (`dotations`, `vnc`, `dapParAnnee`, `vncParAnnee` passent de 3 à 5
  éléments) et **ajoute** `ca_annuel_4/5`, `resultat_annuel_4/5` ; il ne
  change pas leur structure.
- Toute évolution de calcul incrémente `ENGINE_VERSION` (déjà dans
  l'empreinte S16c) : les plans re-validés après merge de K recevront un
  nouveau numéro de version — comportement voulu, à documenter dans la PR K.
- K publie dans sa PR un **registre des ids de lignes** (feuille × ligne ×
  format) ; L et N écrivent leurs tests de contrat contre ce registre, pas
  contre des valeurs chiffrées.

### Contrat 2 — Nommage des nouvelles feuilles moteur (K)

Conventions constatées dans les templates (S6–S14) : ids **snake_case en
français métier**, lignes préfixées par feuille quand ambiguïté possible
(`pf_*` pour `plan_financement`), séries annuelles suffixées `_annuel_N`.

Nouvelles feuilles FIN-001 :

| Feuille (`sheetId`) | Préfixe lignes | Exemples |
|---|---|---|
| `bilan` | `bilan_` | `bilan_actif_immobilise`, `bilan_actif_circulant`, `bilan_tresorerie_actif`, `bilan_capitaux_propres`, `bilan_dettes_financieres`, `bilan_fournisseurs`, `bilan_dettes_fiscales_sociales`, `bilan_total_actif`, `bilan_total_passif`, `bilan_ecart_equilibre` |
| `caf` | `caf_` | `caf_resultat_net`, `caf_dotations`, `caf_totale` |
| `seuil_rentabilite` | `sr_` | `sr_charges_fixes`, `sr_taux_marge_variable`, `sr_ca_seuil`, `sr_point_mort_jours` |

Le BFR reste dans `plan_financement` (`pf_bfr` existe) ; K peut ajouter des
lignes `pf_bfr_*` détaillées (composantes clients/fournisseurs/stocks) sans
créer de feuille dédiée. Séries 5 exercices : suffixe `_annuel_1` …
`_annuel_5` (jamais `_an1`, `_y1`, ni `_annee_1`). La ligne
`bilan_ecart_equilibre` doit valoir 0 dans la tolérance d'arrondi — c'est
l'invariant docs/07 « bilan équilibré », testé côté engine.

### Contrat 3 — Métadonnées de présentation wizard dans le DSL (M, arbitré par K)

M peut ajouter au schéma DSL (`packages/engine/src/dsl/schema.ts`) un bloc
**optionnel** de présentation, ignoré par le compilateur et l'évaluateur :

- au niveau template : `wizard: { etapes: [{ id, label, ordre, groupes: [...] }] }` ;
- ou, au minimum, `etape`/`ordre` optionnels sur `groupes_hypotheses`.

Règles : clés **optionnelles** (les templates S6–S14 restent valides sans
elles), **aucune** modification des drivers/feuilles existants, aucun impact
sur l'empreinte de calcul tant que les valeurs de drivers sont inchangées.
La portion `schema.ts` de la PR M est **revue et approuvée par K** avant
merge (fichier dans le périmètre engine).

### Contrat 4 — Nouveaux endpoints (L, N)

Constat : les contrôleurs existants n'ont **pas** de préfixe `/v1`
(`/projects/:id/plans`, `/projects/:id/evaluate`) alors que docs/16 documente
`/v1/...`. Pour S18 on reste cohérent avec le code : **pas de préfixe de
version**, chemins kebab-case pluriels, imbrication sous `/projects/:id/`.

| Endpoint | Module | Dev |
|---|---|---|
| `GET/POST /projects/:id/actual-periods`, `POST /projects/:id/actual-periods/:periodId/close` (+ réouverture avec motif, docs/08) | `apps/api/src/actuals/` | L |
| `GET/PUT /projects/:id/canvas` (+ sous-ressources cartes si besoin) | `apps/api/src/canvas/` | N |
| `GET/PUT /projects/:id/objectives` | `apps/api/src/objectives/` | N |

Obligations communes, calquées sur `plans.controller.ts` (S16c) :
`AuthGuard`, scope organisation, **404 cross-tenant** (jamais 403), erreurs
`{ error: { code, message, details, correlationId } }` (docs/16), codes
d'erreur en SCREAMING_SNAKE_CASE (ex. `PERIOD_CLOSED`, `PLAN_UNCHANGED`
existant). Collections MongoDB : `actual_periods`, `canvas_snapshots`,
`objectives` avec `_schemaVersion` dès la v1.

Taux d'atteinte (N) : calculé **côté API** (jamais dans un composant React —
docs/26 « aucune règle financière dans un composant UI ») comme simple ratio
`observé / cible` par objectif, comparé séparément au plan validé, au réalisé
et à la projection (docs/01). Si la ligne source n'existe pas (ex.
`ca_annuel_5` avant le merge de K, ou plan validé pré-FIN-001), la réponse
porte `atteinte: null` + `raison: 'LIGNE_INDISPONIBLE'` — jamais 0, jamais
d'erreur 500.

## Points de friction anticipés et arbitrages

1. **K change la forme de sortie de l'évaluateur.** Mitigé par le Contrat 1
   (additif uniquement + registre d'ids). L et N ne lisent `EvaluationView`
   qu'à travers des ids de lignes, jamais par index de tableau.
2. **M et K touchent tous deux les templates YAML.** K restructure la partie
   financière (nouvelles feuilles, horizon 5 ans), M ajoute des clés de
   présentation. Deux écrivains sur les mêmes fichiers = conflits garantis.
   Arbitrage : **K merge d'abord**, M rebase et n'ajoute que des clés
   nouvelles (jamais de réécriture de lignes existantes, pas de reformatage
   YAML global).
3. **Écarts (L) contre des plans validés pré-FIN-001.** Les snapshots S16c
   existants ont un horizon 3 ans et ne contiennent ni `bilan` ni `caf`.
   L doit traiter l'absence d'une ligne dans le snapshot comme « non
   comparable » (affichée telle quelle), pas comme un écart de 100 %.
4. **Objectifs à 5 ans (N) avant le merge de K.** `ca_annuel_5` n'existe pas
   encore. N dégrade en `LIGNE_INDISPONIBLE` (Contrat 4) et s'active tout
   seul après le merge de K — aucune dépendance de build entre les deux PR.
5. **Numérotation des plans après bump `ENGINE_VERSION`.** Toute
   re-validation post-K crée une vN+1 même à drivers identiques (empreinte
   changée). Comportement conforme docs/07 (un chiffre montré à une banque
   n'est jamais re-figé), mais à annoncer aux utilisateurs bêta.

### Ordre de merge recommandé

**K → M**, avec **L** et **N** mergeables à tout moment (modules isolés) mais
rebasés sur `main` après le merge de K s'ils veulent consommer les nouvelles
lignes. M est le seul chantier structurellement bloqué par K (mêmes fichiers
YAML).

## Règles de non-régression

- `main` reste vert : les 183 tests existants passent **sans modification**
  dans chaque PR ; modifier un test existant exige une justification dans la
  description de PR (contradiction de doc ou bug avéré, pas une commodité).
- Test d'invariant obligatoire dans la PR K : `bilan_ecart_equilibre = 0`
  (tolérance d'arrondi), continuité de trésorerie sur 5 exercices,
  `caf_totale = resultat_net + dotations` sur les templates de référence,
  non-impact des dotations sur la trésorerie (test S14c conservé).
- Un template sans les nouveautés (clés wizard, immobilisations) reste
  évaluable à l'identique — compatibilité S6→S14 préservée.
- Aucune écriture du Réalisé ne modifie un plan validé (docs/08) : les
  collections `financial_plans` sont en lecture seule pour L, M, N.
- Chaque nouveau module apporte ses tests (unitaires + e2e contrôleur avec
  cas cross-tenant 404), pattern `plans` S16c.
- `pnpm format` + lint + typecheck avant chaque PR ; pas de `TODO` anonyme
  dans l'engine ni l'autorisation (docs/26).

## Contradictions de documentation à arbitrer

1. **docs/16 vs code — préfixe `/v1`.** Docs/16 documente `/v1/...` ; aucun
   contrôleur ne l'implémente. Décision S18 : pas de préfixe (Contrat 4).
   Docs/16 devra être aligné, ou un préfixe global introduit dans un ADR
   dédié avant l'API publique.
2. **docs/07 vs docs/21 + templates — horizon.** Docs/07 exige 5 exercices ;
   docs/21 (§ S14c) fixe `horizon_projection_annees` par défaut à 3 et les
   templates sont à `horizon_mois: 12` / projection 3 ans. K fait foi de
   docs/07 (objet même de FIN-001) et met à jour docs/21 dans sa PR
   (défaut → 5).
3. **docs/26 vs code — langue et arborescence.** Docs/26 impose « noms de
   code en anglais » et prévoit `packages/financial-engine`, `contracts`,
   `apps/worker` ; la réalité est `packages/engine` et des ids DSL en
   **français métier** (`tresorerie`, `seuil`, `devise`), y compris dans les
   vues API. Cet ADR entérine le français métier pour les ids DSL et les
   feuilles (cohérence SYSCOHADA, lisibilité banquier) ; docs/26 à amender.
4. **docs/16 `/v1/plans/{id}` vs implémentation `/projects/:id/plans/:version`.**
   L'implémentation S16c (scopée projet) fait foi ; docs/16 à corriger.
5. **docs/16 `POST /v1/scenarios/{id}/calculations` + `/calculations/{id}/approve`.**
   Le code expose `POST /projects/:id/evaluate` et `POST /projects/:id/plans`.
   Les scénarios (base/prudent/ambitieux, docs/07) ne sont pas encore
   implémentés — aucun des quatre chantiers ne doit introduire de ressource
   `scenarios` sans ADR dédié.

## Plan de validation

- Revue CTO de chacune des quatre PR contre les contrats ci-dessus.
- CI verte (tests, lint, typecheck, format) sur chaque PR.
- Après le merge des quatre chantiers : test d'intégration manuel
  « parcours complet » — wizard → évaluation 5 exercices → validation de
  plan → saisie d'une période réalisée → écarts → objectifs/taux d'atteinte
  → Canvas — chiffres identiques entre API, tables et exports (docs/25 S14).

## Liens

- docs/01-OBJECTIFS.md, docs/05-BUSINESS-MODEL-CANVAS.md, docs/06-WIZARD.md,
  docs/07-PLAN-FINANCIER.md, docs/08-PREVISIONNEL-REALISE.md,
  docs/16-API.md, docs/21-MOTEUR-FINANCIER.md, docs/26-CONVENTIONS.md
- `apps/api/src/evaluate/evaluation-view.ts` (contrat de sortie)
- `apps/api/src/plans/` (pattern module de référence, S16c)
- ADR-0005 (HyperFormula), ADR-0010 (Excel export only)
