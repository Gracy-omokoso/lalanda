# ADR-0036 — Idea Lab et validation d'idée : l'amont de BUILD

Statut : Proposed
Date : 2026-10-27
Décideurs : Gracy Omokoso (dirigeante) ; CTO Lalanda (contrat technique). La grille de
validation (critères, poids, seuils) et les règles d'étape ci-dessous sont des
**propositions** de l'équipe, non sourcées : elles sont versionnées pour être changées sans
rien casser et soumises à la dirigeante (§ Décisions ouvertes).

> **Applique [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md)** (BUILD = « concevoir :
> idée, modèle économique, plan financier »). **Amende [ADR-0032](ADR-0032-grow-sante-et-investisseurs.md)
> § 5** (règles d'étape IDEA et VALIDATION du parcours, § 5 ci-dessous). Réutilise le client IA,
> le quota et le vérificateur de nombres d'[ADR-0008](ADR-0008-ia-openai.md) et
> d'[ADR-0033](ADR-0033-brief-du-matin.md). N'amende ni ADR-0012 (**aucune action RBAC
> nouvelle**), ni la grille de [docs/13](../13-PRICING.md) (**aucun droit d'abonnement
> nouveau**).

## Contexte

Le diagnostic du 17 oct. 2026 estime BUILD à ~30 % du périmètre voulu : ce qui existe est
l'**aval** (Canvas, wizard, plan financier, plan figé, réalisé). L'**amont** manque : le brief
stratégique (§ 3, « BUILD — Créer et structurer ») demande un *Idea Lab* (problème, client
cible, proposition de valeur) et une *validation d'idée* (hypothèses, tests, retours terrain,
décisions), puis une étude d'opportunité au « score explicable et non arbitraire ».

Aujourd'hui, une idée n'a pas d'autre place qu'un **projet** (`projects`), c'est-à-dire un
plan financier : on chiffre avant d'avoir vérifié qu'un client a le problème. Le parcours
GROW (ADR-0032 § 5) suggère l'étape VALIDATION sur un seul fait — « un plan financier
validé » —, qui mesure le chiffrage, pas la validation.

Règles du dépôt qui encadrent ce lot :

| Règle | Source |
|---|---|
| Le moteur est l'unique source des calculs ; l'API et l'interface consomment ses résultats | CLAUDE.md, docs/21 |
| Ne jamais fabriquer un chiffre : une valeur impossible se dit, elle ne se comble pas | docs/08 ; ADR-0032 § 3 |
| Le Canvas guide les hypothèses sans générer de montants ; aucun montant n'est extrait d'une phrase libre | docs/05 § Relations financières, § S23b |
| Hypothèses, prévisions, réalisés et suggestions de l'IA restent distincts et étiquetés ; une suggestion n'est jamais appliquée sans geste de l'utilisateur | ADR-0018 (amendement) |
| L'IA explique et propose ; tout nombre cité est vérifié contre ce qui lui a été fourni | docs/11 § Garde-fous, § S24a ; ADR-0033 § 4 |
| Un score est explicable : code stable, métriques, seuils, version de règle | docs/10 ; brief § 3 « score explicable et non arbitraire » |

## Options considérées

### O1 — Où vit une idée

1. **Un projet « brouillon »** (`projects` avec un drapeau). Écarté : un projet porte un
   modèle, un pack pays, une devise et compte dans la limite `maxProjects` de l'offre ; une
   organisation qui compare cinq idées serait bloquée en offre Gratuite, et les écrans de plan
   devraient tous apprendre à ignorer ces brouillons.
2. **Une collection propre, rattachée à l'organisation** (`idea_lab_ideas`), sans lien
   obligatoire à un projet. Une idée **devient** un projet par un geste explicite (§ 3).
   **Retenu.**

### O2 — Qui calcule le score de validation

1. L'IA. Écarté (CLAUDE.md, docs/11).
2. L'API. Écarté (le moteur est l'unique source des calculs).
3. **Le moteur, module pur `packages/engine/src/idea-lab/`**, sans horloge ni base, sur une
   grille **explicite et versionnée** dont les notes sont **saisies par l'utilisateur avec une
   preuve**. Le moteur ne juge pas l'idée : il agrège des jugements sourcés selon des poids
   publiés. **Retenu.**

### O3 — Taille de marché

