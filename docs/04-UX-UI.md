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

## Implémenté (ADR-0016) — Navigation applicative

La barre du haut et le menu du compte. Décision et justifications : `docs/adr/ADR-0016-navigation-applicative.md`. Écrans : `apps/web/src/app/(app)/_components/`.

### Barre du haut

Cinq éléments, à toutes les largeurs : **marque · sélecteur d’organisation · Aide · thème · avatar**.

- Le **sélecteur d’organisation** reste dans la barre parce que ce n’est pas une destination : c’est le contrôle qui décide de quelle organisation on lit les chiffres. L’enfermer dans un menu, dans un produit où l’isolation par organisation est une règle de fond, serait une régression.
- **Aide** reste offerte **hors session** — le menu du compte n’existe pas pour un visiteur anonyme, l’y déplacer reviendrait à la supprimer pour lui.
- La **marque** mène à `/projects`; sous 640 px le lockup complet cède la place à l’aigle seul, portant le même lien (voir « Identité visuelle » plus bas).

**Règle à tenir en revue : aucun lien de la barre ne porte `hidden sm:*` s’il n’a pas d’autre chemin d’accès.** « Membres », « Abonnement » et « Administration » le faisaient : sous 640 px, ces trois pages étaient **inatteignables**. C’est le défaut corrigé ici.

### Menu du compte

Déclenché par l’**avatar**, disponible à toutes les largeurs. Sept entrées, deux groupes — ce qui appartient à la personne et à son travail quotidien, puis ce qui appartient à l’organisation et à la plateforme :

| Entrée | Destination | Condition |
|---|---|---|
| *En-tête d’identité : avatar, nom, adresse* | — (inerte, non focusable) | — |
| Tableau de bord | `/projects` | aucune |
| Ventes | `/ventes` (onglets Factures · Clients · Catalogue) | aucune — tout membre (ADR-0022, ADR-0023) |
| Mon compte | `/compte` (onglets Profil · Sécurité · Préférences) | aucune |
| Organisation | `/organisation` | aucune — tout membre |
| Abonnement | `/souscription` | aucune — tout membre |
| Administration | `/admin` | `canReadAdmin` (`GET /me/platform-access`) |
| Déconnexion | — (action) | session |

**« Tableau de bord » mène à `/projects`, et aucune page de synthèse n’existe.** La page d’accueil transverse décrite plus haut dans ce document (« projets récents, alertes, tâches ») n’est pas construite : le menu ne la promet pas.

**Une seule entrée est conditionnée**, et sur un drapeau que la barre charge déjà — le menu n’émet aucun appel au titre de sa visibilité et ne recopie aucune matrice de rôles (ADR-0012 §8). Masquer reste un confort : `PermissionsGuard` refuse de toute façon côté API. La liste des entrées, leur ordre et leur conditionnement vivent dans `user-menu-model.ts`, testés sans DOM.

### Clavier

| Touche | Effet |
|---|---|
| `Entrée` / `Espace` | ouvrent le menu |
| `↓` / `↑` sur le déclencheur | ouvrent **et placent le focus** sur la première / dernière entrée |
| `↓` / `↑` dans le menu | circulent, avec bouclage |
| `Début` / `Fin` | vont aux extrémités |
| `Tab` | sort du menu **et le ferme** — un menu ouvert derrière le focus est une zone morte |
| `Échap` | ferme **et rend le focus au déclencheur** |

Seules les vraies entrées portent `role="menuitem"` : l’en-tête d’identité et les séparateurs ne sont pas focusables, ce qui garde la circulation sans trou quand « Administration » est masquée. Le nom accessible du déclencheur annonce l’identité (« Menu du compte — <nom ou adresse> »), l’avatar restant `aria-hidden`. L’entrée de l’espace courant porte `aria-current="page"`, déduite du **premier segment** du chemin : `/compte/securite` allume « Mon compte », `/comptes-annuels` n’allume rien.

### Mobile

Sous 640 px : la marque se réduit à l’aigle seul, **Aide devient une icône qui garde son `aria-label`** — jamais une icône muette —, le thème et l’avatar restent. Toutes les destinations retirées de la barre sont dans le menu, disponible à toutes les largeurs : plus aucune page ne devient inatteignable sur téléphone. Le panneau est borné en largeur (il tient dans un écran de 375 px sans provoquer de défilement horizontal) et en hauteur, avec défilement interne à la liste, l’en-tête d’identité restant visible.

### Avatar : une seule autorité

**Les initiales sont calculées par le serveur**, à partir du **nom affiché**, avec repli sur l’adresse. Le header n’en calcule aucune. Auparavant deux calculs coexistaient et divergeaient : « Marie-Claire Nsimba » <mcn@…> affichait `MN` sur `/compte` et `MC` dans la barre. Le profil fait autorité — c’est là que la personne saisit son nom et voit le résultat.

Le profil est lu **une fois** et partagé entre la barre et l’espace `/compte`. Changer son nom met donc à jour les initiales de la barre sans rechargement.

**Pendant le chargement, la pastille reste neutre — aucune lettre.** Afficher des initiales provisoires puis les remplacer serait le défaut qu’on corrige, en pire : visible à chaque chargement de page. Ses dimensions sont fixes dans tous les états, pour que la barre ne bouge pas.

L’avatar apparaît à **trois endroits et trois seulement** : le déclencheur du menu (petit), l’en-tête du panneau ouvert (moyen) et `/compte` (grand). Il est décoratif partout — `aria-hidden` — car l’identité est déjà portée par le texte voisin ou par le nom accessible du bouton.

### Une URL a changé

`/members` est devenu `/organisation/membres` : la page appliquait des permissions d’organisation tout en vivant à la racine des routes. L’ancienne URL répond en **redirection permanente (308)**, déclarée dans `next.config.mjs`. Aucun email ne pointait vers `/members` (les liens sortants sont centralisés dans `apps/api/src/mail/mail.links.ts`) ; la redirection couvre les favoris et les liens partagés hors du produit. Le chemin d’API `GET /organizations/:id/members` n’a pas changé.

