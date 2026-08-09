# ADR-0015 — Scénarios multiples : modèle, contrats d'intégration et découpage

Statut : Accepted
Date : 2026-08-09
Décideurs : CTO Lalanda (délégation Gracy Omokoso)

## Contexte

Un projet porte aujourd'hui **un seul** jeu d'hypothèses : le champ
`driverValues: Record<string, number>` de `apps/api/src/projects/project.schema.ts:57-58`.
Il n'existe **aucune** notion de scénario dans le code — ni schéma, ni route, ni
champ Mongo, ni clé DSL. Les quatre occurrences du mot dans le code de
production sont des commentaires (`project.schema.ts:6`,
`projects.controller.ts:176`, `authz/permissions.ts:265` et `:732`).

La documentation approuvée, elle, l'exige déjà :

| Source | Ce qui est écrit |
|---|---|
| `docs/07-PLAN-FINANCIER.md:52-54` | « Au minimum : base, prudent et ambitieux. Ils partagent le même projet mais possèdent leurs propres entrées et résultats. Une comparaison affiche valeur, écart et variables modifiées. » |
| `docs/07-PLAN-FINANCIER.md:166` | « Les scénarios (base / prudent / ambitieux) ne sont toujours pas implémentés. » (limite connue S18a) |
| `docs/02-PRODUIT.md:11` | Entité de premier rang : « **Scénario** : ensemble versionné d'hypothèses. » |
| `docs/15-DATABASE.md:60,73-74` | `FinancialPlan` référence un `scenarioId` ; index critiques « scénarios par projet », « entrées par scénario/version/clé/période ». |
| `docs/16-API.md:25-27,40` | Ressources `/v1/projects/{id}/scenarios`, `/v1/scenarios/{id}/inputs`, `/v1/scenarios/{id}/calculations`. |
| `docs/22-WORKFLOWS.md:11-15` | Machine d'état scénario `draft → ready → calculating → calculated → approved`. |
| `docs/23-RAPPORTS-EXPORTS.md:15,20` | « rapport de scénario » au catalogue ; le scénario est une métadonnée **obligatoire** de tout export. |
| `apps/web/src/app/(marketing)/pricing/_components/pricing-model.ts:61,76,135` | **Promesse publique déjà en ligne** : Free « 1 scénario », Pro et Business « Jusqu'à 3 scénarios par projet ». |

Le dernier point est décisif : la page tarifs vend déjà la fonctionnalité. Ce
n'est pas un chantier d'exploration, c'est un engagement commercial à honorer.

`ADR-0011 § Contradictions 5` avait explicitement gelé le sujet : « les scénarios
ne sont pas encore implémentés — aucun des quatre chantiers ne doit introduire de
ressource `scenarios` sans ADR dédié ». **Cet ADR est cet ADR dédié.**

Plusieurs agents vont développer en parallèle. Comme pour ADR-0011 et ADR-0012,
le livrable est le contrat qui rend ce parallélisme possible : modèle de données,
signature moteur, routes, périmètres de fichiers et ordre de merge.

### Ce que l'existant impose (vérifié dans le code, pas supposé)

- **Horizon = 5 exercices.** `HORIZON_PROJECTION_DEFAUT = 5`
  (`packages/engine/src/evaluator/index.ts:23`), résolu en
  `template.horizon_projection_annees ?? HORIZON_PROJECTION_DEFAUT`
  (`evaluator/index.ts:185` et `:328`), et les 4 templates sectoriels le fixent
  explicitement à 5. L'horizon est en outre **codé en dur dans le YAML** : la
  feuille `projection` écrit `ca_annuel_1..5` ligne par ligne, et
  `evaluator/index.ts:341-350` lève `INVALID_FORMULA` si une ligne `ca_annuel_N`
  manque. **Les scénarios ne touchent pas à l'horizon.**
- **Bilan équilibré par construction, sans poste de bouclage.**
  `packages/engine/src/etats-financiers/index.ts:7-28` (démonstration par
  récurrence), trésorerie déroulée en méthode indirecte à
  `etats-financiers/index.ts:384`, `ecart_equilibre: totalActif - totalPassif`
  à `:412` — un **diagnostic**, pas un plug. Tolérance testée à 0,01
  (`etats-financiers.test.ts:29`) sur 3 templates × 5 exercices, rejouée sur
  7 jeux déformants (`:74-91`). L'invariant est une propriété du chemin de
  calcul : il vaut donc pour chaque scénario indépendamment, sans code
  supplémentaire — mais il doit être **testé par scénario**.
- **L'évaluation est déjà multi-scénario dans sa forme.**
  `evaluateCompiled(compiled, values, options)`
  (`packages/engine/src/evaluator/index.ts:89`) porte déjà le commentaire
  « Utile quand on veut lancer plusieurs scénarios » (`:88`). Aucun des quatre
  appelants de l'API ne l'utilise : tous passent par `evaluateTemplate`
  (`evaluate.controller.ts:81`, `projects.controller.ts:225`,
  `plans.controller.ts:126`, `reports.controller.ts:162`), qui recompile à
  chaque appel (`evaluator/index.ts:84`).
- **Aucun cache, aucune mémoïsation** dans le moteur. Chaque évaluation
  construit et détruit un classeur HyperFormula
  (`evaluator/index.ts:113` et `:171-173`).
- **Empreinte du plan validé** : SHA-256 du JSON canonique de six entrées
  exactement — `driverValues` résolus, `templateSlug`, `templateVersion`,
  `parameterPackSlug`, `packVersion`, `engineVersion`
  (`apps/api/src/plans/fingerprint.ts:44-53`). Ni `projectId` ni
  `organizationId` n'y entrent : l'unicité vient de la requête
  (`plans.service.ts:41-44`).
- **`?planVersion=N`** n'est lu qu'au seul endroit :
  `apps/api/src/reports/reports.controller.ts:215` (PDF) et `:247` (XLSX),
  parsé par `parsePlanVersion` (`:64`), branche figée sans recalcul à `:94-146`.
- **RBAC** : 15 actions gelées (`apps/api/src/authz/permissions.ts:88-104`),
  8 rôles organisation (`:31-40`), 6 rôles plateforme (`:76-83`), matrices
  `ORG_PERMISSION_MATRIX` (`:183`) et `PLATFORM_PERMISSION_MATRIX` (`:367`).
  Deux tests verrouillent l'ensemble : `permissions.test.ts` (matrice
  redupliquée en littéral, 210 assertions) et `routes-coverage.test.ts` (toute
  route sans `@RequirePermission` casse la CI ; la liste `CONTROLEURS` est
  confrontée au nombre de fichiers `*.controller.ts` réellement présents).
- **Coût du PDF.** Un seul navigateur Chromium est réutilisé, les **pages** sont
  jetables (`apps/api/src/reports/reports.service.ts:5`, `:46`, `:53-66`,
  `:122-124`). Le coût marginal est donc *par page rendue*, pas par processus.
  Mesures inscrites dans `render-gate.ts:9-10` : 1 export ≈ 0,9 s et ~3 processus
  Chromium ; 40 exports concurrents → 17,5 s, 149 processus, 5,7 Go de RSS, soit
  ~140 Mo par page (`render-gate.ts:37`). Bornes en vigueur :
  `maxConcurrent: 2`, `maxQueued: 8`, `queueTimeoutMs: 20_000`
  (`render-gate.ts:34-52`) et `PAGE_TIMEOUT_MS = 15_000`
  (`reports.service.ts:21`).
- **Web** : aucun sélecteur de version de plan, aucune bibliothèque de
  graphiques (dépendances de `apps/web/package.json` : `@lalanda/shared`,
  `@lalanda/ui`, `better-auth`, `clsx`, `next`, `react`, `react-dom`,
  `tailwind-merge`). Tout est rendu en tableaux HTML. L'onglet Plan est
  `ProjectPlan` (`apps/web/src/app/(app)/projects/_components/project-plan.tsx:106`),
  la navigation projet est `PROJECT_TABS`
  (`apps/web/src/app/(app)/projects/[id]/_components/project-tabs.tsx:31-36`),
  l'autosave est `useAutosave` à 800 ms (`use-autosave.ts:59`) avec un `flush()`
  appelé avant export (`project-plan.tsx:284`) et avant validation (`:309`).

