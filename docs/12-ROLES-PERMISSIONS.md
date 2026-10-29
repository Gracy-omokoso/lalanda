# Rôles et permissions

**Statut :** Draft  
**Version :** 0.1

## Modèle

Le contrôle combine rôle, organisation, projet, action et conditions. Les contrôles sont exécutés côté serveur. Le rôle définit un ensemble par défaut; des restrictions de projet peuvent le réduire.

## Rôles plateforme

| Rôle | Portée |
|---|---|
| Super administrateur | contrôle total, attribution des rôles internes |
| Administrateur plateforme | organisations, utilisateurs, paramètres non critiques |
| Support | diagnostic limité, accès temporaire approuvé |
| Finance/facturation | abonnements, paiements, factures |
| Éditeur de templates | templates sectoriels et versions |
| Gestionnaire comptable/fiscal | Country Packs et validations |

Le support ne voit jamais les données financières sans consentement explicite, durée limitée et audit.

## Rôles organisation

| Rôle | Capacités principales |
|---|---|
| Propriétaire | abonnement, membres, suppression et transfert |
| Administrateur | membres, projets, paramètres |
| Directeur financier | plans, validation, réalisé, rapports |
| Comptable | réalisé, mapping, clôture selon permission |
| Analyste | scénarios, analyses, commentaires |
| Chef de projet | projets autorisés et saisie |
| Conseiller | consultation, commentaires, recommandations |
| Lecteur | lecture seulement |

## Actions granulaires

`organization.manage`, `billing.manage`, `members.invite`, `project.create`, `project.read`, `project.update`, `canvas.update`, `inputs.update`, `plan.calculate`, `plan.approve`, `actuals.import`, `period.close`, `analytics.read`, `report.export`, `audit.read`, `fiscal.manage`, `sales.read`, `sales.manage`, `sales.invoice`, `sales.receipt`, `treasury.read`, `treasury.manage`, `crm.read`, `crm.manage`, `work.read`, `work.update`, `work.manage`.

Vingt-sept actions au total, dans l'ordre ci-dessus (ordre de fusion pour les
actions ajoutées après la dix-neuvième).

`fiscal.manage` — « Gérer l'identité fiscale et la facture normalisée » — est la
seizième action, ajoutée par ADR-0021 §8 (18 oct. 2026). Elle couvre la fiche
fiscale de l'organisation, l'activation de la facture normalisée DGI et les jetons
e-MCF de ses points de vente. Elle est réservée au **Propriétaire** et au
**Directeur financier** : saisir le jeton qui certifie les factures et basculer le
régime de facturation engagent le contribuable devant la DGI, comme valider un
plan l'engage devant sa banque. L'Administrateur, qui gère l'organisation, ne la
détient pas.

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `fiscal.manage` | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

Elle est **interdite à tous les rôles plateforme**, super-administrateur compris et
même sous accès délégué : un acteur Lalanda ne saisit jamais le jeton d'un
contribuable et ne bascule jamais son régime de facturation.

