# UX/UI — principes et structure

**Statut :** Draft  
**Version :** 0.1

## Objectif d’expérience

Lalanda doit permettre à un utilisateur non comptable de progresser sans perdre la rigueur nécessaire à un dossier bancaire. L’interface traduit les notions financières en questions concrètes, tout en laissant aux experts l’accès aux hypothèses et détails.

## Architecture de navigation

- **Accueil** : projets récents, alertes, tâches et essai/abonnement.
- **Projet** : aperçu, Canvas, objectifs, plan, scénarios, réalisé, analytics, rapports.
- **Organisation** : membres, rôles, abonnement, facturation, paramètres, audit.
- **Aide** : glossaire, guides, sources pays et support.
- **Administration plateforme** : organisations, Country Packs, templates, abonnements et journaux.

## Disposition d’un projet

```text
┌────────────────────────────────────────────────────────────┐
│ Projet · Scénario · Période · Devise             Actions   │
├──────────────┬─────────────────────────────────────────────┤
│ Aperçu       │ Titre de la vue                             │
│ Canvas       │ Résumé / progression / alertes              │
│ Objectifs    │                                             │
│ Plan         │ Contenu principal                           │
│ Réalisé      │                                             │
│ Analytics    │                                             │
│ Rapports     │                                             │
└──────────────┴─────────────────────────────────────────────┘
```

## Composants structurants

- indicateur de progression;
- carte KPI avec valeur, unité, période, comparaison et état;
- table financière avec colonnes figées, totaux et export;
- champ monétaire avec devise et périodicité visibles;
- aide contextuelle courte et exemple;
- bannière d’alerte avec preuve, impact et action;
- sélecteur projet/scénario/période;
- historique des versions;
- journal de calcul;
- état vide orienté vers la prochaine action.

## États obligatoires

Chaque écran gère : chargement, vide, partiel, erreur récupérable, accès refusé, limite d’abonnement, règle pays expirée et succès.

## Conventions

- Afficher `0` lorsqu’il s’agit d’une valeur réelle, et `—` lorsqu’elle est absente.
- Ne jamais masquer la devise ou la période d’une valeur.
- Les nombres négatifs sont distingués par signe et style, jamais par couleur seule.
- Les pourcentages indiquent leur base de comparaison.
- Les dates utilisent le fuseau de l’organisation avec date complète dans les exports.
- Les actions irréversibles exigent confirmation et indiquent leur portée.

## Responsive

La saisie guidée fonctionne sur mobile. Les tableaux financiers complexes ciblent tablette et bureau; sur mobile ils utilisent des vues par indicateur ou période, sans colonnes illisibles.

## Accessibilité

- WCAG 2.2 AA comme cible;
- navigation clavier complète;
- focus visible;
- libellés associés aux champs;
- contraste suffisant;
- messages d’erreur liés au champ;
- graphiques accompagnés d’une table ou synthèse textuelle;
- aucune information portée uniquement par la couleur.

## Langues

Le français est la langue initiale. Les libellés métier ne doivent pas être codés en dur dans le moteur. La structure prépare l’ajout d’autres langues et conserve les noms légaux locaux dans le Country Pack.

## Implémenté (S20b) — Espace compte

`/compte` livre les réglages personnels de l’utilisateur, en trois onglets. Écrans : `apps/web/src/app/(app)/compte/`. API : `apps/api/src/account/` (voir docs/16 § Espace compte).

### Pages

| Route | Contenu |
|---|---|
| `/compte` | Profil : initiales, nom affiché, langue, fuseau horaire, changement d’adresse email |
| `/compte/securite` | Mot de passe, sessions actives avec révocation unitaire ou groupée, suppression du compte |
| `/compte/preferences` | Thème, devise d’affichage par défaut, notifications |

L’entrée se fait par l’adresse email du header, devenue un menu : Profil · Sécurité · Préférences · Déconnexion. La déconnexion n’est plus un bouton isolé — elle vit avec le reste des réglages du compte.

### Frontière d’accès

`/compte` est le **seul espace accessible sans organisation** (ADR-0012 §9). Un compte dont l’organisation vient d’être supprimée, ou dont l’auto-provisionnement a échoué, doit pouvoir consulter ses sessions, changer son mot de passe et supprimer son compte. Les routes `/account/*` n’utilisent donc que l’identité de session, jamais l’organisation active. Un test e2e dédié vérifie ce cas précis (`account.e2e.test.ts`), parce qu’il se casse silencieusement : rien dans le rendu ne signale une page devenue inaccessible à une minorité d’utilisateurs.

### États et accessibilité