## Options considérées

### A. Sous-document du projet (`projects.scenarios: [{ … }]`)

Rejetée. Trois raisons.

1. **Contention d'écriture.** L'autosave du wizard écrit `driverValues` toutes
   les 800 ms via `POST /projects/:id/drivers`
   (`projects.controller.ts:152`, `use-autosave.ts:59`). Deux membres travaillant
   sur deux scénarios différents écriraient le **même document** : dernier
   arrivé, dernier servi, perte silencieuse. Aujourd'hui le risque n'existe pas
   (un seul jeu d'hypothèses) ; il apparaîtrait avec la fonctionnalité.
2. **`docs/15-DATABASE.md:73-74`** prescrit des index « scénarios par projet » et
   « entrées par scénario/version/clé/période » — un tableau imbriqué ne s'indexe
   pas ainsi.
3. Le document projet embarquerait N × `driverValues` (18 à 21 drivers par
   template), ce qui reste petit — l'argument n'est pas la taille, c'est la
   granularité d'écriture.

### B. Variante d'hypothèses (delta / surcharge sur un scénario de base)

Rejetée, et c'est le rejet le plus important de cet ADR.

Le moteur résout déjà une précédence à trois niveaux — valeurs utilisateur >
parameter pack > `driver.defaut` (`evaluator/index.ts:925-946`) — et c'est le
résultat **résolu** (`evaluation.drivers`, `plans.controller.ts:139`) qui est à
la fois haché (`fingerprint.ts:46`) et stocké dans le snapshot
(`plan.schema.ts:36-37`). Ajouter un quatrième niveau « delta de scénario »
signifierait :

- réimplémenter la résolution côté API alors qu'aujourd'hui « l'API ne résout
  jamais les drivers elle-même » ;
- rendre l'empreinte ambiguë : deux deltas différents sur deux bases différentes
  peuvent résoudre au même jeu de valeurs, et deux bases modifiées font varier
  le résultat d'un scénario **sans que personne ne l'ait touché** — un chiffre
  montré à une banque changerait tout seul ;
- casser `docs/07-PLAN-FINANCIER.md:54` qui dit que les scénarios « possèdent
  leurs propres entrées ».

Le gain (voir d'un coup d'œil les variables modifiées) s'obtient par **calcul de
différence à la lecture**, pas par un stockage différentiel.

### C. Document séparé, entrées complètes — **retenue**

Collection `scenarios`, un document par scénario, `driverValues` **complet** (pas
un delta). C'est la forme prescrite par `docs/15-DATABASE.md`, celle qui isole
les écritures concurrentes, et celle qui laisse l'empreinte SHA-256 inchangée
dans sa définition.

## Décision

### 1. Modèle de données

#### 1.1 Nouvelle collection `scenarios`

Fichier : `apps/api/src/scenarios/scenario.schema.ts` (nouveau).

| Champ | Type | Note |
|---|---|---|
| `organizationId` | `String`, requis, indexé | isolation tenant, comme partout |
| `projectId` | `String`, requis, indexé | |
| `key` | `String`, requis, `^[a-z][a-z0-9-]*$`, `maxlength: 40` | slug stable, cité dans les URL web |
| `label` | `String`, requis, `maxlength: 120` | libellé affiché et exporté |
| `description` | `String`, optionnel, `maxlength: 500` | « ce qui change et pourquoi » |
| `isReference` | `Boolean`, requis, `default: false` | **un seul par projet** (voir 1.2) |
| `driverValues` | `Object`, `default: {}` | `Record<string, number>` — mêmes clés que `Project.driverValues` |
| `driversUpdatedBy` | `String \| null`, `default: null` | migre depuis `Project.driversUpdatedBy` (S20a, séparation des tâches R2) |
| `driversUpdatedAt` | `Date \| null`, `default: null` | |
| `createdBy` | `String`, requis | |
| `ordre` | `Number`, requis, `default: 0` | ordre d'affichage et de colonnes |
| `_schemaVersion` | `Number`, requis, `default: 1` | convention ADR-0004 |
| `createdAt` / `updatedAt` | `timestamps: true` | |

Index :

```
{ projectId: 1, key: 1 }                unique
{ organizationId: 1, projectId: 1, ordre: 1 }
{ projectId: 1, isReference: 1 }        unique, partialFilterExpression { isReference: true }
```

Le troisième index est l'invariant central : **un projet a exactement un
scénario de référence**, garanti par la base et non par du code applicatif.

Un scénario **ne peut changer ni `templateSlug`, ni `parameterPackSlug`, ni
`pays`** : ces trois champs restent sur le projet. Comparer deux scénarios
calculés sous deux packs fiscaux différents n'est pas une comparaison. Le besoin
« et si le taux d'IBP changeait ? » est une **sensibilité sur paramètres pays**,
un autre produit — voir § Décisions ouvertes n°4.

#### 1.2 Le scénario de référence

Un seul concept, pas deux. Le scénario `isReference: true` est simultanément :

- la **base de comparaison** par défaut de la vue Comparaison ;
- la **référence des écarts du réalisé**
  (`apps/api/src/actuals/actuals.controller.ts:234`, aujourd'hui
  `plans.findLatestApproved(orgId, projectId)`) ;
- la **référence du taux d'atteinte des objectifs**
  (`apps/api/src/objectives/objectives.controller.ts:109`) ;
- le scénario servi par défaut aux routes existantes sans `scenarioId`.

Deux désignations qui seraient égales dans 99 % des cas sont une usine à bugs ;
on n'en garde qu'une. La vue Comparaison peut néanmoins comparer contre n'importe
quelle colonne via un paramètre de requête `?base=` — c'est un choix d'affichage
éphémère, pas un état stocké.

Changer la référence exige `plan.approve` (§ 3.3). C'est le même raisonnement
qu'ADR-0012 §6 R3 : décider ce à quoi on compare le réalisé est un acte
financier engageant, pas un réglage d'interface.

#### 1.3 Ce que devient `Project.driverValues`

`Project` passe en `_schemaVersion: 3` et **conserve** `driverValues` et
`driversUpdatedBy` sans les écrire ni les lire après la migration. Ils restent en
base comme filet de retour arrière, et sont supprimés par un ticket ultérieur —
jamais dans le même lot que la migration qui les vide de leur rôle.

`POST /projects/:id/drivers` et `POST /projects/:id/evaluate` **continuent de
fonctionner** et ciblent le **scénario de référence**. C'est ce qui garde vertes
les 1 291 tests et fonctionnel le web pendant que les lots 3 à 5 atterrissent.
Ces deux routes sont marquées dépréciées dans leur JSDoc, pas retirées.

#### 1.4 Migration

Fichier : `apps/api/migrations/20260809-0002-scenario-de-reference.mjs` (nouveau,
même forme que `20260808-0001-rbac-roles-organisation.mjs`).

```
1. Pour chaque projet en _schemaVersion: 2 sans scénario :
   insérer { key: 'base', label: 'Scénario de base', isReference: true,
             driverValues: projet.driverValues,
             driversUpdatedBy: projet.driversUpdatedBy,
             createdBy: projet.createdBy, ordre: 0, _schemaVersion: 1 }
2. financial_plans : $set scenarioId = l'_id du scénario 'base' du projet,
   scenarioKey = 'base'  (filtre : scenarioId absent)
3. projects : $set _schemaVersion = 3  (filtre : _schemaVersion: 2)
```

Idempotence par le filtre `_schemaVersion` et par l'absence de scénario, comme
la migration S20a. **L'ordre 1 → 2 → 3 importe** : passer les projets en v3
d'abord rendrait l'étape 1 aveugle.

**Auto-réparation.** `ScenariosService.ensureReference(orgId, projectId)` crée le
scénario `base` à la volée s'il manque, et est appelé en tête de chaque lecture
de scénario. Un projet sans scénario ferait échouer `POST /projects/:id/evaluate`
en 500 ; le précédent de `provisionPersonalOrgForUser` (crochet non
transactionnel) montre qu'un projet peut naître sans son satellite. La création
d'un projet crée son scénario `base` dans la même transaction (ADR-0004 §3), et
`ensureReference` est la ceinture par-dessus les bretelles.

#### 1.5 Articulation avec le versionnement des plans validés

C'est le point le plus délicat de cet ADR. Décision, en trois temps.

**a) `FinancialPlan` gagne `scenarioId` (indexé) et `scenarioKey` (dénormalisé
dans le snapshot).** `scenarioKey` est figé avec le reste : un scénario renommé
plus tard ne réécrit pas les plans déjà validés — un snapshot ne se réécrit
jamais (`plan.schema.ts:8-17`).