### Ce que cette structure engage pour la suite

Le menu du compte est désormais le point d’entrée unique vers tout ce qui n’est pas un projet. Chaque nouvel espace devra déclarer s’il est **un onglet d’un espace existant** ou **une entrée du menu** — jamais un lien de plus dans la barre.

## Implémenté (S20b) — Espace compte

`/compte` livre les réglages personnels de l’utilisateur, en trois onglets. Écrans : `apps/web/src/app/(app)/compte/`. API : `apps/api/src/account/` (voir docs/16 § Espace compte).

### Pages

| Route | Contenu |
|---|---|
| `/compte` | Profil : photo ou initiales, nom affiché, langue, fuseau horaire, changement d’adresse email |
| `/compte/securite` | Mot de passe, sessions actives avec révocation unitaire ou groupée, suppression du compte |
| `/compte/preferences` | Thème, devise d’affichage par défaut, notifications |

L’entrée se fait par l’entrée **« Mon compte »** du menu de l’avatar (ADR-0016). Une seule entrée pour l’espace : Sécurité et Préférences restent des onglets internes, non dupliqués dans le menu. La déconnexion vit dans ce même menu, avec le reste des réglages du compte.

### Frontière d’accès

`/compte` est le **seul espace accessible sans organisation** (ADR-0012 §9). Un compte dont l’organisation vient d’être supprimée, ou dont l’auto-provisionnement a échoué, doit pouvoir consulter ses sessions, changer son mot de passe et supprimer son compte. Les routes `/account/*` n’utilisent donc que l’identité de session, jamais l’organisation active. Un test e2e dédié vérifie ce cas précis (`account.e2e.test.ts`), parce qu’il se casse silencieusement : rien dans le rendu ne signale une page devenue inaccessible à une minorité d’utilisateurs.

### États et accessibilité

- **États** : chargement, vide (aucune autre session active), erreur récupérable avec bouton « Réessayer », succès annoncé en `aria-live`. Pas d’état vide sur le profil et les préférences : l’API sert toujours des valeurs, les défauts avant toute écriture.
- **Clavier** : menu utilisateur navigable aux flèches, `Début`/`Fin`, `Échap` qui ferme **et rend le focus** au déclencheur ; onglets et formulaires atteignables sans souris ; focus visible hérité de `globals.css`.
- **Lecteurs d’écran** : `aria-current="page"` sur l’onglet actif, `aria-describedby` reliant chaque champ à son aide ou à son erreur, `aria-invalid` sur les champs en faute, `role="alert"` sur les messages d’échec.
- **Couleur** : « session actuelle », « adresse vérifiée » et l’état des thèmes sont portés par du texte, jamais par la seule couleur.
- **Mobile** : une colonne, lignes de session empilées ; le menu du compte s’ouvre depuis l’avatar à toutes les largeurs (voir § Navigation applicative).

### Photo de profil

Envoi et retrait depuis `/compte`. Trois règles portent l’écran :

- **Les initiales sont l’état normal**, pas un état d’erreur. Une absence de photo ne produit ni bordure pointillée, ni point d’interrogation. Le serveur sert **toujours** les initiales, photo comprise : elles sont le repli pendant le chargement de l’image, à l’expiration de son URL et si le stockage ne répond pas.
- **Une image qui échoue à se charger retombe sur les initiales**, sans case brisée. L’URL de la photo porte un jeton à durée limitée et peut expirer pendant que la page est ouverte ; c’est le seul filet à ce moment-là. L’URL n’est donc jamais conservée d’une page à l’autre — elle est refrappée à chaque lecture du profil.
- **Le retrait existe.** Une photo qu’on ne peut pas enlever est un piège. L’endpoint est idempotent : un double clic est sans conséquence.

Quand le stockage d’images ne répond pas, le bouton est **désactivé et la raison est écrite**, plutôt que de laisser choisir un fichier pour répondre par une erreur ensuite. Les bornes affichées (formats, taille) viennent du serveur : la validation côté client est un confort, l’API reste l’autorité et tranche sur le contenu réel du fichier.

La CSP autorise l’origine de l’API dans `img-src`, sans quoi le navigateur bloquerait l’image — un blocage qui ne se voit qu’en console, jamais dans un test de rendu.

### Thème persisté sur le compte

Le thème choisi suit l’utilisateur d’un appareil à l’autre. Trois emplacements doivent rester d’accord : l’attribut du document (ce qui est affiché), `localStorage` (lu avant le premier paint par le script anti-FOUC de `app/layout.tsx`) et `/account/preferences` (la préférence, qui fait autorité au chargement). `apps/web/src/lib/theme.ts` est le seul écrivain des deux premiers. La valeur `system` n’est jamais écrite dans le stockage local — sa clé est supprimée, faute de quoi le script de démarrage, qui ne connaît que `light` et `dark`, forcerait le mode clair au rechargement suivant.

### Limites annoncées à l’utilisateur

Deux fonctions sont incomplètes **par manque d’infrastructure, pas par oubli**, et l’interface le dit au lieu de faire semblant :

- **Changement d’adresse email** : la demande est enregistrée et le lien de vérification est généré, mais aucun email ne part — aucun fournisseur SMTP n’est configuré (docs/17 § Restant). Le changement ne peut donc pas aboutir aujourd’hui, et l’écran l’explique avant la saisie comme après. L’adresse du compte reste inchangée.
- **Notifications** : les préférences sont bien enregistrées et seront respectées dès la mise en service de l’envoi d’emails ; d’ici là, cocher une case ne déclenche aucun message.

## Implémenté (S21a) — Espace organisation

`/organisation` livre le pilotage de l’organisation en quatre onglets. Écrans : `apps/web/src/app/(app)/organisation/`. API : `apps/api/src/organization-space/` (voir docs/16 § Espace organisation).

### Pages