- **États** : chargement, vide (aucune autre session active), erreur récupérable avec bouton « Réessayer », succès annoncé en `aria-live`. Pas d’état vide sur le profil et les préférences : l’API sert toujours des valeurs, les défauts avant toute écriture.
- **Clavier** : menu utilisateur navigable aux flèches, `Début`/`Fin`, `Échap` qui ferme **et rend le focus** au déclencheur ; onglets et formulaires atteignables sans souris ; focus visible hérité de `globals.css`.
- **Lecteurs d’écran** : `aria-current="page"` sur l’onglet actif, `aria-describedby` reliant chaque champ à son aide ou à son erreur, `aria-invalid` sur les champs en faute, `role="alert"` sur les messages d’échec.
- **Couleur** : « session actuelle », « adresse vérifiée » et l’état des thèmes sont portés par du texte, jamais par la seule couleur.
- **Mobile** : une colonne, lignes de session empilées, adresse email du header repliée sur les initiales sous 640 px.

### Thème persisté sur le compte

Le thème choisi suit l’utilisateur d’un appareil à l’autre. Trois emplacements doivent rester d’accord : l’attribut du document (ce qui est affiché), `localStorage` (lu avant le premier paint par le script anti-FOUC de `app/layout.tsx`) et `/account/preferences` (la préférence, qui fait autorité au chargement). `apps/web/src/lib/theme.ts` est le seul écrivain des deux premiers. La valeur `system` n’est jamais écrite dans le stockage local — sa clé est supprimée, faute de quoi le script de démarrage, qui ne connaît que `light` et `dark`, forcerait le mode clair au rechargement suivant.

### Limites annoncées à l’utilisateur

Deux fonctions sont incomplètes **par manque d’infrastructure, pas par oubli**, et l’interface le dit au lieu de faire semblant :

- **Changement d’adresse email** : la demande est enregistrée et le lien de vérification est généré, mais aucun email ne part — aucun fournisseur SMTP n’est configuré (docs/17 § Restant). Le changement ne peut donc pas aboutir aujourd’hui, et l’écran l’explique avant la saisie comme après. L’adresse du compte reste inchangée.
- **Notifications** : les préférences sont bien enregistrées et seront respectées dès la mise en service de l’envoi d’emails ; d’ici là, cocher une case ne déclenche aucun message.
- **Photo de profil** : remplacée par des initiales calculées côté serveur — l’upload demande un stockage de fichiers qui n’est pas branché.

## Implémenté (S21a) — Espace organisation

`/organisation` livre le pilotage de l’organisation en quatre onglets. Écrans : `apps/web/src/app/(app)/organisation/`. API : `apps/api/src/organization-space/` (voir docs/16 § Espace organisation).

### Pages

| Route | Contenu | Ouvert à |
|---|---|---|
| `/organisation` | Tableau de bord différencié par rôle | tout membre |
| `/organisation/parametres` | Nom, pays par défaut, devise d’affichage, logo | `organization.manage` |
| `/organisation/facturation` | Offre, consommation, dépassements, historique | `billing.manage` |
| `/organisation/journal` | Journal d’audit, filtrable par action | `audit.read` |

L’entrée se fait par le lien « Organisation » du header, offert à **tout membre** : masquer le lien selon le rôle recopierait la matrice dans le header (ADR-0012 §8) et se tromperait au premier changement.

### Un tableau de bord, pas quatre

Il n’y a pas une page par rôle : il y a **une** page et **un** endpoint qui ne renvoie que ce que le rôle a le droit de voir. Quatre blocs, chacun ouvert par une action de la matrice — Pilotage (`organization.manage`), Validation financière (`plan.approve`), Saisie du réalisé (`actuals.import`), Projets (`project.read`). Un bloc fermé vaut `null` dans la réponse : il n’est pas seulement masqué, il n’est **jamais chargé**. L’interface le constate, elle ne le décide pas.

La phrase d’accueil est dérivée des blocs réellement ouverts, jamais du nom du rôle : le jour où la matrice bouge, elle suit sans qu’on y touche.

### Un refus est une réponse, pas une panne

Un Lecteur, un Analyste ou un Comptable doit trouver ici un espace **utile**. Deux mécanismes, à ne pas confondre :

- **Onglets** filtrés par les permissions réelles de l’appelant (`GET /me/permissions`), pas par une copie de la matrice côté client. Tant que les permissions ne sont pas connues, seul le tableau de bord est proposé — afficher les quatre onglets puis en retirer trois au chargement fait clignoter l’interface et promet des pages qui répondront 403.
- **Pages atteintes par l’URL** : le serveur refuse de toute façon. La page traduit alors le 403 en une phrase qui dit ce que le rôle **permet** (« Les paramètres sont modifiables par un Propriétaire ou un Administrateur ; votre rôle vous donne accès au tableau de bord et à vos projets »), et non en bannière rouge. Même pattern que `/members` en S20a.

Les blocs fermés du tableau de bord sont listés sobrement en bas de page — nom, raison, aucune donnée. Le cas qui surprend le plus, l’Administrateur refusé sur la facturation, a sa propre phrase : l’abonnement relève du seul Propriétaire (docs/12).