**b) Le numéro de version reste une séquence par PROJET, pas par scénario.**
L'index unique `{ projectId, version }` (`plan.schema.ts:107`) est **inchangé**,
`?planVersion=N` garde exactement son sens actuel, `GET /projects/:id/plans/:version`
reste non ambigu, et les tests e2e existants
(`apps/api/src/__tests__/plans.e2e.test.ts:167,169,194-201,227`) restent verts
sans modification.

L'alternative — une séquence par `(projet, scénario)` — a été écartée : elle
oblige à changer l'index unique, à rendre `?planVersion=N` ambigu, donc à changer
le contrat public des exports, pour un seul gain (des numéros contigus par
scénario). Un identifiant unique et monotone à l'échelle du projet est de toute
façon meilleur pour un dossier bancaire : « plan v5 (prudent) » désigne une seule
chose, pour toujours.

Conséquence assumée : les versions d'un scénario donné ne sont pas contiguës
(base v1, prudent v2, base v3). L'interface affiche le libellé du scénario à côté
du numéro ; elle ne fait jamais croire à une suite.

**c) Chaque scénario peut être validé et figé indépendamment.** Deux
modifications, chirurgicales, dans `apps/api/src/plans/plans.service.ts` :

- le balayage `approved → superseded` (`plans.service.ts:86-96`) est **scopé au
  scénario** : `{ projectId, scenarioId, _id: { $ne }, status: 'approved' }` ;
- la comparaison d'empreinte `PLAN_UNCHANGED` (`plans.service.ts:41-52`)
  interroge le dernier plan **du même scénario**, pas du projet.

Sans le second point, valider un scénario prudent dont les drivers seraient
fortuitement identiques à ceux de la base renverrait un `409 PLAN_UNCHANGED`
absurde. Sans le premier, figer le prudent désapprouverait la base.

Un projet peut donc porter **plusieurs plans `approved` simultanément, au plus un
par scénario**. Le calcul du numéro de version (`(latest?.version ?? 0) + 1`,
`plans.service.ts:59`) continue de lire le dernier plan **du projet**, toutes
scénarios confondus — c'est ce qui maintient la séquence globale.

**La définition de l'empreinte SHA-256 n'est pas touchée.** Aucun champ n'est
ajouté aux six entrées hachées de `fingerprint.ts:45-52`. Le `scenarioId` est un
critère de **requête**, pas de hachage — exactement comme `projectId`
aujourd'hui. Toucher à la fonction d'empreinte invaliderait toutes les empreintes
existantes ; ce serait une régression gratuite.

#### 1.6 Pas de machine d'état sur le scénario

`docs/22-WORKFLOWS.md:11-15` décrit `draft → ready → calculating → calculated →
approved`. Ce cycle suppose un calcul asynchrone (`calculating`) qui n'existe pas
et n'est pas souhaitable : l'évaluation est synchrone et sub-milliseconde
(HyperFormula sur ~90 cellules de formule, `evaluator/index.ts:113`).

**Décision : le scénario n'a pas d'état.** Il est toujours modifiable. L'état
figé vit sur `FinancialPlan` (`approved → superseded`), là où il est déjà.
`docs/22` est à amender (§ Contradictions de documentation).

### 2. Contrat `packages/engine`

#### 2.1 Signature

Ajout d'un seul point d'entrée, dans un fichier nouveau
`packages/engine/src/evaluator/multi-scenario.ts`, exporté par le barrel
`packages/engine/src/index.ts` :

```ts
/** Un jeu d'hypothèses nommé. `id` est opaque pour le moteur. */
export interface ScenarioInput {
  readonly id: string;
  readonly values: DriverValues;
}

/** Résultat complet et indépendant d'un scénario. */
export interface ScenarioEvaluation {
  readonly id: string;
  readonly result: EvaluationResult;
}

/**
 * Compile UNE fois, évalue N fois. Les résultats sont indépendants et rendus
 * dans l'ordre d'entrée. Le moteur ne calcule AUCUN écart.
 */
export function evaluateScenarios(
  template: Template,
  scenarios: readonly ScenarioInput[],
  options: EvaluateOptions = {},
): readonly ScenarioEvaluation[];
```

`EvaluateOptions` (`evaluator/index.ts:34-36`) devient exporté par le barrel — il
ne l'est pas aujourd'hui, alors que la signature publique en dépend.

#### 2.2 Ce qui est partagé, ce qui est recalculé

**Partagé, une seule fois :** le `CompiledTemplate` produit par
`compileTemplate(template)` (`compiler/index.ts:65`) — structure des feuilles,
`driverIndex`, `lineIndex`, `sheetOrder`, formules Excel. Il ne dépend que du
template, jamais des valeurs. C'est le chemin déjà documenté à
`evaluator/index.ts:88` et jamais emprunté.

**Recalculé intégralement, par scénario :** tout ce qui porte une valeur — le
classeur HyperFormula (construit puis détruit, `evaluator/index.ts:113`,
`:171-173`), la résolution des drivers (`resolveDriverValues`, `:925-946`), les
`LineResult`, les `amortissements` (`amortissements/index.ts`) et les
`etatsFinanciers` (`etats-financiers/index.ts`).

**Aucune mémoïsation entre scénarios.** Deux scénarios diffèrent par
construction ; un cache de valeurs n'aurait rien à partager et introduirait un
risque de fuite d'un scénario dans l'autre — le pire défaut imaginable ici.

Gain mesurable : la compilation n'est plus payée N fois. Ordre de grandeur, à
mesurer et non à supposer : les templates font 40 à 55 lignes DSL et 18 à 21
drivers ; **le lot 2 publie une mesure avant/après dans sa PR**. Aucun budget de
performance n'est promis ici sans mesure.

#### 2.3 Ce que le moteur ne fait pas

Le moteur **ne calcule aucun écart, aucun pourcentage, aucune synthèse
comparative.** Deux raisons :

1. Une soustraction n'est pas une règle financière, mais le **choix des lignes
   comparables** et le **comportement quand la base vaut zéro** en sont des
   décisions de présentation. Elles n'ont pas leur place dans la source de vérité
   des calculs.
2. `docs/26-CONVENTIONS.md` interdit toute règle financière dans un composant UI.
   L'écart vit donc dans l'API — module `scenarios`, fonction pure et testée.

#### 2.4 Invariants — inchangés, mais testés par scénario

L'horizon reste **5 exercices** et le bilan reste **équilibré par construction,
sans poste d'ajustement** (§ Contexte). Ce sont des propriétés du chemin de
calcul, valables pour chaque scénario sans code supplémentaire.

Obligation de test du lot 2 : reprendre la boucle existante
`etats-financiers.test.ts:74-91` (7 jeux déformants × 3 templates, tolérance
0,01) et la faire passer **à travers `evaluateScenarios`** en un seul appel,
en vérifiant que les N résultats sont **identiques, champ par champ**, à N appels
séparés de `evaluateTemplate`. C'est le test qui prouve que la compilation
partagée n'a rien contaminé.