| Route | Contenu | Ouvert à |
|---|---|---|
| `/organisation` | Tableau de bord différencié par rôle | tout membre |
| `/organisation/membres` | Rôles, accès et invitations (venu de `/members`, ADR-0016) | `organization.manage` |
| `/organisation/parametres` | Nom, pays par défaut, devise d’affichage, logo | `organization.manage` |
| `/organisation/fiscalite` | Fiche fiscale, facture normalisée DGI, points de vente e-MCF (S25b, voir ci-dessous) | `fiscal.manage` |
| `/organisation/facturation` | Offre, consommation, dépassements, historique | `billing.manage` |
| `/organisation/journal` | Journal d’audit, filtrable par action | `audit.read` |

L’entrée se fait par l’entrée **« Organisation » du menu du compte**, offerte à **tout membre** : masquer l’entrée selon le rôle recopierait la matrice côté client (ADR-0012 §8) et se tromperait au premier changement. Ce qu’il y a derrière est filtré par les permissions réelles, là où le filtrage existe déjà — les onglets. (Jusqu’à l’ADR-0016, ce document décrivait un lien « Organisation » dans le header qui **n’existait pas** : l’espace n’était atteignable qu’en tapant son URL.)

### Un tableau de bord, pas quatre

Il n’y a pas une page par rôle : il y a **une** page et **un** endpoint qui ne renvoie que ce que le rôle a le droit de voir. Quatre blocs, chacun ouvert par une action de la matrice — Pilotage (`organization.manage`), Validation financière (`plan.approve`), Saisie du réalisé (`actuals.import`), Projets (`project.read`). Un bloc fermé vaut `null` dans la réponse : il n’est pas seulement masqué, il n’est **jamais chargé**. L’interface le constate, elle ne le décide pas.

La phrase d’accueil est dérivée des blocs réellement ouverts, jamais du nom du rôle : le jour où la matrice bouge, elle suit sans qu’on y touche.

### Un refus est une réponse, pas une panne

Un Lecteur, un Analyste ou un Comptable doit trouver ici un espace **utile**. Deux mécanismes, à ne pas confondre :

- **Onglets** filtrés par les permissions réelles de l’appelant (`GET /me/permissions`), pas par une copie de la matrice côté client. Tant que les permissions ne sont pas connues, seul le tableau de bord est proposé — afficher les quatre onglets puis en retirer trois au chargement fait clignoter l’interface et promet des pages qui répondront 403.
- **Pages atteintes par l’URL** : le serveur refuse de toute façon. La page traduit alors le 403 en une phrase qui dit ce que le rôle **permet** (« Les paramètres sont modifiables par un Propriétaire ou un Administrateur ; votre rôle vous donne accès au tableau de bord et à vos projets »), et non en bannière rouge. Même pattern que l’onglet Membres, d’où il vient (S20a).

Les blocs fermés du tableau de bord sont listés sobrement en bas de page — nom, raison, aucune donnée. Le cas qui surprend le plus, l’Administrateur refusé sur la facturation, a sa propre phrase : l’abonnement relève du seul Propriétaire (docs/12).

### États et accessibilité

- **États** : chargement, vide distingué de fermé (« Aucun ratio au rouge » n’est pas « bloc non accessible »), erreur récupérable avec bouton « Réessayer », succès annoncé en `aria-live`. L’absence d’organisation active est un **état** — « créez une organisation ou acceptez une invitation » — jamais une panne.
- **Couleur** : chaque statut est porté par du **texte**. « Limite du plan atteinte » est écrit ; les pastilles et les points colorés ne sont qu’un renfort. Un ratio au rouge affiche le seuil qu’il aurait dû respecter — un chiffre rouge sans son seuil n’apprend rien à qui doit décider.
- **Lecteurs d’écran** : `aria-current="page"` sur l’onglet actif, sections reliées à leur titre par `aria-labelledby`, `aria-describedby` sur chaque champ de paramètres, `role="alert"` sur les échecs, `caption` sur le tableau du journal.
- **Chiffres** : `null` n’est jamais rendu en `0`. Une limite absente s’écrit « illimité », un écart non chiffrable s’écrit « non chiffrable » — afficher `0 %` mentirait sur un écart dont on ne sait rien (doctrine ADR-0011).
- **Mobile** : une colonne, tableau du journal à défilement horizontal propre (la page, elle, ne défile pas de travers).

### Limites annoncées à l’utilisateur

- **Logo par URL, pas par envoi de fichier** : le logo d’organisation n’a pas encore d’endpoint d’envoi, contrairement à la photo de profil de l’espace compte. L’écran le dit au lieu de proposer un bouton inerte.
- **Aucune intégration de paiement** (docs/13 § hors périmètre S16b) : la page facturation affiche l’offre et la consommation, pas un bouton « changer de plan » qui ne mènerait nulle part. Un dépassement précise que **rien n’est supprimé** — seules les créations au-delà de la limite sont refusées.
- **Le tableau de bord n’est pas un export** : les agrégations coûteuses balaient les 20 projets les plus récemment modifiés. Le détail complet vit sur la page de chaque projet, et la réponse ne prétend nulle part à l’exhaustivité.

## Implémenté (S25b) — Onglet Fiscalité

`/organisation/fiscalite` porte l’identité fiscale de l’organisation, son choix d’utiliser la facture normalisée DGI et ses points de vente e-MCF (ADR-0021, chantier C). Écrans : `apps/web/src/app/(app)/organisation/fiscalite/` et `organisation/_components/` (`fiscal-profile-panel.tsx`, `normalized-invoicing-panel.tsx`, `point-of-sale-form.tsx`, `reauth-dialog.tsx`, logique pure dans `fiscal-model.ts`). API : contrat de l’ADR-0021 §10.

### Un onglet à part, ouvert par `fiscal.manage`

L’onglet suit « Paramètres » et n’apparaît que si `fiscal.manage` figure dans `GET /me/permissions` — Propriétaire et Directeur financier. Il n’est pas une section de « Paramètres » : celui-ci est ouvert par `organization.manage`, que le Directeur financier ne détient pas. Un rôle sans la permission qui saisit l’URL lit ce que son rôle permet, pas une panne.

