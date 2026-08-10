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
- La **marque** mène à `/projects`; sous 640 px son bloc texte se replie et le carré « L » subsiste, portant le même lien.

**Règle à tenir en revue : aucun lien de la barre ne porte `hidden sm:*` s’il n’a pas d’autre chemin d’accès.** « Membres », « Abonnement » et « Administration » le faisaient : sous 640 px, ces trois pages étaient **inatteignables**. C’est le défaut corrigé ici.

### Menu du compte

Déclenché par l’**avatar**, disponible à toutes les largeurs. Six entrées, deux groupes — ce qui appartient à la personne, puis ce qui appartient à l’organisation et à la plateforme :

| Entrée | Destination | Condition |
|---|---|---|
| *En-tête d’identité : avatar, nom, adresse* | — (inerte, non focusable) | — |
| Tableau de bord | `/projects` | aucune |
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

Sous 640 px : la marque se réduit au carré, **Aide devient une icône qui garde son `aria-label`** — jamais une icône muette —, le thème et l’avatar restent. Toutes les destinations retirées de la barre sont dans le menu, disponible à toutes les largeurs : plus aucune page ne devient inatteignable sur téléphone. Le panneau est borné en largeur (il tient dans un écran de 375 px sans provoquer de défilement horizontal) et en hauteur, avec défilement interne à la liste, l’en-tête d’identité restant visible.

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