### 3. Contrat API

Pas de préfixe `/v1` — cohérence avec le code et avec ADR-0011 § Contrat 4.
Imbrication sous `/projects/:id/`, kebab-case pluriel. `docs/16-API.md:25-27`
décrit une ressource `scenarios` de premier niveau ; elle est écartée pour la
même raison qu'à ADR-0011 (l'isolation tenant se lit dans le chemin).

Toutes les routes : `@UseGuards(AuthGuard, PermissionsGuard)`, scope
organisation, **404 cross-tenant jamais 403**, format d'erreur
`{ error: { code, message, details, correlationId } }`, codes en
SCREAMING_SNAKE_CASE.

#### 3.1 Routes nouvelles

Contrôleur : `apps/api/src/scenarios/scenarios.controller.ts`,
`@Controller('projects')`.

| Verbe | Chemin | Permission | Corps | Réponse | Codes |
|---|---|---|---|---|---|
| `GET` | `/projects/:id/scenarios` | `project.read` | — | `{ scenarios: ScenarioSummaryView[] }` | 200 · 404 `PROJECT_NOT_FOUND` |
| `POST` | `/projects/:id/scenarios` | `inputs.update` | `{ key?, label, description?, copyFrom? }` | `ScenarioView` | 201 · 400 `INVALID_REQUEST` · 403 `PLAN_LIMIT_SCENARIOS` · 409 `SCENARIO_KEY_TAKEN` · 404 `SCENARIO_NOT_FOUND` (si `copyFrom` inconnu) |
| `GET` | `/projects/:id/scenarios/:scenarioId` | `project.read` | — | `ScenarioView` | 200 · 404 `SCENARIO_NOT_FOUND` |
| `PATCH` | `/projects/:id/scenarios/:scenarioId` | `inputs.update` | `{ label?, description?, ordre? }` | `ScenarioView` | 200 · 400 · 404 |
| `POST` | `/projects/:id/scenarios/:scenarioId/drivers` | `inputs.update` | `{ driverValues }` | `ScenarioView` | 201 · 400 · 404 |
| `POST` | `/projects/:id/scenarios/:scenarioId/evaluate` | `plan.calculate` | `{ driverValues?, persist? }` | `{ scenario, lines, amortissements?, etatsFinanciers? }` | 201 · 400 · 403 `FORBIDDEN` (si `persist` sans `inputs.update`) · 404 |
| `DELETE` | `/projects/:id/scenarios/:scenarioId` | `inputs.update` | — | 204 | 409 `SCENARIO_IS_REFERENCE` · 409 `SCENARIO_HAS_APPROVED_PLAN` · 404 |
| `PUT` | `/projects/:id/scenarios/:scenarioId/reference` | `plan.approve` | — | `{ scenarios: ScenarioSummaryView[] }` | 200 · 404 · 409 `SCENARIO_HAS_NO_PLAN` (voir ci-dessous) |
| `GET` | `/projects/:id/scenarios/comparison` | `project.read` | `?scenarios=a,b,c` `?base=a` `?source=live\|approved` | `ScenarioComparisonView` | 200 · 400 `INVALID_REQUEST` · 404 |

Précisions.

- **`copyFrom`** duplique les `driverValues` d'un scénario existant. C'est le
  parcours attendu (« pars de la base, dégrade le CA de 20 % »), et il évite de
  faire ressaisir 18 drivers. Absent → valeurs par défaut du template.
- **`persist` sur `/evaluate`** reproduit à l'identique le compromis assumé de
  `projects.controller.ts:174-179` : le second contrôle est dans le corps et non
  dans le décorateur, sinon un `analyst` ne pourrait plus explorer sans écrire.
  Le contrôle passe par `can(role, 'inputs.update')`, jamais par un test de rôle.
- **`DELETE` sous `inputs.update` et non `project.update`.** Un `analyst` détient
  `inputs.update` mais pas `project.update` (`permissions.ts:267-283`) ; lui
  interdire de supprimer le scénario qu'il vient de créer serait absurde. La
  protection réelle est ailleurs : les deux 409 rendent indestructible tout
  scénario de référence ou porteur d'un plan validé. Un scénario supprimable est
  par construction un brouillon sans conséquence.
- **`PUT …/reference` et `409 SCENARIO_HAS_NO_PLAN`** : promouvoir en référence un
  scénario sans plan validé viderait de sens les écarts du réalisé, qui exigent
  déjà un plan validé (`409 NO_APPROVED_PLAN`, `docs/08:83`). Le refus est
  explicite plutôt que silencieux. **Sous réserve** de la décision ouverte n°3
  sur la rétroactivité.
- L'action est journalisée : `audit_events` avec
  `{ action: 'plan.approve', targetType: 'project', metadata: { kind: 'scenario.reference', from, to } }`.
  Le module `authz/audit.service.ts` existe (ADR-0012 §8).

#### 3.2 Routes existantes modifiées

| Route | Modification |
|---|---|
| `POST /projects/:id/plans` (`plans.controller.ts:89`) | Corps **optionnel** `{ scenarioId? }`. Absent → scénario de référence. Le plan stocke `scenarioId` + `scenarioKey`. La vérification de séparation des tâches (`sodDecision`, `plans.controller.ts:161-173`) lit désormais `scenario.driversUpdatedBy` et non `project.driversUpdatedBy`. |
| `GET /projects/:id/plans` (`:222`) | Chaque entrée porte `scenarioId`, `scenarioKey`, `scenarioLabel`. Paramètre optionnel `?scenario=<scenarioId>` pour filtrer. |
| `GET /projects/:id/plans/:version` (`:233`) | Inchangée (le numéro reste unique par projet) ; la réponse porte `scenarioId`/`scenarioKey`. |
| `GET /projects/:id/report/pdf` et `/report/xlsx` | Nouveau `?scenario=<scenarioId>`. Voir § 5. |
| `POST /projects/:id/drivers`, `POST /projects/:id/evaluate` | Inchangées en surface ; ciblent le scénario de référence. JSDoc marquée dépréciée. |
| `GET /projects/:id/variances`, taux d'atteinte des objectifs | Inchangés en surface ; `findLatestApproved` devient `findLatestApprovedForScenario(orgId, projectId, referenceScenarioId)`. La réponse gagne `scenarioKey` à côté du `planVersion` déjà exposé. |

#### 3.3 RBAC — aucune action nouvelle

**Décision : la matrice `apps/api/src/authz/permissions.ts` n'est pas modifiée.
Aucune seizième action.**

| Geste | Action réutilisée | Justification |
|---|---|---|
| Lire, lister, comparer des scénarios | `project.read` | même sensibilité que l'onglet Plan |
| Créer, dupliquer, renommer, supprimer un scénario, saisir ses hypothèses | `inputs.update` | `permissions.ts:732` définit déjà l'`analyst` comme « Scénarios, hypothèses et analyses. Ne valide pas. » et `:265` comme « scénarios, analyses, commentaires ». La matrice anticipait le besoin. |
| Évaluer un scénario | `plan.calculate` | strictement le geste existant |
| Figer le plan d'un scénario | `plan.approve` | route inchangée, `allow_sod` inchangé |
| Désigner le scénario de référence | `plan.approve` | acte financier engageant : décide ce à quoi le réalisé est comparé. Même raisonnement qu'ADR-0012 §6 R3, et même méthode : obtenir la garantie **sans inventer d'action**. |
| Exporter un scénario | `report.export` | inchangé — l'`advisor` reste sans export (ADR-0012 §3) |