### Ce que la page montre

- **Fiche fiscale** : dénomination, enseigne, forme juridique (liste servie par l’API), NIF, RCCM, identification nationale, assujettissement à la TVA, siège, téléphone, e-mail. Les erreurs du serveur s’affichent **sous chaque champ** ; un chemin inconnu reste visible en tête du formulaire. Le NIF est en lecture seule tant que la facture normalisée est activée, avec la raison écrite. L’interface ne prétend pas valider un NIF : seule la concordance avec la DGI fait foi.
- **Facture normalisée** : état (« Activée » / « Désactivée »), badge **« Mode test »** partout où l’environnement est le test. Les prérequis manquants sont listés en phrases ; le bouton d’activation reste désactivé tant que le serveur ne dit pas `canActivate`, et l’activation demande une confirmation qui rappelle qu’**aucune facture non normalisée** ne pourra plus être émise. La production n’est proposée que si la plateforme l’a ouverte ; sinon la page écrit « La production sera ouverte après l’homologation de Lalanda par la DGI ».
- **Désactivation** : motif obligatoire (20 à 500 caractères, compteur affiché) et avertissement — la désactivation est tracée au journal, reste affichée sur la page et les propriétaires sont prévenus par e-mail. Après une désactivation, un bandeau permanent donne la date et le motif. Revenir de la production au test pendant l’activation demande aussi un motif.
- **Points de vente** : un par e-MCF, chacun avec son état en mots (« Actif », « Jeton manquant », « NIF différent de la fiche », « Jeton expiré », « Dernier test en échec », « Retiré ») et une phrase qui dit quoi faire, la date de fin de validité du jeton et un avertissement à moins de 30 jours, le NIM et le NIF renvoyés par la DGI, le dernier test. Actions : tester la connexion, remplacer le jeton, modifier le nom ou le NIM attendu, consulter les listes de référence DGI, retirer (le jeton est détruit), réactiver avec un nouveau jeton.
- **Réponses de la DGI** : pour toute erreur issue d’elle, le code et le libellé DGI sont affichés tels quels, en plus de la phrase française.

### Le jeton ne revient jamais

Champ masqué, `autocomplete="off"`, vidé dès l’envoi (réussi ou non). Il ne part que dans le **corps** d’un `POST` ou d’un `PUT` — un test le vérifie — et n’est jamais placé dans l’URL, `localStorage`, `sessionStorage` ni la console. L’écran n’en montre que `****` suivi des quatre derniers caractères servis par l’API (`****` seul pour un jeton court).

### Ré-authentification

Les écritures qui engagent le contribuable exigent une confirmation de moins de dix minutes. Sur `401 REAUTH_REQUIRED`, une boîte de dialogue (`<dialog>` modal : focus piégé, Échap pour annuler) demande le mot de passe (`POST /me/reauth`), puis la requête est **rejouée une seule fois** ; une seconde exigence remonte en erreur au lieu de reboucler. Sur `401 REAUTH_GOOGLE_REQUIRED` (compte sans mot de passe), la boîte propose « Se reconnecter avec Google » : la page est quittée puis retrouvée, la fenêtre est ouverte par `POST /me/reauth` sans mot de passe, et l’action interrompue est **proposée** (bouton « Reprendre ») plutôt que relancée d’office. Cette reprise est gardée dix minutes dans `sessionStorage` et ne contient jamais de jeton : une action qui en portait un (ajout, remplacement) se refait en ressaisissant le jeton.

### États et accessibilité

Chargement, erreur avec « Réessayer », liste de points de vente vide expliquée, succès annoncés en `aria-live`, échecs en `role="alert"`. Chaque statut est écrit ; la couleur des pastilles n’est qu’un renfort. Champs reliés à leur aide et à leur erreur par `aria-describedby`, `aria-invalid` sur un champ refusé. Mobile d’abord : une colonne, boutons pleine largeur, deux colonnes à partir de `sm`.

## Implémenté (S25c) — Espace Ventes : clients et catalogue

`/ventes` porte les données maîtres sans lesquelles aucune facture n’est possible : le fichier clients et le catalogue d’articles (ADR-0022, chantier D2). Écrans : `apps/web/src/app/(app)/ventes/` — `clients/`, `catalogue/`, `_components/` (`customer-list.tsx`, `customer-form.tsx`, `catalog-list.tsx`, `catalog-item-form.tsx`, `sales-access.tsx`, logique pure dans `sales-model.ts`). API : contrat de l’ADR-0022 § S25c.5.

### Pages et accès

| Route | Contenu | Ouvert à |
|---|---|---|
| `/ventes` | redirige vers `/ventes/factures` (S25e) | — |
| `/ventes/clients` | liste, recherche, fiche client | `sales.read` ; écriture `sales.manage` |
| `/ventes/catalogue` | liste, recherche, fiche article | `sales.read` ; écriture `sales.manage` |

L’entrée **« Ventes » du menu du compte** est offerte à tout membre, comme « Organisation » ; les onglets sont filtrés par `GET /me/permissions`. Un rôle sans `sales.read` (le Conseiller, le Chef de projet) lit un **refus explicite** — le fichier clients contient des données personnelles — et non une page vide. Sans `sales.manage` (Analyste, Lecteur), tout est en **consultation seule** : ni bouton de création, ni action de ligne autre que « Consulter », formulaire désactivé. Tant que les permissions ne sont pas connues, l’écran reste en lecture seule : mieux vaut un bouton qui apparaît qu’un bouton qui répond 403.

### Fiche client : le formulaire suit le type DGI

Le **type** est choisi en premier, sans valeur par défaut, parmi les cinq de la DGI (personne physique, personne morale, personne physique commerçante, profession libérale, ambassade ou organisation internationale), chacun avec une phrase qui dit ce qu’il exige. Les champs suivent : le nom est obligatoire pour tous et s’intitule **« Dénomination »** pour une personne morale ; le NIF est obligatoire pour PM, PC et PL, facultatif sinon ; la **référence du document d’exonération** n’apparaît que pour AO, où elle est obligatoire. Le NIF part tel que saisi : l’API le normalise.

