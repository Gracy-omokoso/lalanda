# ADR-0062 — Importer un projet ou des tâches depuis un fichier Excel ou CSV

Statut : **Proposé** (à valider par la dirigeante sur les captures `docs/refonte-ui/v5/`)
Date : 2026-11-05
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> Prolonge [ADR-0039](ADR-0039-projets-et-taches-run.md) (module `work`), [ADR-0057](ADR-0057-interieur-projet-facon-asana.md)
> (la colonne du Tableau tient lieu de section) et [ADR-0058](ADR-0058-accueil-projets-et-mes-taches-equipe.md).
> Partage son créateur avec [ADR-0063](ADR-0063-construire-projet-avec-ia.md). Aucune règle financière ; aucun montant.

## Contexte

Les équipes arrivent avec leurs plans dans Excel. Les ressaisir tâche par tâche est long et décourage
l'adoption du module Projets. La dirigeante veut : un **modèle téléchargeable** qui guide la disposition,
un **aperçu** des erreurs avant toute création, puis un import **en une fois**.

## Décision

### 1. Un plan commun, un seul créateur

Un **plan** (`@lalanda/shared/work`, `plan.ts`) est une liste de tâches à **références locales**
(`L5` = ligne 5 du fichier ; `T3`, `J1` pour l'IA) : titre, description, section, responsable, début,
échéance, priorité, jalon, `dependsOn` (références), étiquettes (libellés), `parentRef`, estimation.
`planProblems` vérifie la structure (références uniques et connues, un seul niveau de sous-tâches,
jalon daté sans début ni sous-tâche, dates dans l'ordre, **aucun cycle**).

`WorkPlanBuilder` (`apps/api/src/work/work-plan-builder.ts`) est le **seul** chemin de création, pour
l'import comme pour l'IA :

1. tout est vérifié **avant** la première écriture : structure, responsables (`work.update`, organisation
   active), sections et étiquettes à créer (droit et bornes : 12 colonnes, 50 étiquettes), 500 projets,
   5 000 tâches par projet ;
2. les écritures passent par les **services existants** (réglages, projets, tâches, dépendances) : mêmes
   règles, même historique, mêmes notifications d'assignation qu'une saisie à la main ;
3. **tout ou rien** : les services ne partagent pas de transaction ; l'échec en cours de route est
   **compensé** — projet neuf supprimé avec son contenu, ou tâches créées retirées d'un projet existant,
   colonnes et étiquettes ajoutées remises comme avant (au mieux, l'échec d'une compensation est
   journalisé). Testé par une panne simulée.

Une trace `audit_events` est écrite : `work.plan.project_created` ou `work.plan.tasks_imported`,
`origin: import | ai`, compteurs.

### 2. Le modèle

`GET /work/import/template.xlsx` : classeur à deux onglets — **Guide** (chaque colonne : règle, valeurs
permises, exemple ; mode d'emploi ; limites) et **Tâches** (en-têtes, exemple réaliste : ouverture d'une
boutique à Kinshasa, 11 lignes avec sections, jalons, sous-tâches et dépendances). `GET
/work/import/template.csv` : mêmes colonnes et exemple, séparateur `;`, **UTF-8 avec BOM**, CRLF. Copies
statiques : `docs/modeles/modele-import-projet.xlsx` et `.csv`.

| Colonne | Règle |
|---|---|
| Section | facultatif ; = colonne du Tableau ; inconnue → nouvelle colonne « à faire » avant « Terminé » |
| **Tâche** | **obligatoire**, 300 caractères |
| Description | facultatif, 10 000 caractères (coupée au-delà, signalé) |
| Responsable (e-mail) | e-mail d'un membre de l'organisation active (le nom exact est accepté) ; inconnu ou sans `work.update` → **sans responsable** (avertissement) |
| Début, Échéance | `JJ/MM/AAAA` (aussi `AAAA-MM-JJ`, date Excel, numéro de série Excel) ; illisible → ligne écartée ; échéance avant début → ligne écartée |
| Priorité | Basse, Moyenne, Haute, Urgente (valeurs réelles du modèle : `low…urgent`) ; vide = aucune ; inconnue → aucune (avertissement) |
| Jalon | Oui/Non ; un jalon exige une échéance (sinon le début devient l'échéance, ou la ligne est écartée) et perd sa date de début |
| Dépend de | numéros de ligne (en-tête = ligne 1) ou noms exacts, séparés par des virgules ; introuvable, vers soi ou vers une ligne écartée → ignorée (avertissement) ; un **cycle** est cassé en retirant une dépendance, signalé |
| Étiquettes | libellés séparés par des virgules (10 au plus) ; inconnue → créée |
| Sous-tâche de | numéro de ligne ou nom ; un seul niveau ; parent jalon, sous-tâche ou écarté → tâche de premier niveau (avertissement) |
| Estimation (heures) | `1,5`, `2`, `1h30`, `45 min` → `estimateMinutes` (le modèle a ce champ, informatif) |

Les en-têtes sont reconnus sans accents, sans casse, sans `*` ni parenthèses, avec des synonymes
(« Nom de la tâche », « Date d'échéance », « Tags »…) ; une colonne inconnue est ignorée et nommée.

### 3. Lecture sûre

- Bibliothèque : **`exceljs`** (déjà dépendance de l'API pour les exports ; aucun ajout au fichier de
  verrouillage). Audit du dépôt (`scripts/audit-dependencies.mjs`) : **0 haute, 0 critique**, cliquet OK.
- Avant `exceljs`, le **répertoire central du zip** est lu sans rien décompresser : taille décompressée
  bornée à 40 Mo (bombe zip), **macros refusées** (`vbaProject.bin`), `xl/workbook.xml` exigé.
- **Aucune formule n'est évaluée** : seule la valeur mise en cache par le tableur est lue (sinon vide).
- CSV : UTF-8 (BOM retiré), à défaut Windows-1252 ; séparateur deviné (`;`, `,`, tabulation) ;
  guillemets à la RFC 4180 ; lignes vides ignorées sans décaler les numéros de ligne.
- Le format est déduit du **contenu** (signature zip), jamais du nom.
- Bornes : **2 Mo** (comptés pendant la lecture du flux, 413 au-delà), **2 000 lignes**.

### 4. Erreurs et avertissements

Une **erreur** écarte la ligne (nom vide, date illisible, dates inversées, jalon sans date). Un
**avertissement** signale une correction (responsable inconnu → sans responsable, dépendance
introuvable, cycle cassé, priorité inconnue, texte coupé). L'aperçu donne pour chaque ligne son état
(Prête, Corrigée, Écartée) et ses problèmes en français, plus les compteurs, les sections et étiquettes
qui seront créées, les colonnes ignorées.

Dans un projet existant, un membre **sans `work.manage`** n'ajoute ni section ni étiquette : la tâche va
dans la première colonne « à faire » et l'étiquette est ignorée (avertissement à l'aperçu).

### 5. Routes (sans état côté serveur)

| Route | Droit |
|---|---|
| `GET /work/import/template.xlsx`, `GET /work/import/template.csv` | `work.read` |
| `POST /work/import/preview?projectId=` | `work.update` — corps **brut**, rien n'est écrit |
| `POST /work/import/projects?name=&kind=&ownerUserId=&startDate=&dueDate=&skipInvalid=` | `work.manage` |
| `POST /work/projects/:projectId/import?skipInvalid=` | `work.update` |

L'écran renvoie **le même fichier** pour l'import, qui refait la même lecture : l'aperçu et l'import ne
peuvent pas diverger, et aucun brouillon n'est stocké. S'il reste des lignes écartées, l'import exige
`skipInvalid=true` (case de confirmation), sinon `422 IMPORT_HAS_ERRORS`. Aucune ligne valide :
`422 IMPORT_NOTHING_TO_IMPORT`. Fonction d'offre `run_work`, organisation active, projet d'une autre
organisation → 404, membre d'une autre organisation jamais reconnu. 60 envois par heure et par
utilisateur.

### 6. Écran

« Nouveau projet » propose en tête **Importer un fichier** et **Construire avec l'IA**, puis le
formulaire habituel. `/projets/importer` : 1. modèles à télécharger ; 2. choix du fichier (aperçu
automatique) ; 3. compteurs, phrase « Sera créé : … », tableau des lignes (filtre « lignes à vérifier »),
nom et dates du projet, bouton **Importer**. Dans un projet, la Liste porte **Importer des tâches**
(`/projets/importer?projet=<id>`, `work.update`).

## Conséquences

- Chaque tâche assignée à l'import envoie la notification d'assignation habituelle (même chemin que la
  saisie) : un gros import peut en envoyer beaucoup à une même personne.
- Écritures une par une par les services : quelques secondes pour 200 lignes, davantage vers 2 000.
- Les étiquettes et colonnes créées restent si l'utilisateur supprime ensuite le projet.

## Points ouverts

1. Regrouper les notifications d'assignation d'un import en une seule (« 12 tâches vous ont été
   assignées ») ?
2. Mettre à jour des tâches existantes (import « fusion » par numéro `#12`) : hors périmètre.
3. Import de dates de début de projet / responsable depuis le fichier (aujourd'hui : écran).