Cette décision n'est pas de la commodité : c'est ce qui rend les lots
parallélisables. Ajouter une action obligerait à modifier `permissions.ts` **et**
à réécrire le littéral de `permissions.test.ts` (210 assertions), fichier que
**tous** les lots devraient alors rebaser. Le coût de coordination dépasserait le
gain de granularité. Si un besoin de permission propre aux scénarios apparaît
(par exemple « créer un scénario » distinct de « saisir des hypothèses »), il
remonte au CTO — c'est le signal d'une action manquante dans `docs/12`, pas d'une
exception à écrire dans un contrôleur.

**Deux fichiers d'autorisation sont néanmoins touchés, en ajout seulement :**
`routes-coverage.test.ts` (les nouveaux contrôleurs entrent dans la liste
`CONTROLEURS`, dont la complétude est confrontée au nombre de fichiers
`*.controller.ts`) — voir § 6 pour la règle de propriété.

#### 3.4 Entitlements — la promesse publique est déjà en ligne

`apps/api/src/billing/entitlements.ts` gagne un champ :

```ts
/** Scénarios maximum par projet. `null` = illimité. */
maxScenariosPerProject: number | null;
```

Valeurs, **reprises telles quelles de la page tarifs** (`pricing-model.ts:61`,
`:76`, `:135`) et d'aucune autre source :
`free: 1`, `pro: 3`, `business: 3`.

Imposé à `POST /projects/:id/scenarios` →
`403 { code: 'PLAN_LIMIT_SCENARIOS', limit, plan }`, calqué sur
`PLAN_LIMIT_PROJECTS` (`projects.controller.ts:87-92`). Règle docs/13 :
« l'interface peut expliquer une limite, mais l'API l'impose ».

Conséquence à traiter dans le même lot : la ligne « Scénarios par projet » de
`COMPARISON` (`pricing-model.ts:135`) passe du statut « fonction non restreinte »
à « limite appliquée par l'API », et entre donc dans le périmètre du test qui
confronte la page au catalogue (`pricing-model.ts:125-129`).

Que Business promette autant de scénarios que Pro (3) est une anomalie
commerciale, pas technique — § Décisions ouvertes n°1.

### 4. Contrat web

#### 4.1 Où vit le choix du scénario

**Dans les deux, avec une seule source d'état : l'URL.**

- **Onglet Plan** (`/projects/[id]`) : paramètre `?scenario=<key>`, lu et écrit
  exactement comme le `?tab=` existant (`project-plan.tsx:714`, `router.replace`
  `:724`). Un sélecteur de scénario est ajouté **en tête de la colonne wizard**,
  pas en tête de page : il désigne le jeu d'hypothèses qu'on est en train de
  saisir, et les résultats affichés à droite sont ceux de ce scénario.
- **Wizard** : aucune étape nouvelle. Le wizard édite le scénario sélectionné,
  point. Les étapes viennent du DSL (`buildWizardSteps`, `wizard-model.ts:42`) et
  ne changent pas. `docs/06-WIZARD.md` prévoit déjà « duplication d'une
  hypothèse » ; dupliquer un scénario entier en est la généralisation naturelle.