### Fiche article : la liste des groupes vient du serveur

- **Groupe de taxation** choisi dans la liste de `GET /sales/tax-groups`, avec son libellé et, quand la DGI l’a fourni, son taux. Quand l’API sert sa liste par défaut, un bandeau l’écrit : **« Liste par défaut (février 2026) »**, taux non affichés. Aucun groupe ni taux n’est codé dans l’interface.
- **Type d’article** restreint aux types admis par le groupe (Taxe seulement en L et N, choisi d’office) ; la case **« Opération hors champ »** n’existe qu’en groupe A, avec le code transmis à la DGI affiché (« HORS CHAMP », orthographe à confirmer) — la référence interne est conservée. La taxe spécifique (montant par unité ou pourcentage) disparaît en L et N.
- **Prix** saisi à la française (`1 234,50`), transmis **en chaîne**, et **mode TTC/HT obligatoire**, sans valeur par défaut. Devise : CDF ou USD, au choix (ADR-0023, décision du 19 oct. 2026) ; le prix s’entend dans sa devise.
- Un article dont le groupe n’est plus proposé reste lisible, marqué « Groupe plus proposé » ; il faut en changer pour l’enregistrer.

### Aucun montant n’est calculé dans le navigateur

Les montants sont mis en forme **par manipulation de chaîne** (`1 234,50 CDF`, espace fine insécable pour les milliers), jamais arrondis ni convertis : ni `Number()`, ni `parseFloat`. Un test lit les sources de `sales-model.ts` et des composants pour l’imposer. La conversion d’un prix d’un mode à l’autre appartient au moteur, au moment de la facture (S25e).

### Écritures concurrentes, doublons, suppression

- Modification : corps complet avec la révision lue à l’ouverture. Si quelqu’un d’autre a écrit entre-temps (`409 STALE_REVISION`), la fiche dit « modifiée par quelqu’un d’autre » et propose de la recharger — jamais d’écrasement silencieux.
- Doublon de NIF ou de code : l’erreur s’affiche sous le champ, avec un lien **« Ouvrir la fiche existante »**.
- La **suppression** n’est proposée que pour une fiche jamais facturée, après confirmation ; sinon seule la **désactivation** la retire des propositions. Une fiche désactivée se réactive.

### États et accessibilité

Chargement, liste vide (distincte d’une recherche sans résultat), erreur avec « Réessayer », refus expliqué, pagination « Afficher plus » ; succès annoncés en `aria-live`, échecs en `role="alert"`. Erreurs du serveur rangées **sous chaque champ** (lues sous `details.issues` et à la racine du corps, messages Zod anglais remplacés) ; un chemin inconnu reste visible en tête. Champs reliés à leur aide et à leur erreur par `aria-describedby`, `aria-invalid` sur un champ refusé, groupes de boutons radio dans des `fieldset` légendés. Les boutons d’action portent le nom de la fiche (« Modifier — Exemple SARL »). Mobile d’abord : une colonne, filtres empilés, deux colonnes à partir de `sm`. La fiche s’ouvre sur la même page (`?fiche=<id>`, `?fiche=nouveau`) : le bouton « précédent » ramène à la liste.

### Limites

- L’indication « Déjà facturé » s’allume à la première émission ou normalisation (S25e).
- Pas d’import en masse ni d’export du fichier clients dans ce lot.

## Implémenté (S25e) — Espace Ventes : factures, pro forma et avoirs

Onglet **Factures**, premier de `/ventes` (ADR-0023, chantier E3). Écrans : `apps/web/src/app/(app)/ventes/factures/` — `page.tsx`, `nouvelle/`, `[invoiceId]/`, `journal/`, `_components/` (`invoice-list.tsx`, `invoice-editor.tsx`, `invoice-lines.tsx`, `payments-editor.tsx`, `amounts-panel.tsx`, `issue-dialog.tsx`, `normalize-dialog.tsx`, `credit-note-dialog.tsx`, `invoice-detail.tsx`, `journal-list.tsx`, logique pure dans `invoice-model.ts`). API : contrat de l’ADR-0023 § S25e.14.

### Pages et accès

| Route | Contenu | Ouvert à |
|---|---|---|
| `/ventes/factures` | liste : Tous · Brouillons · Pro forma en attente DGI · Normalisation refusée · Émises ; filtre par type (dont les avoirs) ; recherche | `sales.read` |
| `/ventes/factures/nouvelle` | composition d’un document (brouillon) | `sales.manage` |
| `/ventes/factures/<id>` | brouillon modifiable, ou document figé à consulter | `sales.read` ; brouillon `sales.manage` ; « Émettre » ou « Normaliser » `sales.invoice` |
| `/ventes/factures/journal` | journal électronique, état du chaînage | `sales.read` |

### Jamais « facture » avant l’heure

Tant que le serveur dit `documentKind = proforma` (brouillon, normalisation en cours ou refusée), l’en-tête est **« Pro forma — non valable comme facture »** avec la référence `PF{AA}{MM}-NNNNNN` (`PF-AAAA-NNNNNN` avant ADR-0027) ; aucun numéro de la série fiscale n’est affiché, même réservé. Les types sont nommés sans le mot « facture » (Vente, Acompte, Avoir…). « Facture n° … » n’apparaît que pour `issued` (organisation ordinaire) et `normalized`. Un test l’impose.

### Composer, puis émettre ou normaliser