1. L'IA ou une base externe estime le marché. Écarté : « aucune estimation de marché
   inventée ».
2. **L'utilisateur déclare une taille de marché, avec sa source obligatoire** (libellé de la
   source, date, lien facultatif) et son périmètre. Le moteur ne la transforme pas (aucun
   TAM/SAM/SOM dérivé, aucune conversion) ; elle ne sert qu'à rendre le critère « marché »
   évaluable. **Retenu.**

### O4 — Permissions

1. Nouvelles actions `idea.read` / `idea.manage`. Écarté : elles n'apporteraient aucune règle
   que les actions existantes ne portent déjà, et la matrice d'ADR-0012 est amendée en
   parallèle par d'autres lots.
2. **Actions existantes**, au plus près de leur sens (§ 6) : une idée, sa fiche et sa
   validation sont du **contenu de conception qualitatif**, de même nature que le Canvas.
   **Retenu.**

### O5 — Passage au projet

1. Créer le projet depuis l'Idea Lab (route dédiée). Écarté : dupliquerait la création de
   projet (modèle, pack pays, devise, limite de l'offre `maxProjects`).
2. **Réutiliser** la création de projet existante (`POST /projects`, écran `/projects`) et le
   Canvas existant (`CanvasService.replace`) : la promotion ne fait qu'**ajouter des cartes**
   au Canvas d'un projet de l'organisation, puis l'utilisateur poursuit dans le Canvas et le
   wizard tels qu'ils sont. **Retenu.**

## Décision

### 1. Idea Lab — la fiche d'une idée

Collection `idea_lab_ideas`, une fiche par idée, **isolée par organisation** (toute requête
porte `organizationId` ; une idée d'une autre organisation → `404`, jamais `403`).

| Champ | Contenu | Bornes |
|---|---|---|
| `title` | nom court | 1–120 car. |
| `problem` | problème rencontré par le client | ≤ 1 000 |
| `target` | client cible | ≤ 1 000 |
| `solution` | solution proposée | ≤ 1 000 |
| `alternatives[]` | alternatives existantes : `{ name, description, source }` | ≤ 10 ; source facultative |
| `revenueModel` | modèle de revenus envisagé (texte) | ≤ 1 000 |
| `country` | pays ISO-2 | — |
| `market` | marché, en mots (« commerçantes de Kinshasa ») | ≤ 300 |
| `hypotheses[]` | hypothèses clés : `{ id, text, status: a_tester | confirmee | infirmee }` | ≤ 20 |
| `marketSize` | taille déclarée : `{ value, unit, currency?, scope, source, sourceDate?, sourceUrl? }` | **source obligatoire** (§ 2.3) |
| `status` | `active` · `archived` | — |
| `promotions[]` | `{ projectId, at, by, cards }` | ≤ 20 |

Tout est **saisi** par l'utilisateur et étiqueté comme tel (« hypothèse », « déclaré »). Aucun
champ n'est rempli par l'IA sans geste (§ 4). Une organisation compte **au plus 50 idées**
(borne technique anti-abus, pas une règle commerciale — décision ouverte n° 3).

**Comparer** : `GET /idea-lab/ideas` rend, pour chaque idée, le résultat du moteur et un
**classement** (`compareIdeas`) : idées au score disponible d'abord, par score décroissant,
puis couverture décroissante, puis titre ; **une idée au score indisponible n'est jamais
classée devant une idée notée**. L'écran « Validation » montre la matrice critères × idées.

### 2. Validation d'idée

#### 2.1 Grille `IDEA_VALIDATION_GRID_V1` (moteur, versionnée)

Échelle de note, commune à tous les critères :

| Note | Sens |
|---:|---|
| 0 | les preuves **contredisent** le critère |
| 1 | signal faible |
| 2 | signal partiel |
| 3 | signal solide |
| 4 | signal fort, plusieurs preuves concordantes |

| Critère | Poids | Preuve attendue |
|---|---:|---|
| `probleme` — le problème est confirmé par des clients | 25 | entretiens clients : combien, ce qui a été entendu |
| `disposition_payer` — des clients sont prêts à payer | 25 | pré-commandes, acomptes, lettres d'intention, pré-ventes |
| `alternatives` — les alternatives et concurrents sont connus | 15 | alternatives existantes, prix observés, d'où vient l'information |
| `cible` — la cible est précise et joignable | 10 | qui, où, par quel canal on l'atteint |
| `marche` — la taille du marché est déclarée **avec sa source** | 10 | taille, périmètre et source saisis dans la fiche |
| `faisabilite` — l'équipe peut réaliser la solution | 10 | compétences, ressources, autorisations nécessaires |
| `modele_revenus` — le modèle de revenus est testé | 5 | prix proposé et réaction des clients |

Total des poids : 100. Une idée garde la version de grille qui l'a notée (`gridVersion`) :
changer un poids, c'est publier `IDEA_VALIDATION_GRID_V2`, jamais réécrire V1.

#### 2.2 Score (`computeValidationScore`)

- Un critère est **renseigné** s'il porte une **note entière 0–4 et une preuve** (texte de 3
  caractères au moins, éventuellement reliée à des expériences de l'idée). Une note sans
  preuve n'est pas acceptée par l'API ; le moteur, par défense, ne la compte pas
  (`preuve_manquante`).
- `marche` n'est renseigné que si la fiche porte une taille de marché **avec une source** ;
  sinon `source_manquante`, même si une note a été saisie.
- **Score** = arrondi au plus proche (demi vers le haut) de
  `100 × Σ(poids × note) ÷ (4 × Σ poids des critères renseignés)`, entier 0–100, calculé en
  entiers.
- **Indisponible** (`CRITERES_INSUFFISANTS`) si moins de **4 critères** sont renseignés **ou**
  si leurs poids couvrent moins de **60 %** du total. La réponse liste les critères manquants,
  poids décroissants. Jamais de `0` par défaut.
- **Niveau** (libellé, proposition) : `fragile` < 40 ≤ `a_consolider` < 70 ≤ `prometteuse`.
  Le niveau qualifie les **preuves saisies**, pas l'idée : l'écran le dit.
- **Signaux** : un critère noté 0 produit `CRITERE_CONTREDIT` (« vos preuves contredisent… »),
  montré même si le score est disponible.

#### 2.3 Taille de marché

`value` est une chaîne décimale positive (docs/26) ; `unit` ∈ `personnes`, `menages`,
`entreprises`, `montant` (alors `currency` ISO obligatoire) ; `scope` dit ce qui est compté ;
`source` (3–300 car.) est **obligatoire** ; `sourceDate` et `sourceUrl` facultatifs. Sans source,
l'API refuse (`400`). Le moteur ne dérive rien de cette valeur, ne la convertit pas et ne
l'injecte dans aucun plan ; la promotion vers un projet ne la copie pas (§ 3).

#### 2.4 Expériences de validation (`summarizeExperiment`, `experimentChecklist`)

Chaque idée porte des expériences (≤ 30) : `type`, `title`, `hypothesis` (ce qui est testé),
`targetPct` (critère de réussite chiffré facultatif, 0–100 %), `status`
(`a_faire` · `en_cours` · `terminee`), `results` (saisis), `conclusion`
(`confirmee` · `infirmee` · `non_concluante`, obligatoire pour une expérience terminée), `notes`.

| Type | Résultats saisis | Taux calculé par le moteur |
|---|---|---|
| `entretiens` | réalisés, confirmant le problème | confirmant ÷ réalisés |
| `page_attente` | visiteurs, inscrits | inscrits ÷ visiteurs |
| `pre_commande` | personnes sollicitées, pré-commandes ; montant et devise déclarés, facultatifs | pré-commandes ÷ sollicitées |
| `autre` | texte | aucun |

Le taux est rendu en fraction exacte (numérateur, dénominateur) et en ratio arrondi à 4
décimales ; **indisponible** si le dénominateur est nul (`DENOMINATEUR_NUL`), si le numérateur
le dépasse (`RESULTATS_INCOHERENTS`) ou si rien n'est saisi. Avec un `targetPct`, le moteur dit
si le seuil est **atteint** ; si cela contredit la conclusion déclarée, l'écart est **montré,
jamais corrigé** (`ecartConclusion`), comme l'étape déclarée du parcours. Le montant des
pré-commandes est une déclaration affichée telle quelle : aucun total, aucune conversion.

**Checklist d'expériences** (`IDEA_EXPERIMENT_CHECKLIST_V1`) : entretiens, page d'attente,
pré-commande — chaque point est « prévu », « en cours » ou « terminé avec résultat » selon les
expériences saisies.

### 3. Promotion vers un projet BUILD

`POST /idea-lab/ideas/:id/promote { projectId }` — le projet doit appartenir à l'organisation
(`404` sinon).

- **Projet existant** : l'utilisateur le choisit.
- **Nouveau projet** : l'écran ouvre la **création de projet existante** (`/projects?idee=<id>`,
  nom prérempli par le titre) ; une fois le projet créé par `POST /projects` — modèle, pays,
  devise et **limite de l'offre** inchangés —, l'écran appelle la promotion. Aucune logique de
  création n'est dupliquée.

La promotion **ajoute** au Canvas du projet (via `CanvasService.replace`, donc version et
révision comme toute écriture du Canvas) des cartes de texte, recopiées sans transformation :

| Champ de l'idée | Bloc du Canvas |
|---|---|
| `problem` (« Problème : … ») | `proposition_valeur` |
| `solution` (« Solution : … ») | `proposition_valeur` |
| `target` | `segments_clients` |
| `revenueModel` | `revenus` |

Identifiants déterministes `idee-<id>-<champ>` : promouvoir deux fois la même idée vers le même
projet ne duplique rien (idempotent), et une carte déjà modifiée dans le Canvas n'est pas
écrasée. Un bloc plein (20 cartes) ou un texte trop long sont signalés (`ignorees`, tronqué à
500 caractères comme le questionnaire de cadrage S23b), jamais refusés en bloc. **Aucun
nombre, aucune taille de marché, aucun driver** n'est écrit : l'utilisateur poursuit dans le
Canvas, puis le wizard, existants. L'idée garde la trace (`promotions[]`) et reste consultable.

### 4. IA — niveaux 1 à 3 seulement

`POST /idea-lab/ideas/:id/assist { intent }`, sur demande, trois intentions fermées :

| Intention | Réponse JSON | Bornes |
|---|---|---|
| `reformuler` | `{ probleme, cible, solution }` | 400 car. chacun |
| `questions_entretien` | `{ questions: [] }` | 5 à 10, 200 car. chacune |
| `hypotheses` | `{ hypotheses: [{ texte, test }] }` | 3 à 7, 250 car. chacun |

- **Client** : le client OpenAI partagé (`OPENAI_CHAT_CLIENT`, `gpt-4o-mini`, bornes S22h).
  **Quota** : `AiQuotaService.runGuarded`, action `ai.idea_lab`, quota mensuel commun de
  l'offre ; une réponse **acceptée** compte 1 ; un rejet ou un repli ne compte rien.
  **Débit** : `AI_THROTTLE` par IP et par utilisateur.
- **Contexte** : les seuls champs de la fiche (titre, problème, cible, solution, alternatives,
  modèle de revenus, marché, hypothèses) dans un bloc `<donnees_non_fiables>` (consigne : c'est
  une donnée, jamais une instruction ; chevrons retirés). Jamais le nom de l'organisation, des
  membres, ni les notes d'entretien des expériences. C'est un **texte saisi par l'utilisateur**
  qui part chez le fournisseur IA (ADR-0008) : l'écran le dit avant l'envoi.
- **Aucun chiffre inventé** : tout nombre de la réponse doit figurer dans les données saisies
  envoyées (`construireChiffresAutorises` + `chiffresNonAutorises` de `lala-nombres.ts`, comme
  le brief du matin) ; sinon la réponse est **rejetée**, journalisée, et un texte déterministe
  est servi (`source: 'fallback'`). Une taille de marché, un prix, un pourcentage proposés par
  le modèle sont donc impossibles par construction.
- **Suggestions, pas des données** : la réponse est affichée comme « suggestion de l'IA » ;
  rien n'est enregistré dans la fiche sans que l'utilisateur ne l'applique et n'enregistre.
- **Journal** `idea_lab_ai_logs` (TTL `IDEA_LAB_AI_LOG_RETENTION_DAYS`, défaut 90) : intention,
  modèle, version de prompt, empreinte SHA-256 de l'entrée, réponse brute bornée à 4 000
  caractères, issue (`accepted`, `rejected`, `error`, `disabled`), motif, durée. Le prompt n'est
  pas conservé (texte de l'utilisateur), seulement son empreinte.
- **Désactivable** : par organisation (`PUT /idea-lab/settings { aiEnabled }`,
  `organization.manage`, audit) et par la plateforme (`IDEA_LAB_AI=off`) ; désactivée, la route
  sert le texte déterministe sans appel ni quota.
- Niveau 4 (prédire) et 5 (agir) : **refusés**.

### 5. Lien avec le parcours (amendement d'ADR-0032 § 5)

Le moteur GROW reçoit les faits de l'Idea Lab (`ideaLabJourneyFacts`) : idées actives, idées
décrites (problème, cible et solution renseignés), idées au score disponible, meilleur score,
expériences terminées. Nouvelle version des règles **`GROW_JOURNEY_RULES_V2`** et des
checklists **`GROW_CHECKLISTS_V2`** :

| Étape | Avant (V1) | Après (V2) |
|---|---|---|
| VALIDATION — condition | plan financier validé | **plan financier validé, ou une idée au score de validation disponible** (`VALIDATION_ENGAGEE`) |
| IDEA — checklist | — | + `idea.lab` (auto) : une idée décrite dans l'Idea Lab |
| VALIDATION — checklist | — | + `validation.grille` (auto) : une idée au score disponible ; + `validation.experience` (auto) : une expérience terminée avec résultat |

Le « ou » n'abaisse aucune organisation : celles qui atteignaient VALIDATION par un plan validé
l'atteignent toujours. Les seuils de V1 sont inchangés. Sans Idea Lab lisible, les points
automatiques sont « inconnus », jamais « faits ». GROW lit `idea_lab_ideas` en **lecture
seule** (test de surface étendu).

### 6. API, permissions, forfait

| Méthode et chemin | Permission |
|---|---|
| `GET /idea-lab/ideas` (liste, comparaison, grille, état de l'IA) | `project.read` |
| `GET /idea-lab/ideas/:id` (fiche, score, expériences) | `project.read` |
| `POST /idea-lab/ideas` · `PUT /idea-lab/ideas/:id` · `PUT /idea-lab/ideas/:id/archived` | `canvas.update` |
| `PUT` · `DELETE /idea-lab/ideas/:id/ratings/:criterionId` | `canvas.update` |
| `POST /idea-lab/ideas/:id/experiments` · `PUT` · `DELETE …/experiments/:experimentId` | `canvas.update` |
| `POST /idea-lab/ideas/:id/promote` | `canvas.update` |
| `POST /idea-lab/ideas/:id/assist` | `canvas.update` + quota + débit IA |
| `PUT /idea-lab/settings` | `organization.manage` |

- `project.read` : tous les rôles d'organisation lisent (le Conseiller, mentor externe, aussi :
  c'est précisément à lui qu'on montre une idée ; décision ouverte n° 4). `canvas.update` :
  Propriétaire, Administrateur, Directeur financier, Analyste — ceux qui écrivent déjà le
  Canvas ; le Comptable, le Conseiller et le Lecteur ne modifient pas.
- L'assistance IA exige `canvas.update` : elle **consomme le quota** de l'organisation et ne
  sert qu'à rédiger la fiche ; un rôle en lecture n'a rien à y rédiger.
- **Forfait** : l'Idea Lab est ouvert à **toutes les offres** (aucun calcul financier, aucune
  donnée de plan) ; l'IA suit le quota commun `aiMessagesPerMonth`. La promotion vers un
  **nouveau** projet reste soumise à `maxProjects`, par la création de projet existante.
- Corps Zod `.strict()` ; chaque écriture est journalisée (`idea_lab.idea.created|updated|archived`,
  `idea_lab.rating.updated|cleared`, `idea_lab.experiment.created|updated|deleted`,
  `idea_lab.idea.promoted`, `idea_lab.settings.updated`).

### 7. Moteur

`packages/engine/src/idea-lab/` (`IDEA_LAB_VERSION = '1.0.0'`) : `IDEA_VALIDATION_GRID_V1`,
`IDEA_EXPERIMENT_CHECKLIST_V1`, `computeValidationScore`, `summarizeExperiment`,
`experimentChecklist`, `compareIdeas`, `ideaLabJourneyFacts`. Arithmétique entière pour le
score et les taux. Il ne touche aucun calcul de plan ni de facture (`ENGINE_VERSION`,
`INVOICE_TOTALS_VERSION` inchangés) ; GROW passe ses règles d'étape en V2 (§ 5).

### 8. Interface

Navigation BUILD de la refonte (ADR-0030) : **Idées** (`/idees`) et **Validation**
(`/idees/validation`), avant « Plans financiers ». En-tête de module BUILD (« Concevoir »).
Fiche d'une idée (`/idees/:id`) : fiche, assistance IA, promotion ; onglet Validation
(`/idees/:id/validation`) : grille, preuves, score et checklist d'expériences. Chaque score
porte sa version de grille, sa couverture et les critères manquants ; chaque suggestion de l'IA
est étiquetée et ne s'applique que par un clic suivi d'un enregistrement.

## Conséquences

- Nouvelles collections : `idea_lab_ideas`, `idea_lab_settings`, `idea_lab_ai_logs` (TTL).
- Nouveau module moteur `idea-lab` ; règles d'étape GROW en V2 (`reglesVersion` change).
- Le quota IA mensuel est aussi consommé par l'Idea Lab (étiquette `ai.idea_lab`).
- La création de projet accepte d'être ouverte depuis une idée (`/projects?idee=`), sans
  changement de son API.

## Plan de validation

Moteur : score borné 0–100, monotone en chaque note, invariant par permutation des notes,
indisponible sous 4 critères ou 60 % de poids, note sans preuve ignorée, `marche` sans source
ignoré, arrondi au seuil exact ; taux (dénominateur nul, incohérence, seuil atteint, écart à la
conclusion) ; classement (une idée non notée jamais devant une idée notée) ; parcours V2
(VALIDATION par idée notée ou par plan validé, points automatiques inconnus sans données).
API : isolation (idée d'une autre organisation → 404), RBAC (Lecteur et Conseiller lisent, ne
modifient pas), validation (taille de marché sans source → 400 ; note sans preuve → 400),
promotion idempotente sans nombre, IA sans clé → repli non décompté, IA désactivée → aucun
appel ; vérificateur : réponse simulée citant un nombre absent → rejet. Web : modèles purs des
écrans. Aucun test n'appelle un modèle réel.

## Décisions ouvertes — pour la dirigeante

1. **Grille** : critères, poids (25/25/15/10/10/10/5), échelle 0–4, seuils de disponibilité
   (4 critères, 60 %) et niveaux (40, 70) : propositions non sourcées, à valider, idéalement
   avec un incubateur ou un conseiller qui accompagne des créateurs en RDC.
2. **Parcours** : VALIDATION par « plan validé **ou** idée notée » — ou exiger l'idée notée
   (plus juste, mais ferait reculer des organisations existantes) ?
3. **Nombre d'idées** : 50 par organisation, borne technique ; faut-il en faire un droit
   d'offre (docs/13) ?
4. **Conseiller** : lit les idées (`project.read`). Les preuves d'entretien peuvent contenir des
   informations sur des personnes : faut-il les lui masquer, comme le fichier clients ?
5. **IA** : activée par défaut (rien n'est envoyé sans clic). Confirmer, et confirmer que le
   texte saisi de la fiche peut partir chez le fournisseur IA (ADR-0008).
6. **Étude d'opportunité** (brief § 3 : risques, barrières, monétisation) : prochaine grille
   dédiée, ou critères ajoutés en V2 de celle-ci ?

## Liens

- [ADR-0008](ADR-0008-ia-openai.md) ; [ADR-0012](ADR-0012-modele-rbac-complet.md) ;
  [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) ; [ADR-0030](ADR-0030-refonte-ui-ux.md) ;
  [ADR-0032](ADR-0032-grow-sante-et-investisseurs.md) § 5 ; [ADR-0033](ADR-0033-brief-du-matin.md) § 4–7.
- [docs/05](../05-BUSINESS-MODEL-CANVAS.md) ; [docs/06](../06-WIZARD.md) ;
  [docs/10](../10-DIAGNOSTICS.md) ; [docs/11](../11-ANALYTICS-IA.md) ; [docs/13](../13-PRICING.md).
- Brief stratégique ERP et IA (dirigeante, oct. 2026) § 1–3.
- Code : `packages/engine/src/idea-lab/`, `apps/api/src/idea-lab/`, `apps/web/src/app/(app)/idees/`.