- **Onglet Comparaison** : une entrée nouvelle dans `PROJECT_TABS`
  (`project-tabs.tsx:31-36`, point d'extension documenté à `:9-20`) →
  `/projects/[id]/comparaison`.

**Le piège numéro un de ce chantier, à traiter explicitement en revue :**
`useAutosave` est débouncé à 800 ms (`use-autosave.ts:59`). Changer de scénario
pendant qu'une sauvegarde est en vol écrirait les valeurs du scénario A dans le
scénario B. Le changement de scénario **doit** appeler `flush()` et attendre sa
résolution avant de muter l'état, exactement comme le font déjà l'export
(`project-plan.tsx:284`) et la validation (`:309`). Un test couvre ce cas.

#### 4.2 Ce que consomme la vue de comparaison

Un seul appel : `GET /projects/:id/scenarios/comparison`. Forme de la réponse :

```ts
interface ScenarioComparisonView {
  base: { scenarioId: string; key: string; label: string };
  source: 'live' | 'approved';
  colonnes: Array<{
    scenarioId: string; key: string; label: string;
    isReference: boolean;
    planVersion: number | null;      // null si pas de plan validé
    approvedAt: string | null;
  }>;
  lignes: Array<{
    sheetId: string; lineId: string; label: string;
    format: string;
    valeurs: Array<{
      scenarioId: string;
      valeur: number | null;
      ecart: number | null;          // valeur − valeur de la colonne base
      ecartPct: number | null;       // null si base = 0 ou valeur absente
      raison?: 'LIGNE_INDISPONIBLE' | 'AUCUN_PLAN_VALIDE' | 'BASE_NULLE';
    }>;
  }>;
  driversModifies: Array<{           // docs/07:54 « variables modifiées »
    driverId: string; label: string; unite?: string;
    valeurs: Array<{ scenarioId: string; valeur: number }>;
  }>;
}
```

Règles non négociables, calquées sur l'existant :

- **Jamais de zéro fabriqué.** Une ligne absente d'un scénario, un plan validé
  manquant ou une base nulle produisent `null` + `raison`, jamais `0`, jamais un
  500 — c'est le contrat ADR-0011 § Contrat 4, déjà appliqué côté web par
  `raisonLabel` (`actuals-format.ts:44`) et par les tirets de
  `actuals-variance-table.tsx:88`.
- **Aucun calcul dans le composant.** Écarts et pourcentages arrivent calculés
  par l'API (`docs/26`).
- **Tableau, pas graphique.** Le dépôt n'a aucune bibliothèque de graphiques et
  rend tout en tableaux HTML avec pastilles textuelles (jamais la couleur seule —
  `actuals-variance-table.tsx:17-19`). La comparaison suit ce parti. Introduire
  une bibliothèque de graphes est une décision séparée — § Décisions ouvertes n°6.
- Le tableau est large : il vit dans un conteneur à défilement horizontal propre,
  en-têtes de colonnes figées, comme les tableaux d'états existants
  (`etats-financiers-tables.tsx`).

### 5. Exports

#### 5.1 Excel

Un classeur porte **un scénario par défaut** (celui de `?scenario=`, ou la
référence). Le multi-scénario y est bon marché : ExcelJS est du calcul pur, sans
Chromium (`reports.service.ts:94-96`).

**Décision : `?scenarios=all` est autorisé sur `/report/xlsx`.** Le classeur
reprend alors la structure existante (une feuille par feuille moteur,
`report-xlsx.ts`) **préfixée par le libellé du scénario**, plus une feuille
« Comparaison » reprenant la même matrice que la vue web. La feuille
« Hypothèses » gagne une colonne par scénario.

Borne : le nombre de scénarios est déjà plafonné à 3 par l'entitlement (§ 3.4),
donc au pire 3 × 6 feuilles + 2. Aucune borne supplémentaire n'est nécessaire.

#### 5.2 PDF — et pourquoi « tous les scénarios » n'est pas gratuit

**Décision : un PDF = un scénario. Pas d'export PDF multi-scénarios dans ce
chantier.** Ce n'est pas une paresse, c'est le seul poste de coût marginal réel
du produit, et il a déjà fait tomber l'API une fois.

Les faits, tirés du dépôt :

- Le navigateur est réutilisé (`reports.service.ts:5`, `:46`, `:53-66`), mais
  **chaque rendu ouvre une page** (`:122-124`) qui pèse ~140 Mo de RSS
  (`render-gate.ts:37`).
- Mesures inscrites dans `render-gate.ts:9-10` : 1 export ≈ 0,9 s et ~3 processus
  Chromium ; 40 exports concurrents → 17,5 s, 149 processus, **5,7 Go de RSS**.
- Le portillon en vigueur autorise **2 rendus simultanés**, une file de 8, un
  abandon à 20 s (`render-gate.ts:34-52`), et chaque page expire à 15 s
  (`reports.service.ts:21`).
- `docker-compose.prod.yml` ne déclare aucune `mem_limit` : sur un Droplet
  unique, l'OOM killer emporte Mongo avec l'API (`render-gate.ts:16-18`).

Un « export tous scénarios » à 3 scénarios coûte donc **3 fois** la ressource la
plus rare du système, et ce coût se paie de deux façons, toutes deux mauvaises :

- **3 appels séquentiels à `gate.run()` dans une seule requête** : la requête
  prend et rend le jeton trois fois, peut être doublée entre deux prises, et
  monopolise en pratique un des deux jetons — la file de 8 des autres
  utilisateurs expire à 20 s.
- **Un seul rendu d'un document HTML trois fois plus long** : un seul jeton, mais
  `PAGE_TIMEOUT_MS = 15_000` devient contraignant et l'empreinte mémoire de la
  page croît d'autant.

**Si le PDF multi-scénarios est exigé commercialement**, il fait l'objet d'un lot
séparé et il est **obligatoirement** de la seconde forme (un seul rendu d'un seul
document concaténé, jamais N rendus par requête), livré avec une nouvelle mesure
du portillon et, si nécessaire, la file d'export asynchrone `ExportJob` que
`docs/15-DATABASE.md:40` prévoit et que personne n'a jamais implémentée.

Ce qui est en revanche peu coûteux et **autorisé** : ajouter au PDF d'**un**
scénario une section « comparaison » — un tableau de N colonnes dans le même
document, donc toujours **un seul rendu**. Décidé sur le principe, calé au § lot 3.

#### 5.3 Métadonnées et traçabilité des exports

- `docs/23-RAPPORTS-EXPORTS.md:20` fait du scénario une métadonnée **obligatoire**
  de tout export. La page de garde du PDF et la feuille « Métadonnées » du
  classeur portent donc `scenarioKey` + `scenarioLabel`, y compris pour un projet
  mono-scénario.
- Interaction `?planVersion=` × `?scenario=` : `planVersion` identifie déjà un
  plan unique (§ 1.5 b), lequel porte son `scenarioId`. Donc **`planVersion`
  gagne** ; si les deux sont fournis et se contredisent →
  `400 { code: 'SCENARIO_PLAN_MISMATCH' }`. Jamais de résolution silencieuse.
- R4 (ADR-0012 §6) : `journaliserExport` (`reports.controller.ts:281-303`) ajoute
  `scenarioId` à ses métadonnées. L'échec d'écriture du journal continue
  d'annuler l'export.
- Le filigrane `free` reste décidé côté API depuis les entitlements
  (`reports.controller.ts:159-160`, `:202`) et s'applique identiquement à tous
  les scénarios.

### 6. Découpage en lots parallélisables

Règle inchangée depuis ADR-0011 et ADR-0012 : **un fichier = un seul écrivain**.
Toute exception passe par le CTO. Trois fichiers échappent à la règle et sont
régis ci-dessous par un régime d'ajout seul.

#### Vue d'ensemble

| Lot | Titre | Dépend de | Peut démarrer |
|---|---|---|---|
| **1** | Modèle et API des scénarios | — | immédiatement |
| **2** | Moteur multi-scénarios et comparaison | 1 (types seuls) | après la PR 1-A |
| **3** | Plans et exports par scénario | 1 | après la PR 1-A |
| **4** | Web — sélection du scénario dans le parcours | 1 | après le merge de 1 |
| **5** | Web — vue Comparaison | 1, 2 | après le merge de 2 |

**Lot 1 livre en deux PR.** *1-A* : schéma `scenario.schema.ts`, types de vue,
migration, `ScenariosService` — aucune route. *1-B* : le contrôleur et les
routes. Les lots 2, 3 et 4 démarrent dès le merge de **1-A**, contre des types,
sans attendre les routes. C'est ce qui rend le parallélisme réel plutôt que
théorique.

**Ordre de merge : 1-A → 1-B → { 2, 3, 4 } dans n'importe quel ordre → 5.**

#### Lot 1 — Modèle et API des scénarios

**Possède** (crée ou modifie, écrivain unique) :

```
apps/api/src/scenarios/scenario.schema.ts                   (nouveau)
apps/api/src/scenarios/scenarios.service.ts                 (nouveau)
apps/api/src/scenarios/scenarios.controller.ts              (nouveau)
apps/api/src/scenarios/scenarios.dto.ts                     (nouveau)
apps/api/src/scenarios/scenarios.module.ts                  (nouveau)
apps/api/src/scenarios/scenarios.controller.test.ts         (nouveau)
apps/api/migrations/20260809-0002-scenario-de-reference.mjs (nouveau)
apps/api/src/projects/project.schema.ts                     (_schemaVersion 3)
apps/api/src/projects/projects.service.ts
apps/api/src/projects/projects.controller.ts
apps/api/src/projects/projects.dto.ts
apps/api/src/billing/entitlements.ts
apps/api/src/billing/entitlements.test.ts
apps/web/src/app/(marketing)/pricing/_components/pricing-model.ts   (uniquement la ligne « Scénarios par projet »)
apps/api/src/__tests__/scenarios.e2e.test.ts                (nouveau)
```

**Ne touche pas** : `apps/api/src/plans/**`, `apps/api/src/reports/**`,
`apps/api/src/actuals/**`, `apps/api/src/objectives/**`, `packages/engine/**`,
`apps/api/src/authz/permissions.ts`, `apps/api/src/authz/permissions.test.ts`,
tout `apps/web/src/app/(app)/projects/**`, `apps/web/src/lib/api.ts`.

#### Lot 2 — Moteur multi-scénarios et comparaison

**Possède** :

```
packages/engine/src/evaluator/multi-scenario.ts             (nouveau)
packages/engine/src/evaluator/multi-scenario.test.ts        (nouveau)
packages/engine/src/index.ts                                (bloc d'export ajouté en fin de fichier)
apps/api/src/scenarios/comparison.ts                        (nouveau)
apps/api/src/scenarios/comparison.test.ts                   (nouveau)
apps/api/src/scenarios/scenario-comparison.controller.ts    (nouveau)
```

**Ne touche pas** : `packages/engine/src/evaluator/index.ts` (sauf ajout de
`EvaluateOptions` au barrel, à faire dans `index.ts`, pas ici),
`packages/engine/src/compiler/**`, `packages/engine/src/etats-financiers/**`,
`packages/engine/src/amortissements/**`, **aucun fichier YAML de template**,
`apps/api/src/plans/**`, `apps/api/src/reports/**`, tout `apps/web/**`, et les
six autres fichiers de `apps/api/src/scenarios/` qui appartiennent au lot 1.

Interdiction explicite : **le lot 2 ne modifie aucune formule, aucune ligne,
aucun driver.** `ENGINE_VERSION` (`packages/engine/src/index.ts:7`) **ne bouge
pas** — aucun calcul ne change, donc aucune empreinte de plan validé ne doit
changer. Si le lot 2 se retrouve à devoir toucher un chiffre, c'est qu'il a
dérivé : il remonte au CTO.

#### Lot 3 — Plans et exports par scénario

**Possède** :

```
apps/api/src/plans/plan.schema.ts                (scenarioId, scenarioKey, _schemaVersion 2)
apps/api/src/plans/plans.service.ts              (supersede + PLAN_UNCHANGED scopés scénario)
apps/api/src/plans/plans.controller.ts           (corps optionnel { scenarioId }, SoD depuis le scénario)
apps/api/src/reports/reports.controller.ts       (?scenario=, SCENARIO_PLAN_MISMATCH, audit)
apps/api/src/reports/report-html.ts              (métadonnées scénario en page de garde)
apps/api/src/reports/report-xlsx.ts              (?scenarios=all, feuille Comparaison)
apps/api/src/actuals/actuals.controller.ts       (référence = plan du scénario de référence)
apps/api/src/objectives/objectives.controller.ts (idem)
apps/api/src/__tests__/plans.e2e.test.ts         (cas multi-scénarios ajoutés, existants inchangés)
```

**Ne touche pas** : `apps/api/src/plans/fingerprint.ts` — **la définition de
l'empreinte est gelée** (§ 1.5) ; `apps/api/src/scenarios/**` ;
`packages/engine/**` ; `apps/api/src/authz/**` ; tout `apps/web/**` ;
`apps/api/src/reports/render-gate.ts` et `reports.service.ts` — les bornes de
rendu ne se règlent pas depuis un lot fonctionnel.

#### Lot 4 — Web : sélection du scénario dans le parcours

**Possède** :

```
apps/web/src/app/(app)/projects/_components/project-plan.tsx
apps/web/src/app/(app)/projects/_components/scenario-switcher.tsx   (nouveau)
apps/web/src/app/(app)/projects/_components/use-autosave.ts         (si le flush au changement l'exige)
apps/web/src/app/(app)/projects/[id]/page.tsx
```

**Ne touche pas** : `wizard-model.ts`, `wizard-field.tsx`, `wizard-progress.tsx`,
`wizard-summary.tsx` (le wizard n'a pas à savoir ce qu'est un scénario — il
reçoit des valeurs et les rend), `project-tabs.tsx` (lot 5),
`sheet-tabs.tsx`, `etats-financiers-tables.tsx`, `amortissements-table.tsx`,
`actuals-*`, tout `apps/api/**`, tout `packages/**`.

#### Lot 5 — Web : vue Comparaison

**Possède** :

```
apps/web/src/app/(app)/projects/[id]/comparaison/page.tsx            (nouveau)
apps/web/src/app/(app)/projects/[id]/_components/scenario-comparison.tsx  (nouveau)
apps/web/src/app/(app)/projects/[id]/_components/project-tabs.tsx    (une entrée ajoutée à PROJECT_TABS)
```

**Ne touche pas** : `project-plan.tsx` (lot 4), tout `projects/_components/`,
tout `apps/api/**`, tout `packages/**`.

#### Les trois fichiers partagés, et leur régime

| Fichier | Lots concernés | Régime |
|---|---|---|
| `apps/api/src/app.module.ts` | 1, 2 | **ajout d'imports de module uniquement**, une ligne par lot. Conflits triviaux. Régime hérité d'ADR-0011. |
| `apps/api/src/authz/routes-coverage.test.ts` | 1, 2 | **ajout dans la liste `CONTROLEURS` uniquement** — un import et une entrée par nouveau contrôleur. Ce fichier confronte sa liste au nombre réel de fichiers `*.controller.ts` : **tout nouveau contrôleur le casse tant qu'il n'y est pas inscrit.** C'est voulu. Aucun lot ne touche `SANS_PERMISSION` : toutes les routes de ce chantier portent une permission. |
| `apps/web/src/lib/api.ts` (1 605 lignes) | 4, 5 | **ajout seul, un bloc contigu par lot, en fin de section** : types de vue puis méthodes sur l'objet `api`. Aucune signature existante n'est modifiée ni renommée. Le lot 4 merge avant le lot 5 ; en cas de conflit, le lot 5 rebase. |

**Fichiers interdits à tous les lots** :
`apps/api/src/authz/permissions.ts`, `apps/api/src/authz/permissions.test.ts`
(aucune action nouvelle, § 3.3), `apps/api/src/plans/fingerprint.ts` (§ 1.5),
`packages/engine/src/templates/*.yaml`, `packages/engine/src/index.ts:7`
(`ENGINE_VERSION`), `apps/api/src/reports/render-gate.ts`.

## Conséquences

- Une collection nouvelle : `scenarios`. Une migration nouvelle
  (`20260809-0002`), la deuxième du dépôt.
- `projects` passe en `_schemaVersion: 3`, `financial_plans` en
  `_schemaVersion: 2`. `Project.driverValues` et `Project.driversUpdatedBy`
  deviennent des vestiges lisibles, retirés par un ticket ultérieur.
- Un projet peut porter plusieurs plans `approved` simultanément — au plus un par
  scénario. C'est un changement de sens de l'invariant S16c, qui supposait un
  unique plan `approved` par projet.
- Les numéros de version de plan restent uniques et monotones par projet ;
  `?planVersion=N` ne change pas de sens et les tests e2e existants restent verts.
- La définition de l'empreinte SHA-256 est inchangée ; aucune empreinte existante
  n'est invalidée. `ENGINE_VERSION` reste `0.2.0`.
- `permissions.ts` n'est pas modifié : les 210 assertions de `permissions.test.ts`
  restent valides sans réécriture.
- `maxScenariosPerProject` entre au catalogue des entitlements ; la ligne
  « Scénarios par projet » de la page tarifs devient une limite **appliquée**.
- Le PDF reste mono-scénario. Un utilisateur qui veut trois scénarios en PDF fait
  trois exports — et chacun coûte un jeton du portillon.
- `docs/07`, `docs/16`, `docs/22` et `docs/23` sont à amender (ci-dessous). Ils ne
  le sont pas dans cet ADR : la convention du dépôt, vérifiée sur les commits
  `5b4ee76` (ADR-0011) et `07cf573` (ADR-0012/0013), est qu'une PR d'ADR ne
  contient que l'ADR. Les mises à jour de documents suivent le lot qui les rend
  vraies.

### Contradictions de documentation à arbitrer

1. **`docs/22-WORKFLOWS.md:11-15` — machine d'état du scénario.**
   `draft → ready → calculating → calculated → approved` suppose un calcul
   asynchrone qui n'existe pas et qui n'est pas souhaitable à cette échelle.
   Décision : pas d'état sur le scénario (§ 1.6). `docs/22` à amender.
2. **`docs/16-API.md:25-27,40` — ressource `scenarios` de premier niveau.**
   `/v1/scenarios/{id}/inputs` et `/v1/scenarios/{id}/calculations` sont écartés
   au profit de l'imbrication sous `/projects/:id/`, sans préfixe `/v1`
   (ADR-0011 § Contrat 4, déjà entériné). `docs/16` à corriger — ce sera la
   cinquième divergence connue entre `docs/16` et le code.
3. **`docs/15-DATABASE.md:60` — `FinancialPlan.scenarioId`.** Conforme : le champ
   est ajouté. Mais `docs/15` liste aussi `inputSetVersion` et
   `countryPackVersion`, que le code nomme autrement (`templateVersion`,
   `packVersion`). Divergence de nommage préexistante, hors périmètre.
4. **`docs/13-PRICING.md:27` vs page tarifs.** `docs/13` décrit quatre packs avec
   des scénarios « limité / plusieurs / avancé / avancé » ; la page en publie
   trois avec des nombres (1 / 3 / 3). Comme en S16b, **la page fait foi** parce
   qu'elle est publique. `docs/13` reste à réconcilier — divergence déjà
   documentée à `docs/13:96` et `:101-107`.

## Décisions ouvertes — remontées au décideur

Aucune n'est tranchée ici. Chacune porte ses options et leur coût.

1. **Business ne promet pas plus de scénarios que Pro (3 et 3,
   `pricing-model.ts:135`).** Le palier à 49 USD n'offre donc, sur cet axe, rien
   de plus que celui à 9 USD. Options : (a) laisser tel quel — coût : un
   argumentaire de vente en moins, et `docs/13:27` (« plusieurs » vs « avancé »)
   reste faux ; (b) relever Business à N > 3 — coût : changer une promesse
   publique déjà en ligne, et vérifier que le PDF et l'Excel tiennent au-delà de
   3 colonnes. Décision **commerciale**, pas technique.

2. **Un projet peut-il légitimement porter plusieurs plans validés ?**
   J'ai tranché « oui, un par scénario » (§ 1.5 c) parce que
   `docs/07:54` dit que les scénarios ont « leurs propres résultats ». Mais
   `docs/07 § Version validée` est écrit au singulier, et un dossier bancaire qui
   contient trois plans validés simultanés peut se lire comme trois engagements.
   Option alternative : un seul plan validé par projet, le scénario retenu — coût :
   on ne peut plus figer un prudent sans désapprouver la base, ce qui interdit
   d'archiver la comparaison qui a été montrée à la banque. **Question de
   bancabilité, pas d'architecture.**

3. **Changer le scénario de référence : rétroactif ou non ?**
   Les écarts du réalisé déjà affichés, et les périodes déjà clôturées, ont été
   calculés contre l'ancienne référence. Options : (a) **forward-only** — chaque
   `actual_period` mémorise la référence en vigueur à sa clôture ; coût : un
   champ de plus sur `actual_periods` et une lecture plus complexe, mais aucun
   chiffre montré ne change jamais ; (b) **rétroactif** — coût : un écart affiché
   hier change aujourd'hui sans qu'aucune écriture n'ait eu lieu, ce qui heurte
   frontalement l'esprit de `docs/07 § Version validée`. Je penche pour (a) mais
   c'est un arbitrage produit sur la lisibilité du suivi, et le lot 3 ne peut pas
   démarrer sur cette partie sans la réponse.

4. **Sensibilité sur les paramètres pays.** Cet ADR interdit à un scénario de
   changer de `parameterPackSlug` (§ 1.1). Le besoin « et si l'IBP passait à
   35 % ? » est donc non couvert. Est-il réel ? Si oui, c'est un produit distinct
   (analyse de sensibilité), pas une variante de ce chantier — coût d'inclusion :
   la comparaison devient inter-packs et les métadonnées d'export doivent porter
   deux versions de pack.

5. **PDF multi-scénarios.** Tranché « non » ici, avec les chiffres (§ 5.2). S'il
   est exigé, il coûte un lot dédié, un rendu unique concaténé, une nouvelle
   mesure du portillon, et probablement la file `ExportJob` jamais implémentée.
   Décision de coût d'exploitation.

6. **Bibliothèque de graphiques.** Une comparaison de trois scénarios sur cinq
   exercices se lit mieux en graphe qu'en tableau. Le dépôt n'a aucune dépendance
   de charting, et `docs/23` exige des « graphiques accessibles ». Coût : une
   dépendance, un travail d'accessibilité, un rendu correct en thème sombre et
   dans le PDF (où le graphe devrait être rendu côté serveur). Décision produit.

7. **« Résultat reporté conformément à la règle du scénario »
   (`docs/07-PLAN-FINANCIER.md:49`).** Cette phrase figure dans les invariants du
   plan financier et **aucun document du dépôt ne définit ce qu'est la "règle du
   scénario"**. Le moteur, lui, cumule les résultats sans règle paramétrable
   (`etats-financiers/index.ts`, capitaux propres = capital apporté + résultats
   cumulés). Je **n'invente pas** cette règle. Si elle existe côté métier
   (affectation en réserves, distribution de dividendes, report à nouveau), elle
   doit être sourcée et datée avant d'être implémentée, et elle relève d'un
   expert-comptable — pas de cet ADR.

8. **Libellés normés ou libres ?** J'ai retenu `key` et `label` libres, avec
   « base / prudent / ambitieux » proposés par défaut (`docs/07:54` dit « au
   minimum »). Si l'IA ou le dossier bancaire doivent raisonner sur le *type* de
   scénario (« montre-moi le pessimiste »), il faut un champ normé en plus du
   libellé libre — coût : une union fermée de plus à faire vivre, et une question
   de traduction. À trancher avant le lot 4, qui affiche les libellés.

## Plan de validation

- **Revue CTO de chaque PR** contre les périmètres du § 6. Une PR qui touche un
  fichier hors de son lot est renvoyée, sans discussion sur le fond.
- **CI verte** (tests, lint, typecheck, format) sur chaque PR. Les 1 291 tests de
  `main` passent **sans modification** ; modifier un test existant exige une
  justification en description de PR (règle ADR-0011, reconduite). Les seules
  modifications de tests attendues sont des **ajouts** de cas.
- **Lot 1** : migration rejouée deux fois (idempotence) ; projet sans scénario →
  auto-réparé, jamais 500 ; unicité du scénario de référence vérifiée par une
  écriture concurrente qui doit échouer sur l'index partiel ; limite d'entitlement
  (Free = 1) testée en 403 ; suppression du scénario de référence et d'un scénario
  porteur d'un plan validé testées en 409 ; isolation cross-tenant en 404.
- **Lot 2** : `evaluateScenarios` donne, champ par champ, **exactement** les mêmes
  résultats que N appels séparés à `evaluateTemplate` — sur les 3 templates
  sectoriels × 7 jeux déformants (`etats-financiers.test.ts:74-91`). Invariant
  d'équilibre `|ecart_equilibre| ≤ 0,01` vérifié **par scénario** et par exercice,
  sur les 5 exercices. Aucune valeur non finie. Mesure avant/après de la
  compilation partagée publiée dans la PR.
- **Lot 3** : figer le scénario B ne bascule pas le plan du scénario A en
  `superseded` ; deux scénarios aux drivers identiques peuvent être figés tous
  les deux (pas de `PLAN_UNCHANGED` croisé) ; re-figer le même scénario inchangé
  renvoie bien `409 PLAN_UNCHANGED` ; `?planVersion=N` sur un plan de scénario B
  avec `?scenario=A` → `400 SCENARIO_PLAN_MISMATCH` ; l'audit d'export porte le
  `scenarioId` ; échec d'écriture d'audit → export annulé (R4 inchangé) ; la
  séparation des tâches lit bien `scenario.driversUpdatedBy`.
- **Lot 4** : **changer de scénario avec une sauvegarde en vol n'écrit jamais dans
  le mauvais scénario** — test explicite, c'est le risque numéro un du chantier ;
  `?scenario=` survit à un rechargement ; un projet mono-scénario affiche le
  parcours d'avant, sans sélecteur superflu.
- **Lot 5** : base nulle → `ecartPct: null` + raison, jamais une division par
  zéro ; scénario sans plan validé en mode `approved` → tiret + raison, jamais 0 ;
  tableau défilable horizontalement sans faire défiler la page ; statut jamais
  porté par la seule couleur.
- **Après le merge des cinq lots** : parcours complet manuel — créer un projet,
  dupliquer la base en « prudent », dégrader deux drivers, comparer, figer les
  deux scénarios, exporter chacun en PDF et les deux en Excel, saisir une période
  réalisée, vérifier que l'écart se lit bien contre le scénario de référence.
  Chiffres identiques entre API, tableaux web et exports (critère docs/25 S14).

## Liens

- `docs/02-PRODUIT.md`, `docs/06-WIZARD.md`, `docs/07-PLAN-FINANCIER.md`
  (§ Scénarios, § Version validée, § Invariants), `docs/08-PREVISIONNEL-REALISE.md`,
  `docs/12-ROLES-PERMISSIONS.md`, `docs/13-PRICING.md`, `docs/15-DATABASE.md`,
  `docs/16-API.md`, `docs/21-MOTEUR-FINANCIER.md`, `docs/22-WORKFLOWS.md`,
  `docs/23-RAPPORTS-EXPORTS.md`, `docs/26-CONVENTIONS.md`
- ADR-0004 (transactions, `_schemaVersion`, migrations), ADR-0005 (HyperFormula),
  ADR-0007 (génération PDF/Excel), ADR-0010 (Excel export only),
  ADR-0011 (contrats d'intégration, 404 cross-tenant, français métier des ids DSL,
  § Contradictions 5 qui gelait ce sujet), ADR-0012 (RBAC, R2/R3/R4)
- `packages/engine/src/evaluator/index.ts` (`HORIZON_PROJECTION_DEFAUT`,
  `evaluateCompiled`), `packages/engine/src/etats-financiers/index.ts`
  (équilibre par construction), `apps/api/src/plans/fingerprint.ts` (empreinte
  gelée), `apps/api/src/authz/permissions.ts` (matrice non modifiée),
  `apps/api/src/reports/render-gate.ts` (coût marginal du PDF)