`sales.read` — « Consulter les clients et le catalogue » — et `sales.manage` —
« Gérer les clients et le catalogue » — sont la dix-septième et la dix-huitième
action, ajoutées par ADR-0022 § S25c.1 (19 oct. 2026). Elles couvrent le fichier
clients et le catalogue d'articles, données maîtres sans lesquelles aucune facture
n'est possible. Tenir ces fiches n'engage pas le contribuable devant la DGI :
l'Administrateur et le Comptable les gèrent ; l'Analyste et le Lecteur les
consultent ; le Conseiller, externe (banquier, mentor), ne voit pas le fichier
clients, qui contient des données personnelles ; le Chef de projet n'a rien.
L'émission d'une facture, qui, elle, engage le contribuable, a sa propre action
(`sales.invoice`, ci-dessous). Cette répartition est une proposition soumise à la décideuse
(ADR-0022, décision ouverte n° 1).

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `sales.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| `sales.manage` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |

Côté plateforme, `sales.read` n'est possible que **sous accès délégué**, pour le
super-administrateur et le support (comme `project.read`) ; `sales.manage`, sous
accès délégué pour le seul super-administrateur (comme `project.update`). Aucune
des deux n'est un interdit absolu.

`sales.invoice` — « Émettre et normaliser des factures et des avoirs » — est la
dix-neuvième action, ajoutée par ADR-0023 § S25e.11 (19 oct. 2026). Préparer un
brouillon ou un pro forma relève de `sales.manage` et n'engage personne ; émettre
une facture (organisation ordinaire) ou la normaliser (organisation en facture
normalisée) lui attribue un numéro et engage le contribuable. Le **Propriétaire**,
le **Directeur financier** et le **Comptable**, qui tient la facturation au
quotidien, la détiennent ; l'**Administrateur** prépare mais n'émet pas. Cette
répartition est une proposition soumise à la décideuse (ADR-0023, décision ouverte
n° 1).

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `sales.invoice` | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |

Elle est **interdite à tous les rôles plateforme**, super-administrateur compris et
même sous accès délégué : le support n'émet jamais au nom d'un contribuable.

`sales.receipt` — « Enregistrer et annuler des encaissements » — est la vingtième
action, ajoutée par [ADR-0031](adr/ADR-0031-encaissements-et-realise.md) § 4 (21 oct. 2026).
Enregistrer l'argent reçu sur une facture est un acte de trésorerie : il solde la part à
crédit et alimente les statuts de règlement. Même population que `sales.invoice`
(Propriétaire, Directeur financier, Comptable) ; l'Administrateur ne l'a pas (ADR-0031,
décision ouverte n° 9). Consulter les encaissements relève de `sales.read` ; poser une
échéance sur une facture, de `sales.manage` ; régler et lancer le pont vers le réalisé,
de `actuals.import` **et** `sales.read`.

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `sales.receipt` | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |

Elle est refusée à tous les rôles plateforme par la matrice, sans figurer parmi les
interdits absolus.

`treasury.read` — « Consulter les dépenses, les comptes et la prévision de trésorerie » —
et `treasury.manage` — « Enregistrer des dépenses, des comptes, des virements et des
dépenses récurrentes » — sont la vingt et unième et la vingt-deuxième action, ajoutées par ADR-0034 § 8 (21 oct. 2026), en fin de liste (ordre de fusion, 26 oct. 2026).
Enregistrer un décaissement est un acte de trésorerie : le **Propriétaire**, le
**Directeur financier** et le **Comptable** le font ; l'**Administrateur**, l'**Analyste**
et le **Lecteur** consultent ; le **Conseiller**, externe, ne voit pas le détail des
dépenses et des fournisseurs ; le **Chef de projet** n'a rien. Relier les dépenses au
réalisé d'un projet exige en plus `actuals.import`. Cette répartition est une proposition
soumise à la décideuse (ADR-0034, décision ouverte n° 7).

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `treasury.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| `treasury.manage` | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |

Côté plateforme, `treasury.read` n'est possible que **sous accès délégué**, pour le
super-administrateur et le support ; `treasury.manage`, sous accès délégué pour le seul
super-administrateur. Aucune des deux n'est un interdit absolu.

