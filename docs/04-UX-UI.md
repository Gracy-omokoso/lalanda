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