- Client enregistré, ou **vente de comptoir** (personne physique, nom facultatif). Lignes **du catalogue** (prix de l’article, ou prix à saisir si l’article est dans une autre devise : aucune conversion au brouillon ; sinon refus `CATALOG_CURRENCY_MISMATCH` affiché sous la ligne) ou **libres** (désignation, groupe de la liste DGI, type admis, taxe spécifique, hors champ en A). Quantité à trois décimales, remise en % ou en montant. **Mode TTC/HT** obligatoire, **devise CDF ou USD**.
- **Paiements multiples** parmi les sept modes e-DEF, dont **Crédit** (part non réglée). « Un seul paiement égal au total » **recopie** le total servi par l’API.
- Commentaires : ligne A automatique pour un client AO, saisissable en groupe D ; ligne C libre ; les autres sont réservées.
- Le brouillon s’enregistre même incomplet ; l’API renvoie ses totaux et la liste de ce qui empêche encore de le figer (`readiness.blockers`), affichée telle quelle.
- **Un seul bouton** selon le mode de l’organisation, lu dans `readiness.action` : **« Émettre »** (ordinaire : numéro définitif, contenu figé) ou **« Normaliser »** (facture normalisée). Jamais les deux ; aucun sans `sales.invoice` ; désactivé tant que des modifications ne sont pas enregistrées.
- Fenêtre **« Normaliser »** : taux officiel du jour publié par la DGI (date, environnement, date de relevé), choix d’un autre taux avec rappel de la tolérance ±1 % (contrôlée par le serveur), bandeau **« Mode test »** en environnement de test. Les montants CDF s’affichent **après** la réponse du serveur : l’interface ne les prévoit pas. Taux indisponible : lien vers Organisation › Fiscalité pour rafraîchir les listes.

### Montants : deux jeux, deux libellés

Le panneau des montants a deux colonnes fixes : **« Montants du document (USD) »** (ou CDF) et **« Montants normalisés (CDF) — font foi »**, avec le taux appliqué, sa source et la contre-valeur USD. Tout vient de l’API (moteur `invoice-totals`) ; mise en forme par chaîne, ni `Number()` ni `parseFloat` (test sur la source de `invoice-model.ts` et des composants). La seule opération faite dans le navigateur est une **comparaison** chiffre à chiffre (quantité d’avoir ≤ restant), un confort que le serveur refait.

### Document figé, avoirs, reprise

- Un document émis ou normalisé se consulte seulement (lignes, client, vendeur, code DEF/DGI et NIM quand S25f les aura écrits) ; il se corrige par un avoir.
- **« Créer un avoir »** : nature (Correction, Annulation, Avoir après reprise, Remise-ristourne-rabais, avec leur sens), total (quantités restantes) ou partiel. Le brouillon d’avoir reprend client, devise et mode de l’origine ; ses lignes d’origine n’ont que la quantité de modifiable, avec le **restant** affiché. Une remise sans facture d’origine (RRR) se compose directement.
- **« Reprendre en brouillon »** depuis une normalisation refusée, seulement sans numéro réservé ; l’erreur DGI est affichée.

### Normalisation DGI : déroulé et états (S25f — ADR-0024, chantier F3)

Composants : `normalize-dialog.tsx` (fenêtre), `normalization-status.tsx` (état, dans la fenêtre et le détail), `declare-not-normalized-dialog.tsx`, `dgi-exchanges.tsx` ; logique pure dans `invoice-model.ts` (section « Normalisation DGI »). Contrat : ADR-0024 § 9.

- **Progression.** Une seule requête gèle, envoie à la DGI, compare les montants et confirme. Pendant qu’elle dure, la fenêtre liste les quatre étapes (gel et conversion, envoi, comparaison, confirmation) **toutes « en cours »** : l’API ne dit pas laquelle se joue, l’interface n’en annonce aucune faite avant la réponse. Ensuite, l’état de chaque étape est **déduit de la vue renvoyée** (fait, échec, réponse incertaine, non effectué).
- **États** (tableau § 9.3) : « Facture normalisée » (seul cas d’en-tête « Facture n° … » ; code DEF/DGI, NIM, compteurs et date DGI affichés **tels que reçus**) · « Transmission à la DGI… » · « En attente d’envoi » (avec la raison, par exemple une autre facture en cours) · « Réponse de la DGI incertaine » (« Ne refaites pas cette vente : Lalanda vérifie auprès de la DGI vers HH:MM », blocage des autres normalisations expliqué) · « Vérification nécessaire » (marche à suivre en trois temps, motif et date, identifiant de la demande DGI à donner à l’assistance) · « Normalisation refusée ». Partout ailleurs que « normalisée », le document reste **« Pro forma — non valable comme facture »**.
- **Erreurs.** Notre phrase en français, **puis** le code et le libellé DGI **tels quels** (exigence DGI), la conduite selon la catégorie (données, saturation de l’e-MCF, jeton refusé, prérequis avant envoi…) et la référence Lalanda. Un prérequis qui se règle dans Organisation › Fiscalité (point de vente, listes de référence, jeton) y renvoie par un lien.
- **Écart de calcul.** Message rassurant : rien n’a été enregistré, la demande a été annulée auprès de la DGI, aucune facture créée, numéro non consommé ; tableau des montants en écart (Lalanda / DGI, valeurs conservées par l’API, aucune conversion).
- **Boutons** : « Relancer », « Vérifier maintenant », « Déclarer non normalisée » et « Reprendre en brouillon » s’affichent **selon `normalization.actions`** seulement, calculé par l’API selon la phase et les droits. « Actualiser » (simple relecture) reste disponible quand la mise à jour automatique s’arrête.
- **Relectures bornées.** Transmission : toutes les 3 s pendant une minute. Incertaine : toutes les 15 s jusqu’à la vérification annoncée plus une minute (trois minutes sans heure annoncée), quinze minutes au plus. Au-delà, un bouton.
- **Jamais de renvoi automatique.** Si la réponse de « Normaliser », « Relancer » ou « Vérifier » se perd (réseau, délai, erreur 5xx d’un mandataire), l’interface **relit** le document et affiche son état, avec la mention « La normalisation n’a pas été renvoyée ». Seul un refus clair de l’API (4xx) s’affiche comme une erreur.
- **Déclarer non normalisée** : fenêtre qui rappelle les conséquences (retour en « refusée », trou tracé possible dans la série, audit), motif de 20 à 500 caractères ; ré-authentification par la boîte de l’onglet Fiscalité, puis nouvelle tentative unique. Aucune saisie d’éléments de sécurité.
- **Échanges avec la DGI** : section repliable du détail, chargée à l’ouverture ; chaque requête et chaque réponse (opération, date, route, résultat, statut HTTP, durée, code DGI) et le contenu échangé **tel que servi** (nombres jamais reconvertis). Aucun jeton : l’API n’en sert pas, et l’interface masque malgré tout toute clé ressemblant à un secret.
- **« Mode test »** dans la fenêtre, le panneau d’état et l’en-tête du détail dès que l’environnement est le test. Par décision de la décideuse, la mention est **impossible à manquer** : bandeau « Environnement de test DGI — facture sans valeur fiscale » en tête de la fiche, rappel « Environnement de test DGI — sans valeur fiscale » dans la fenêtre « Normaliser », et « (test) » après le numéro d’une facture normalisée en test (« Facture normalisée n° TEST-… (test) »). Un test unitaire l’impose.