`crm.read` — « Consulter le CRM » — et `crm.manage` — « Gérer le CRM » — sont la
vingt-troisième et la vingt-quatrième action, ajoutées par ADR-0035 § 3 (21 oct. 2026),
en fin de liste (ordre de fusion, amendement du 27 oct. 2026). Elles
couvrent les contacts et prospects, les opportunités et leur pipeline, les activités
et relances, les réglages du pipeline et l'import/export CSV. Elles reprennent la
répartition de `sales.read` / `sales.manage` : le CRM contient des données
personnelles (le Conseiller, externe, n'y accède pas) et alimente les devis. Les
**devis** eux-mêmes relèvent de `sales.read` (lire, PDF) et `sales.manage` (préparer,
marquer envoyé, accepté ou refusé, nouvelle version, convertir en brouillon de
facture) : un devis n'engage pas le contribuable ; l'émission de la facture qui en
naît reste en `sales.invoice`. Proposition soumise à la décideuse (ADR-0035, décision
ouverte n° 1).

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `crm.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| `crm.manage` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |

Côté plateforme, comme `sales.*` : `crm.read` sous accès délégué pour le
super-administrateur et le support, `crm.manage` sous accès délégué pour le seul
super-administrateur. Aucune n'est un interdit absolu.

`work.read` — « Consulter les projets et les tâches » —, `work.update` — « Travailler sur
les tâches » (créer, modifier, déplacer, commenter, joindre, saisir son temps) — et
`work.manage` — « Gérer les projets » (créer, archiver, supprimer, colonnes, étiquettes,
réglages, temps d'autrui) — sont la vingt-cinquième à la vingt-septième action, ajoutées
par [ADR-0039](adr/ADR-0039-projets-et-taches-run.md) § 7 (29 oct. 2026), en fin de liste
(ordre de fusion). Elles portent le gestionnaire de projets et de tâches du RUN (module
`work`, affiché « Projets ») — à ne pas confondre avec `project.*`, qui reste l'action du
plan financier BUILD (affiché « Initiative »). Trois niveaux emboîtés : gérer suppose de
travailler, travailler suppose de lire. L'Administrateur gère (organiser le travail est de
la gouvernance, pas un acte financier) ; Comptable et Analyste travaillent sans gouverner
(décision ouverte n° 3) ; le Lecteur lit ; le Conseiller, externe, n'a rien (un projet
client porte des données de clients) ; le Chef de projet n'a rien en R1 (rôle non
attribuable, décision ouverte n° 1). Les gestes qui touchent l'argent **cumulent** les
actions : marge d'un projet (`work.read` + `sales.read` + `treasury.read`), coûts horaires
(`treasury.manage`), facture préparée depuis un jalon (`sales.manage`), projet créé depuis
un devis (`sales.read`). La boîte de notifications in-app, commune à tout Lalanda, n'ajoute
aucune action : ses routes portent `analytics.read` (donnée personnelle de l'appelant dans
l'organisation active), et chaque notification est refiltrée à la lecture par l'action
qu'elle exige (`work.read` pour celles du module `work`).

| Action | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `work.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| `work.update` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| `work.manage` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

Côté plateforme, comme `crm.*` : `work.read` sous accès délégué pour le
super-administrateur et le support, `work.update` et `work.manage` sous accès délégué pour
le seul super-administrateur. Aucune n'est un interdit absolu ; les rôles attribuables
sont inchangés.

**Business plan narratif (ADR-0037) — aucune action nouvelle.** Lire relève de
`project.read` ; rédiger, rattacher le plan figé et demander un brouillon à l'IA, de
`canvas.update` (le document prolonge par écrit le modèle économique) ; valider une version,
de `plan.approve`, avec la séparation des tâches de R2 (le dernier auteur du document ne le
valide pas, sauf approbateur unique, marqué) ; exporter le PDF, de `report.export` ; régler
l'IA du business plan, d'`organization.manage`. Actions dédiées : décision ouverte n° 3
d'ADR-0037.
L'Idea Lab ([ADR-0036](adr/ADR-0036-idea-lab-et-validation.md) § 6) **n'ajoute aucune
action** : lire une idée relève de `project.read`, la modifier (fiche, notes, expériences,
promotion vers un projet, assistance IA) de `canvas.update`, régler son IA de
`organization.manage`. Les actions et la matrice sont inchangées par l'Idea Lab.

## Règles critiques

- Un propriétaire ne peut pas retirer le dernier propriétaire sans transfert.
- Validation de plan et modification des entrées sont séparées.
- Une clôture et une réouverture peuvent exiger deux permissions distinctes.
- Les exports sensibles sont journalisés.
- Les changements de Country Pack sont réservés aux rôles plateforme habilités et suivent un workflow d’approbation.
- L’usurpation de session support est limitée, visible et auditée.

## Invitations

Une invitation expire, est liée à une organisation, indique rôle et projets, et peut être révoquée. Une adresse déjà membre ne crée pas de doublon.

## Tests obligatoires

Matrice rôle/action, isolation entre organisations, restrictions de projet, révocation immédiate, invitation expirée, dernier propriétaire, support temporaire et protection des exports.

## Implémenté (S20a)

Référence : ADR-0012 (Accepted, 2026-08-08). La source de vérité exécutable est
`apps/api/src/authz/permissions.ts` — aucun `if (role === …)` ne vit ailleurs.

### Rôles

Les 8 rôles d'organisation sont livrés, en slugs `snake_case` : `owner`, `admin`,
`finance_director`, `accountant`, `analyst`, `project_manager`, `advisor`,
`viewer`. Les 6 rôles plateforme sont préfixés `platform_` et vivent dans une
collection distincte : un rôle plateforme est indépendant de toute appartenance à
une organisation.

Cinq actions restent **interdites à tous les rôles plateforme, y compris au
super-administrateur** : `plan.approve`, `period.close`, `report.export`, depuis
ADR-0021 `fiscal.manage` et, depuis ADR-0023, `sales.invoice`. Un employé de la
plateforme ne valide jamais un plan client, n'exporte jamais ses données, ne touche
jamais à son identité fiscale et n'émet jamais de facture en son nom.

### Migration depuis `owner | member`

`owner` conserve sa valeur — aucun document à réécrire. `member` devient
`finance_director`, choisi **par iso-privilège** : avant S20a un `member` pouvait
créer des projets, saisir des hypothèses et calculer. `finance_director` reproduit
exactement ces droits sans en ajouter (`admin` aurait accordé `members.invite` et
`organization.manage`, un `analyst` aurait retiré `project.create`). Script
idempotent piloté par `_schemaVersion` :
`apps/api/migrations/20260808-0001-rbac-roles-organisation.mjs`.

L'API accepte encore `member` en entrée pendant une version (compatibilité N-1).

### Rang de privilège explicite

`ORG_ROLE_RANK` classe les rôles par un ordre total stable. Il existe pour une
raison concrète : la sélection de l'organisation primaire s'appuyait sur un
`.sort({ role: -1 })` qui exploitait l'ordre alphabétique des deux anciennes
valeurs (`'owner' > 'member'`). Avec huit slugs, `'viewer' > 'project_manager' >
'owner'` — un utilisateur propriétaire d'une organisation et lecteur d'une autre
basculait silencieusement sur la mauvaise. Le rang est désormais une donnée, pas
un effet de bord du tri. Il ne se dérive pas de la matrice : deux rôles peuvent
avoir des ensembles d'actions incomparables.

### Séparation validation / saisie, et l'entrepreneur seul

`plan.approve` et `inputs.update` ne sont pas détenus par les mêmes rôles
subalternes. Appliquée telle quelle, cette règle rendrait le produit inutilisable
pour une organisation d'une seule personne — le cas majoritaire en RDC.

Le plan validé porte donc `approval.soleApprover` et `approval.inputsAuthor` : un
propriétaire unique membre de son organisation peut saisir puis valider, et le
fait qu'il ait été son propre approbateur est **tracé dans le snapshot du plan**.
La séparation des tâches n'est pas contournée en silence, elle est documentée sur
la pièce elle-même.

### Journal d'audit

Collection `audit_events` (acteur, action, cible, organisation, date), alimentée
par la validation de plan et l'export de rapport. Lecture réservée aux rôles
portant `audit.read`.

### Couverture de tests

- Matrice rôle × action : 378 cas unitaires (8 × 27 + 6 × 27), exhaustifs (une
  case absente ne compile pas).
- Matrice appliquée bout en bout : 91 cas vérifiés sur le réseau — la preuve que
  les guards l'appliquent, pas seulement qu'elle est déclarée.
- Règles critiques : 18 cas e2e, dont le parcours entrepreneur seul, le dernier
  propriétaire non rétrogradable sans transfert, la révocation immédiate,
  l'invitation expirée et l'isolation entre organisations.
- Couverture des routes : un test échoue si une route sensible ne déclare aucune
  permission.

### Reste à faire

- **Restrictions par projet** (`✓P` dans la matrice d'ADR-0012) : un
  `project_manager` est aujourd'hui limité au niveau organisation, pas au
  sous-ensemble de projets qui lui est assigné.
- **Usurpation de session support** : les rôles plateforme sont posés, mais les
  `support_grants` (accès délégué consenti, limité dans le temps et audité) ne
  sont pas implémentés. Le support n'a donc aucun accès aux données clientes —
  refus par défaut, ce qui est le bon état par défaut.
- **MFA** : docs/17 l'exige pour les rôles sensibles. Absent. On se rabat sur la
  ré-authentification par mot de passe, plus faible que la cible. À lever avant
  d'ouvrir `/admin` en production.