### États et accessibilité

- **États** : chargement, vide distingué de fermé (« Aucun ratio au rouge » n’est pas « bloc non accessible »), erreur récupérable avec bouton « Réessayer », succès annoncé en `aria-live`. L’absence d’organisation active est un **état** — « créez une organisation ou acceptez une invitation » — jamais une panne.
- **Couleur** : chaque statut est porté par du **texte**. « Limite du plan atteinte » est écrit ; les pastilles et les points colorés ne sont qu’un renfort. Un ratio au rouge affiche le seuil qu’il aurait dû respecter — un chiffre rouge sans son seuil n’apprend rien à qui doit décider.
- **Lecteurs d’écran** : `aria-current="page"` sur l’onglet actif, sections reliées à leur titre par `aria-labelledby`, `aria-describedby` sur chaque champ de paramètres, `role="alert"` sur les échecs, `caption` sur le tableau du journal.
- **Chiffres** : `null` n’est jamais rendu en `0`. Une limite absente s’écrit « illimité », un écart non chiffrable s’écrit « non chiffrable » — afficher `0 %` mentirait sur un écart dont on ne sait rien (doctrine ADR-0011).
- **Mobile** : une colonne, tableau du journal à défilement horizontal propre (la page, elle, ne défile pas de travers).

### Limites annoncées à l’utilisateur

- **Logo par URL, pas par envoi de fichier** : aucun stockage de fichiers n’est branché, comme pour la photo de profil de l’espace compte. L’écran le dit au lieu de proposer un bouton inerte.
- **Aucune intégration de paiement** (docs/13 § hors périmètre S16b) : la page facturation affiche l’offre et la consommation, pas un bouton « changer de plan » qui ne mènerait nulle part. Un dépassement précise que **rien n’est supprimé** — seules les créations au-delà de la limite sont refusées.
- **Le tableau de bord n’est pas un export** : les agrégations coûteuses balaient les 20 projets les plus récemment modifiés. Le détail complet vit sur la page de chaque projet, et la réponse ne prétend nulle part à l’exhaustivité.

## Implémenté (S22a) — Connexion Google, mot de passe oublié, confirmation d’adresse

Écrans : `apps/web/src/app/(auth)/`. API et arbitrages : ADR-0014.

### Pages

| Route | Contenu | Accès |
|---|---|---|
| `/login` | + bouton Google, + lien « Mot de passe oublié ? », bandeaux `?verifie=1` et `?erreur=google` | public |
| `/register` | + bouton Google | public |
| `/mot-de-passe-oublie` | Demande d’un lien de réinitialisation | public |
| `/nouveau-mot-de-passe?token=…` | Choix du nouveau mot de passe | public, jeton porteur |
| `/verification-email?token=…` | Confirme un changement d’adresse (flux S20b) | public, jeton porteur |

Les trois dernières restent **publiques dans les deux sens** : elles ne figurent ni dans `PROTECTED_PREFIXES` ni dans `isAuthPath` (`lib/routes.ts`). Un visiteur anonyme y accède, et quelqu’un de déjà connecté n’en est pas éjecté vers `/projects` avant d’avoir confirmé — le lien arrive dans une boîte email, souvent ouverte sur un autre appareil que celui où la demande a été faite.

### Le bouton Google n’apparaît que si l’API sait le traiter

Sa visibilité vient de `GET /auth-providers`, pas d’une variable de build côté web. Tant que la réponse n’est pas arrivée, le composant ne rend **rien** — ni bouton grisé, ni squelette : faire apparaître puis disparaître un bouton donne l’impression d’une fonctionnalité retirée, et déplace le formulaire sous le curseur de quelqu’un qui a déjà commencé à saisir son mot de passe.

Le même intitulé sert à la connexion et à l’inscription (« Continuer avec Google ») : côté Google, créer un compte et s’y connecter sont la même action. Deux libellés laisseraient croire à deux comptes distincts selon la porte empruntée.

### « Mot de passe oublié » ne dit jamais si l’adresse existe

L’écran de confirmation est **le même** que l’adresse soit connue ou non : « Si un compte existe pour cette adresse, un lien vient d’y être envoyé. » Distinguer les deux cas ferait de ce formulaire un annuaire des comptes (docs/17 § Menaces prioritaires). Seule une panne réseau produit un message d’erreur — « nous n’avons pas pu traiter votre demande » ne dit rien sur l’existence du compte, et taire la panne laisserait quelqu’un attendre un email jamais demandé.

Sur `/nouveau-mot-de-passe`, la confirmation du mot de passe est comparée **avant** l’appel réseau : le lien ne sert qu’une fois, une faute de frappe ne doit pas le consommer. Après succès, redirection vers `/login` et non vers l’application : toutes les sessions viennent d’être révoquées côté serveur.