### Limites

- Pas d’impression ni de PDF (S25g) : le QR code DGI, présent dans la vue, n’est pas affiché avant S25g, qui l’imprimera.
- Aucun aperçu des montants CDF avant « Normaliser » : le contrat n’a pas de route d’aperçu.
- Pas de badge « TEST » dans la **liste** des factures : le résumé de liste (`InvoiceSummary`) ne porte pas l’environnement. Il faut l’y ajouter côté API ; l’interface ne le devine pas.
- Ré-authentification par Google pendant « Déclarer non normalisée » : au retour, la déclaration n’est pas reprise automatiquement ; il faut rouvrir la fenêtre.

## Implémenté (S21b) — Espace admin plateforme

`/admin` livre l’exploitation de la plateforme en cinq onglets. Écrans : `apps/web/src/app/(app)/admin/`. API : `apps/api/src/admin/` et `apps/api/src/integrations/` (voir docs/16 § Espace admin plateforme).

### Pages

| Route | Contenu | Ouvert à |
|---|---|---|
| `/admin` | Compteurs de la plateforme, appels IA, interdits affichés | tout rôle plateforme lisant `/admin` |
| `/admin/organisations` | Liste, détail, changement de plan, suspension motivée | lecture : tout rôle ; écriture : `canManagePlatform` |
| `/admin/utilisateurs` | Recherche, rôles plateforme, désactivation | lecture : tout rôle ; écriture : `canManagePlatform` |
| `/admin/integrations` | Les cinq fournisseurs à secret | `platform_super_admin` |
| `/admin/journal` | Journal des actes d’administration | tout rôle plateforme lisant `/admin` |

L’entrée est l’entrée **« Administration » du menu du compte**, affichée sur le drapeau `canReadAdmin` servi par `GET /me/platform-access`. Un échec de cet appel **ne la montre pas** : le défaut est de ne rien proposer plutôt que de proposer une page qui répondrait 403.

### Ce que l’espace protège, et ce qu’il ne protège pas

À ne pas confondre, car la confusion produirait un faux sentiment de sécurité :

- **Le middleware web ne vérifie que la session.** `lib/routes.ts` inscrit `/admin` dans les préfixes protégés : un visiteur non authentifié est renvoyé vers `/login`. Le middleware **ignore tout des rôles plateforme** — il n’en connaît aucun et n’en lira jamais.
- **`AdminAccessGate` masque, il n’autorise pas.** Il remplace un mur de bannières 403 par un refus lisible, qui dit ce qui manque. S’il disparaissait, aucune donnée ne fuirait.
- **`PermissionsGuard` + `@RequirePlatformRole` sont le contrôle réel**, sur chaque route `/admin/*` de l’API. S’il disparaissait, tout fuirait.

Un opérateur qui force `/admin/integrations` sans le rôle voit l’écran de refus, et **aucun appel** n’est émis vers les endpoints d’intégration.

### Un seul onglet est masqué, et on sait pourquoi

Seul « Intégrations » disparaît de la navigation quand le rôle ne l’ouvre pas : son contenu **est** la liste des fournisseurs branchés et l’état de chacun, information qu’un onglet visible révélerait déjà. Les quatre autres onglets restent proposés et affichent un refus explicite à l’arrivée — une navigation qui varie sans qu’on sache pourquoi coûte plus qu’elle ne protège.

### Le champ de secret est un remplacement

Il est toujours vide au chargement, et **il ne peut pas en être autrement** : la valeur enregistrée n’existe nulle part côté client, aucun endpoint ne la rend, aucun état de l’interface ne la détient. Ce que l’écran montre d’un secret : statut, empreinte `•••• 1234`, source (coffre chiffré ou variable d’environnement), date et auteur de la dernière modification, résultat du dernier test.

Conséquence assumée : on ne peut pas corriger un caractère d’une clé, on la re-saisit entière. C’est le prix d’une interface qui ne peut pas divulguer ce qu’elle n’a jamais reçu.

**Statut de configuration et résultat du dernier test sont deux colonnes distinctes.** Les confondre ferait apparaître comme opérationnelle une intégration complète dont la clé a été révoquée la veille. Cinq états sont distingués : non configurée, incomplète, configurée mais inactive, active, dernier test en échec.

**La dérogation n’apparaît qu’après un échec.** Le bouton « enregistrer sans test concluant » n’existe que si le serveur a répondu `INTEGRATION_TEST_FAILED`. Une case « forcer » offerte d’emblée ferait du contournement le geste normal, et le test avant enregistrement ne protégerait plus de rien.

**La source `env` est signalée comme un reste de migration** (ADR-0013 §8), pas comme un état normal : l’écran invite à ré-enregistrer la valeur dans le coffre pour qu’elle devienne rotable sans redéploiement.

### États et accessibilité

- **Couleur** : aucun statut n’est porté par la seule couleur. « Dernier test en échec » est écrit ; la pastille n’est qu’un renfort.
- **Contrôle désactivé** : sa raison est écrite **à côté**, jamais laissée au seul attribut `title`. Un bouton grisé sans explication se lit comme un bug — c’est le cas du super-administrateur qui ne peut pas se retirer son propre rôle, ou désactiver son propre compte.
- **Limite annoncée** : la désactivation d’un compte révoque ses sessions mais **n’empêche pas encore la reconnexion**. L’écran le dit. Un opérateur qui croit avoir barré l’accès alors qu’il n’a que déconnecté prendrait une décision de sécurité sur une prémisse fausse.
- **`role="alert"`** sur les échecs uniquement : un lecteur d’écran qui annonce chaque succès finit par être coupé.
- **Fenêtre de ré-authentification** : le temps restant est affiché en continu, et le mot de passe est redemandé quinze secondes avant l’expiration réelle — une fenêtre qui se referme pendant la saisie d’une clé produirait un refus au pire moment.

### Ce que l’espace ne fait pas

- **Aucune donnée cliente n’y est lisible.** Le tableau de bord sert des compteurs, jamais un classement de clients ni un montant. La page Organisations affiche des volumes (membres, projets), jamais leur contenu. Il n’existe pas d’écran pour consulter le journal d’audit d’une organisation cliente depuis `/admin`.
- **Trois actes restent refusés à tous**, super-administrateur compris : valider un plan, clôturer une période, exporter un rapport. Ils sont **affichés** sur le tableau de bord, pas seulement absents : une absence s’interprète comme un oubli, une interdiction écrite ne s’interprète pas.
- **La recherche de comptes est un geste dirigé.** Il n’y a pas de « tout parcourir » : un annuaire feuilletable de toutes les adresses de tous les clients serait une base de données personnelles offerte à quiconque obtient un rôle support.

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

---

## Implémenté — Identité visuelle

Le carré « L » provisoire est remplacé par le lockup réel (aigle + mot-symbole). Actifs et correspondance des noms : `apps/web/public/marque/README.md`. Composant : `apps/web/src/components/brand-logo.tsx`.

**La source est du PNG et rien d’autre.** Il n’existe pas de SVG de la marque. Aucune vectorisation n’a été fabriquée : un tracé reconstitué serait un logo différent qui aurait l’air du bon.

### Deux fichiers, un par fond de destination

| Fichier | Contenu | Où |
|---|---|---|
| `logo-lalanda-fond-clair.png` | Badge opaque encre, mot-symbole encre | Fond clair |
| `logo-lalanda-fond-sombre.png` | Badge sombre + aigle couleur, mot-symbole crème | Fond sombre, et panneaux `.bg-ink` |

Les monochromes livrés (`logo-lalanda-blanc.png`, `logo-lalanda-noir.png`) sont rangés avec les autres comme déclinaisons disponibles pour l’impression et les aplats de couleur. **Ils ne sont branchés nulle part dans l’application** — aucun emploi ne leur a été inventé.

### La bascule de thème est du CSS, pas du JavaScript

Les deux fichiers sont dans le HTML servi; `[data-theme]` en masque un (`globals.css`, section « Marque »). Le script anti-FOUC de `layout.tsx` pose l’attribut avant le premier paint : la bonne version est la seule jamais peinte. Choisir le fichier en JS aurait imposé de lire le thème après le montage — donc de peindre d’abord la mauvaise image, ou rien, et d’exposer un écart d’hydratation. La bascule à chaud ne coûte qu’un changement d’attribut : les deux fichiers sont déjà chargés.

Les deux balises portent les mêmes dimensions : **la boîte est identique dans les deux thèmes**, vérifié au `getBoundingClientRect()` avant et après bascule — même largeur, même hauteur, même position. Rien ne bouge.

### Les bandeaux marketing ne basculent pas

L’en-tête et le pied marketing sont des panneaux `.bg-ink`, et `--ink` (`#005263`) est **le même dans les deux thèmes**. Ils portent donc la version fond sombre en permanence. Y brancher la bascule poserait le lockup à mot-symbole encre sur de l’encre en thème clair.

### Accessibilité

Le logo est un **lien vers l’accueil**, pas une décoration — y compris sur les pages d’authentification, qui n’offraient aucune sortie vers le site public.

Les images, elles, sont décoratives (`alt=""`) et le **lien** porte le nom accessible (`aria-label="Lalanda — …"`). Deux raisons : le lockup va par paire et un `alt` renseigné se lirait en double; et le nom du lien ne doit pas dépendre de la largeur, puisque sous 640 px le bloc texte n’est plus là. Un lien dont le seul contenu serait une image `alt=""` serait un lien muet.

Dimensions explicites (`width`/`height` en attributs) : la place est réservée avant le décodage, donc pas de reflow. Le style ne fixe que la hauteur, la largeur reste `auto` — le ratio du fichier est préservé exactement.

**`shrink-0` sur le lien de marque n’est pas cosmétique.** Sans lui, flexbox rétrécit le lien dans une barre à l’étroit et l’image suit en largeur alors que sa hauteur reste imposée : le logo est écrasé horizontalement. Constaté à 375 px sur l’en-tête marketing (128 px demandés, 96 px rendus).

### Favicon et icône d’application

Convention de fichiers Next 15 : `app/icon.png` et `app/apple-icon.png` — elles émettent les `<link>` **et** servent les octets avec un hash de contenu, sans URL à tenir à jour à deux endroits.

Les deux ne viennent pas du même fichier, et le choix a été **vérifié au rendu** (rastérisation à 16 et 32 px sur les gris de barre d’onglets) plutôt que supposé :

- **Favicon** ← l’aigle seul. Il occupe tout le cadre et reste lisible sur barre claire comme sombre.
- **Icône iOS** ← l’aigle sur badge. iOS pose l’icône d’accueil opaque : un PNG transparent y serait composé sur du noir.

L’hypothèse de départ était l’inverse — le badge à 16 px se réduit en fait à un carré noir, sa marge rétrécissant l’aigle d’environ 40 %. Refaire la comparaison si l’un des fichiers est régénéré.

### Ce qui n’est pas fait ici

Le filigrane des PDF (`logo-lalanda-for-filgran25.png`) relève des exports, pas de l’interface : il n’est pas copié sous `public/`.
