# ADR-0016 — Navigation applicative : barre du haut, menu du compte, place des espaces

Statut : Proposed
Date : 2026-08-10
Décideurs : Gracy Omokoso

## Contexte

La demande est venue du décideur en ces termes :

> « revois la nav bar les option membres administration organisation dois normalement se
> retrouver dans les paramètre correspondants, généralement en dessous de l'avatar il y a :
> Dashboard ou tableau de bord, Profil (tous les paramètre lié au profile, tout ce que tu as
> déjà fait mais il doit aussi me donner la possibilité d'uploader une photo de profil bien
> entendu quand il n'y a pas de photo ça recupère par defaut les initials comme tu l'as fait.),
> Organisation, paramètre de compte, abonnement... bref fais en sorte que ça réponde aux
> standard et surtout on reste cohérent dans la navigation qu'on soit en mesure d'atteindre
> facilement les différente bout de l'application. »

Deux points ont été arbitrés par le décideur pendant la rédaction, et sont appliqués sans être
rediscutés ici : l'entrée « Tableau de bord » mène à `/projects` et **aucune page de synthèse
n'est à créer** ; le compte est représenté par **une seule entrée « Mon compte »** menant à
`/compte`, qui garde ses onglets internes.

### Ce que fait la barre aujourd'hui

`apps/web/src/app/(app)/_components/app-header.tsx` rend, de gauche à droite :

| Élément | Ligne | Destination | Condition |
|---|---|---|---|
| Logo « Lalanda » | `app-header.tsx:43` | `/projects` | — |
| Lien « Membres » | `app-header.tsx:63-68` | `/members` | session, `hidden sm:inline` (`:65`) |
| Lien « Abonnement » | `app-header.tsx:74-79` | `/souscription` | session, `hidden sm:inline` (`:76`) |
| Lien « Administration » | `app-header.tsx:80-87` | `/admin` | `canReadAdmin`, `hidden sm:inline` (`:83`) |
| Sélecteur d'organisation | `app-header.tsx:88` | — (change le contexte) | session |
| Lien « Aide » | `app-header.tsx:95-100` | `/aide` | aucune — visible même hors session (`:91-94`) |
| Bascule de thème | `app-header.tsx:103` | — | — |
| Menu déclenché par l'ADRESSE EMAIL | `app-header.tsx:110` | Profil · Sécurité · Préférences · Déconnexion | session |

Le drapeau `canReadAdmin` vient du serveur (`GET /me/platform-access`, `app-header.tsx:24-39`,
`apps/web/src/lib/api.ts:983` et `:1457`). Un échec de cet appel n'affiche pas le lien
(`app-header.tsx:33-35`).

Le menu du compte liste trois entrées, définies dans `user-menu.tsx:30-34` : `/compte`,
`/compte/securite`, `/compte/preferences`, plus la déconnexion (`user-menu.tsx:186-194`).

### Cinq constats, vérifiés dans le code

**1. `/organisation` n'a aucun point d'entrée.** `docs/04-UX-UI.md:130` affirme : « L'entrée se
fait par le lien "Organisation" du header, offert à tout membre ». Ce lien **n'existe pas** :
`app-header.tsx` ne contient aucun `href="/organisation"`, et une recherche sur l'ensemble de
`apps/web/src` ne trouve qu'une seule référence hors de l'espace lui-même —
`souscription/_components/subscription-funnel.tsx:456`, qui pointe vers
`/organisation/facturation` depuis le tunnel d'abonnement. Un espace de quatre onglets
(`organisation/_components/organization-model.ts:43-48`) n'est donc atteignable qu'en tapant
l'URL, ou par un lien enfoui dans un écran de paiement. C'est le trou le plus grave de la
navigation actuelle, et la documentation le masque en le décrivant comme résolu.

**2. `/members` est une page d'organisation logée hors de l'organisation.** Ses deux appels sont
scopés par organisation et gardés par `organization.manage` et `members.invite`
(`members/page.tsx:7-9`). C'est de la gouvernance d'organisation, exactement au même titre que
les paramètres, la facturation et le journal — mais elle vit à la racine des routes.

**3. Sous 640 px, trois liens disparaissent sans autre chemin d'accès.** « Membres »,
« Abonnement » et « Administration » portent `hidden sm:inline` (`app-header.tsx:65`, `:76`,
`:83`). Aucun n'est repris ailleurs : sur un téléphone, `/members`, `/souscription` et `/admin`
deviennent **inatteignables**. Le menu du compte, lui, survit correctement : seule l'adresse
email se replie, le déclencheur reste (`user-menu.tsx:148-150`).

**4. Deux calculs d'initiales coexistent et peuvent diverger.** Le serveur calcule
`initialsOf(name, email)` à partir du **nom affiché** — première lettre du premier et du dernier
mot, repli sur les deux premiers caractères de la partie locale de l'email
(`apps/api/src/account/account.controller.ts:323-333`), servi dans `ProfileView.initials`
(`:69`, `:310`) et rendu par `compte/_components/profile-panel.tsx:129`. Le header calcule
`initialsOfEmail(email)` à partir de **l'adresse** seule, découpée sur `.`, `_` et `-`
(`user-menu.tsx:210-215`). Pour un compte nommé « Marie-Claire Nsimba » dont l'adresse est
`mcn@lalanda.cd`, le serveur affiche `MN` et le header `MC` : la même personne change de lettres
selon l'écran. Le commentaire `user-menu.tsx:202-208` assume ce choix pour éviter une requête
réseau — mais le header en émet déjà une par page (`getPlatformAccess`, `app-header.tsx:28`) et
le sélecteur d'organisation une seconde (`org-switcher.tsx:35`).

**5. La photo de profil est annoncée comme indisponible, et l'affichage distant est bloqué.**
`profile-panel.tsx:141` le dit à l'utilisateur, `docs/04-UX-UI.md:115` et `:157` le documentent.
Un autre chantier construit actuellement l'envoi de photo **côté API**, et son contrat n'est pas
figé : ce document ne présume donc ni de la forme de l'URL renvoyée, ni du nom du champ. Reste
un fait indépendant de ce contrat : la CSP de production interdit aujourd'hui toute image
distante — `img-src 'self' data: blob:` (`apps/web/next.config.mjs:62`).

### Pourquoi un ADR et non une section de docs/04

`CLAUDE.md` impose un ADR pour toute décision structurante. Trois marqueurs sont réunis :

- une **URL publique change** (`/members` → `/organisation/membres`), avec la dette de
  redirection que cela crée ;
- la décision **contraint tous les lots à venir** : chaque nouvel espace devra dire s'il est un
  onglet d'un espace existant ou une route de premier niveau ;
- elle fixe une **autorité unique** sur les initiales, en supprimant un calcul concurrent
  (§7) — le genre de règle qui se reperd si elle n'est écrite nulle part.

`docs/04-UX-UI.md` reçoit en complément une section courte qui décrit le résultat et renvoie
ici ; les tableaux de `docs/04` restent la description de l'implémenté.

## Options considérées

### Où loger Membres, Organisation, Administration

| Option | Retenue | Motif |
|---|---|---|
| **Membres devient un onglet de `/organisation` ; Organisation et Administration deviennent des entrées du menu avatar** | ✅ | Rejoint la demande (« dans les paramètres correspondants ») et la structure réelle des permissions : `GET /organizations/:id/members` est gardé par `organization.manage`, comme `/organisation/parametres`. Un seul espace de gouvernance, une seule porte. |
| Tout laisser dans la barre, en ajoutant simplement le lien « Organisation » manquant | ❌ | Porte à cinq le nombre de liens de premier niveau, dont trois déjà masqués sous 640 px. Et laisse Membres à la racine, hors de l'espace dont il applique les permissions. |
| Une barre latérale permanente (sidebar) | ❌ | Le gabarit applicatif est une colonne centrée `max-w-5xl` (`app/(app)/layout.tsx:9`) et chaque espace porte déjà ses propres onglets. Une sidebar ajouterait un troisième niveau de navigation concurrent des `ACCOUNT_TABS`, `ORGANIZATION_TABS`, `ADMIN_TABS` et `PROJECT_TABS`. Refonte disproportionnée à la demande. |

### Représentation du compte dans le menu

| Option | Retenue | Motif |
|---|---|---|
| **Une entrée « Mon compte » → `/compte`, onglets internes conservés** | ✅ | **Arbitré par le décideur.** Résout le recouvrement entre « Profil » et « paramètres de compte » : `/compte` **est** l'espace des paramètres du compte, Profil en est le premier onglet (`account-tabs.tsx:21-25`, titre « Mon compte » en `compte/layout.tsx:19`). Deux entrées auraient mené à la même URL. |
| Trois entrées Profil / Sécurité / Préférences en accès direct | ❌ | Écarté par le décideur. Aurait dupliqué dans le menu une navigation déjà portée par les onglets de l'espace, et allongé le menu de deux lignes pour deux réglages consultés rarement. |

Coût assumé de l'option retenue : atteindre Sécurité ou Préférences demande un clic de plus
qu'aujourd'hui. Contrepartie : le menu ne contient plus qu'une seule ligne par espace, et la
liste des onglets ne vit qu'à un endroit.

## Décision

### 1. Contenu exact du menu avatar

Dans cet ordre. Le déclencheur devient **l'avatar** (photo ou initiales), et non plus l'adresse
email.

| # | Libellé | Destination | Condition d'affichage |
|---|---|---|---|
| — | *En-tête d'identité : avatar, nom affiché, adresse email* | aucune (non focusable) | session |
| 1 | Tableau de bord | `/projects` | aucune |
| 2 | Mon compte | `/compte` (onglets Profil · Sécurité · Préférences) | aucune |
| — | *séparateur* | | |
| 3 | Organisation | `/organisation` (onglets Tableau de bord · Membres · Paramètres · Facturation · Journal) | aucune (tout membre) |
| 4 | Abonnement | `/souscription` | aucune (tout membre) |
| 5 | Administration | `/admin` | `canReadAdmin` |
| — | *séparateur* | | |
| 6 | Déconnexion | — (action) | session |

Six entrées, deux groupes, une seule conditionnée. Le premier groupe est ce qui appartient à la
personne, le second ce qui appartient à l'organisation et à la plateforme.

**Une seule entrée est conditionnée** — Administration — et son drapeau est déjà chargé par le
header aujourd'hui (`app-header.tsx:28-30`). Le menu n'émet donc **aucun appel supplémentaire**
au titre de la visibilité, et surtout il ne recopie aucune matrice de rôles côté client
(ADR-0012 §8).

**« Membres » n'est pas une entrée du menu.** C'est un onglet de `/organisation` (§3). L'entrée
« Organisation » est la porte ; ce qu'il y a derrière est filtré par les permissions réelles, là
où le filtrage existe déjà (`organization-tabs.tsx:27-41`).

### 2. « Tableau de bord » mène à `/projects` — rien à créer

Arbitrage du décideur, appliqué tel quel. `/projects` **est** la page d'atterrissage
(`app-header.tsx:43`, `org-switcher.tsx:49`). Aucune page de synthèse n'est créée, et la page
d'accueil transverse décrite par `docs/04-UX-UI.md:12` (« projets récents, alertes, tâches et
essai/abonnement ») reste non construite — ce document ne la promet pas.

Deux frictions à signaler, sans remettre la destination en cause :

- **Redondance avec le logo**, qui mène déjà à `/projects` (`app-header.tsx:43`). Elle est
  bénigne et probablement souhaitable : cliquer le logo pour rentrer est un réflexe acquis, pas
  un chemin découvrable. Un utilisateur qui ouvre le menu pour chercher « où est l'accueil »
  trouve une réponse écrite.
- **Le libellé « Tableau de bord » est déjà porté par deux onglets** : la racine de
  `/organisation` (`organization-model.ts:44`) et la racine de `/admin` (`admin-model.ts:46`).
  Trois éléments de navigation partageront donc le même mot pour trois pages différentes. Le
  risque est réel mais localisé : les deux autres n'apparaissent qu'à l'intérieur de leur espace,
  précédés du titre de l'espace (`organisation/layout.tsx:21`), jamais côte à côte avec l'entrée
  du menu. Si la confusion se manifeste à l'usage, le geste le moins coûteux sera de renommer les
  onglets internes (« Vue d'ensemble »), pas l'entrée du menu.

### 3. Membres devient `/organisation/membres`

- Une entrée est ajoutée à `ORGANIZATION_TABS` (`organisation/_components/organization-model.ts:43-48`) :
  `{ segment: 'membres', label: 'Membres', action: 'organization.manage' }`, **en deuxième
  position**, juste après « Tableau de bord » — les personnes viennent avant les réglages.
- L'action retenue est `organization.manage` parce que c'est celle qui garde l'appel qui remplit
  la page (`GET /organizations/:id/members`, `members/page.tsx:7-8`). Elle est détenue par
  `owner` (`apps/api/src/authz/permissions.ts:190`) et `admin` (`:210`), refusée aux six autres
  rôles (`:230`, `:249`, `:268`, `:288`, `:308`, `:327`).
- La page conserve son comportement actuel sur URL directe : un 403 est traduit en une phrase
  qui dit ce que le rôle permet, jamais en bannière rouge (`members/page.tsx:10-13`). Masquer
  l'onglet reste un **confort** ; le contrôle est `PermissionsGuard` côté API.

**Redirection de l'ancienne URL.** `/members` répond en redirection **permanente (308)** vers
`/organisation/membres`, déclarée dans `apps/web/next.config.mjs` (le fichier n'a pas encore de
bloc `redirects()` ; il expose `headers()` en `:111`, config en `:97-122`).

Vérification faite avant d'en décider : **aucun email ne pointe vers `/members`**. Les liens
sortants sont centralisés dans `apps/api/src/mail/mail.links.ts` — précisément pour éviter ce
genre de rupture (`mail.links.ts:1-7`) — et ils sont quatre : `/invitations/accept?token=`
(`:29`), `/verification-email?token=` (`:34`), `/nouveau-mot-de-passe?token=` (`:39`) et
l'endpoint de vérification côté API (`:52`). Une invitation envoyée par email atterrit donc sur
`/invitations/accept`, qui n'est pas touché par ce lot. La redirection reste néanmoins exigée :
des favoris et des liens partagés hors du produit existent, et une URL publiée ne se retire pas.

`'/members'` **reste** dans `PROTECTED_PREFIXES` (`apps/web/src/lib/routes.ts:31`) tant que la
redirection vit dans la configuration Next : coût nul, et garantie qu'un visiteur non
authentifié soit envoyé vers `/login` plutôt que dans une chaîne de redirections. Le test
`routes.test.ts:57` reste vert sans modification.

**Le chemin d'API ne bouge pas.** `GET /organizations/:id/members` est une route serveur ;
la renommer n'apporterait rien et casserait les tests e2e qui l'exercent
(`apps/api/src/__tests__/rbac-matrix.e2e.test.ts:291-293`).

### 4. Ce qui reste dans la barre du haut

Après le déplacement, la barre contient : **logo · sélecteur d'organisation · Aide · thème ·
avatar**. Quatre contrôles à droite du logo — ni vide, ni surchargée.

- **Le sélecteur d'organisation reste**, et c'est le point le plus important de cette section.
  Ce n'est pas une destination, c'est un **sélecteur de contexte** : il change ce que toutes les
  autres pages affichent, en posant le cookie `active_org_id` puis en rechargeant
  (`org-switcher.tsx:46-51`). Enfermer dans un menu le seul contrôle qui répond à « de quelle
  organisation suis-je en train de lire les chiffres ? » serait une régression dans un produit
  où l'isolation par organisation est une règle de fond (`CLAUDE.md`).
- **Aide reste**, et à toutes les largeurs. C'est la seule entrée permanente vers le glossaire
  et l'explication des ratios, et elle est délibérément offerte **hors session**
  (`app-header.tsx:91-94`). Le menu avatar n'existe pas pour un visiteur anonyme : y déplacer
  Aide reviendrait à la supprimer pour lui.
- **La bascule de thème reste** : un contrôle à un clic, dont le réglage persistant vit déjà
  dans `/compte/preferences` (`app-header.tsx:101-103`).
- **Le logo reste** la route vers `/projects` (voir §2 sur la redondance assumée).

Partent de la barre : Membres (devient un onglet), Abonnement et Administration (deviennent des
entrées du menu).

### 5. Visibilité par rôle

**Masquer est un confort, jamais un contrôle d'accès.** Le contrôle réel est
`PermissionsGuard` sur chaque route d'API (ADR-0012 §8, `docs/04-UX-UI.md:177-185`). Une
divergence entre ce tableau et la matrice produit au pire une entrée en trop, jamais un droit en
trop.

| Entrée | Condition | Source du fait | Conséquence si le fait manque |
|---|---|---|---|
| Tableau de bord | aucune | — | — |
| Mon compte | session seule | `/compte` est le **seul espace qui fonctionne sans organisation** (`compte/layout.tsx:5-9`, ADR-0012 §9) | jamais masqué : c'est l'espace de secours d'un compte sans organisation |
| Organisation | aucune | intention déjà écrite en `docs/04-UX-UI.md:130` | — |
| ↳ onglet Membres | `organization.manage` | `GET /me/permissions` (`organization-tabs.tsx:27-41`) | permissions inconnues → seul « Tableau de bord » proposé (`organization-model.ts:66-69`) |
| ↳ onglet Paramètres | `organization.manage` | idem | idem |
| ↳ onglet Facturation | `billing.manage` — **owner uniquement** (`permissions.ts:191` contre `:211` pour admin) | idem | idem |
| ↳ onglet Journal | `audit.read` — owner, admin, finance_director (`:204`, `:224`, `:244`) | idem | idem |
| Abonnement | aucune | — | la page dit elle-même que la gestion revient au Propriétaire (`app-header.tsx:69-73`) |
| Administration | `canReadAdmin` | `GET /me/platform-access` (`app-header.tsx:24-39`) | appel en échec → **entrée non affichée** (`:33-35`) |

Deux règles à ne pas relâcher :

- le menu ne lit **aucun rôle** ; il lit deux drapeaux servis par le serveur. Aucun
  `if (role === …)` ne doit apparaître dans `apps/web` (ADR-0012 §8) ;
- une entrée conditionnée dont le fait n'est pas encore connu ne s'affiche pas « en attendant ».
  Le défaut est de ne rien proposer plutôt que de proposer une page qui répondra 403.

### 6. Mobile et clavier

**Règle générale, à écrire dans le code comme dans la revue : aucun lien ne porte
`hidden sm:*` s'il n'a pas d'autre chemin d'accès.** C'est précisément le défaut corrigé ici
(`app-header.tsx:65`, `:76`, `:83`).

**Sous 640 px.** La barre conserve : la marque (le carré « L » seul, le bloc texte se replie),
le sélecteur d'organisation réduit à un libellé court, Aide sous forme d'icône portant
`aria-label="Aide"` (jamais une icône muette), le thème et l'avatar. Les entrées retirées de la
barre sont **toutes** dans le menu avatar, disponible à toutes les largeurs : plus aucune page
ne devient inatteignable sur téléphone. Le panneau du menu occupe la largeur disponible moins
les marges et reste ancré à droite ; sa hauteur est bornée avec défilement interne, l'en-tête
d'identité restant visible.

**Clavier — à préserver intégralement.** L'implémentation actuelle satisfait déjà
`docs/04-UX-UI.md:67` (« navigation clavier complète ») et `:100`. Le nouveau menu doit
conserver, sans exception :

| Comportement | Référence actuelle |
|---|---|
| `Entrée` / `Espace` ouvrent (comportement natif du `<button>`) | `user-menu.tsx:132-141` |
| `↓` / `↑` sur le déclencheur ouvrent **et placent le focus** sur le premier / dernier élément | `user-menu.tsx:84-92`, `:75-82` |
| `↓` / `↑` dans le menu circulent, `Début` / `Fin` vont aux extrémités | `user-menu.tsx:94-109` |
| `Tab` sort du menu **et le ferme** (un menu ouvert derrière le focus est une zone morte) | `user-menu.tsx:110-114` |
| `Échap` ferme **et rend le focus au déclencheur** | `user-menu.tsx:54-59`, `:44-47` |
| Clic extérieur ferme sans voler le focus | `user-menu.tsx:51-53` |
| `aria-haspopup="menu"`, `aria-expanded`, nom accessible portant l'identité | `user-menu.tsx:137-139` |

Trois exigences **nouvelles**, imposées par les groupes et l'entrée conditionnée :

1. les séparateurs et l'en-tête d'identité ne sont **pas** focusables (`role="separator"` /
   contenu inerte). La collecte des éléments navigables interroge le DOM
   (`user-menu.tsx:69-73`), elle reste donc juste quand « Administration » disparaît — à
   condition que seules les vraies entrées portent `role="menuitem"` ;
2. le nom accessible du déclencheur n'est plus l'adresse seule : il annonce l'identité
   (« Menu du compte — <nom ou adresse> »), l'avatar restant `aria-hidden` puisqu'il ne porte
   aucune information que le libellé ne donne déjà ;
3. l'entrée correspondant à la route courante porte `aria-current="page"`, comme les onglets le
   font déjà (`account-tabs.tsx:50-52`). La correspondance se fait sur le **premier segment**,
   pour que `/compte/securite` allume bien « Mon compte » — même règle que `segmentActif`
   (`admin-model.ts:75-84`, qui prend soin de comparer des frontières de segment et non des
   préfixes).

### 7. L'avatar : une seule autorité, celle du serveur

**Les initiales calculées côté serveur font autorité** — `initialsOf(name, email)`,
`apps/api/src/account/account.controller.ts:323-333`, servi dans `ProfileView.initials`
(`:69`, `:310`). Elles reposent sur le **nom affiché**, c'est-à-dire ce que la personne a
choisi, et ne retombent sur l'adresse qu'en l'absence de nom. **`initialsOfEmail`
(`user-menu.tsx:210-215`) est supprimé.** Tant que deux fonctions coexistent, la même personne
porte deux paires de lettres selon l'écran (§ Constat 4), et c'est le profil — pas le header —
qui a raison : c'est là que l'utilisateur a saisi son nom et voit le résultat.

Conséquences à assumer :

- le header a besoin du profil. Il le lit **une fois** et le partage avec l'espace `/compte` par
  un petit contexte client, plutôt qu'un second appel par page. Le surcoût n'introduit pas une
  classe de coût nouvelle : le header appelle déjà `GET /me/platform-access` à chaque page
  (`app-header.tsx:28`) et le sélecteur d'organisation `GET /organizations`
  (`org-switcher.tsx:35`) ;
- **pendant le chargement, la pastille reste neutre — aucune lettre.** Afficher des initiales
  provisoires calculées depuis l'email puis les remplacer serait exactement le défaut qu'on
  corrige, en pire : visible à chaque chargement.

**Règle d'affichage : photo si elle existe, initiales sinon.** La règle de repli est unique et
vit **côté serveur** : le client affiche ce qu'on lui donne et ne décide rien.

**Ce document ne fixe pas le contrat de la photo.** L'envoi est en cours de construction côté
API par un autre chantier ; ni le nom du champ, ni la forme de l'URL ne sont figés. La
navigation s'engage seulement sur ceci, qui vaut quelle que soit cette forme :

- l'avatar apparaît à **deux endroits, et deux seulement** : le déclencheur du menu dans la barre
  (petit format, décoratif, `aria-hidden` — l'identité est déjà dans le nom accessible du bouton)
  et l'en-tête du panneau ouvert (format moyen, aux côtés du nom et de l'adresse). Le rendu
  grand format reste sur `/compte` (`profile-panel.tsx:129`) ;
- l'absence de photo n'est **pas un état d'erreur** et ne produit ni bordure pointillée, ni
  point d'interrogation : les initiales sont l'état normal du produit aujourd'hui ;
- une photo qui **échoue à se charger** retombe sur les initiales, sans case brisée. Une URL peut
  expirer, un bucket peut répondre 403 ;
- **le format de l'avatar ne change pas la mise en page** : dimensions fixes, cadre circulaire,
  image recadrée en `cover`. Sans cela, la barre bouge entre le rendu des initiales et l'arrivée
  de l'image ;
- **prérequis d'affichage à lever le moment venu** : la CSP interdit toute image distante,
  `img-src 'self' data: blob:` (`apps/web/next.config.mjs:62`). Selon ce que renverra l'API —
  une URL absolue vers un stockage objet, une URL relative servie par l'API, ou une donnée
  encodée — ce sera soit une origine à ajouter à la directive, soit rien du tout. La décision
  appartient à `docs/17-SECURITE.md` et fait l'objet de DO-3.

### 8. Étapes

Le lot web sera confié à **un seul agent** : les étapes sont **séquentielles**, pas parallèles.
Trois d'entre elles touchent `app-header.tsx` ou `user-menu.tsx`, et deux agents s'y
percuteraient. L'ordre ci-dessous est aussi celui de la valeur décroissante : E1 rend
`/organisation` atteignable et répare le mobile, ce qui est l'urgence.

| Étape | Contenu | Frontières de fichiers | Dépend de |
|---|---|---|---|
| **E1 — Barre et menu** (aucun changement d'URL) | La barre perd trois liens ; le menu avatar prend les six entrées du §1 ; « Administration » y est conditionnée par le drapeau déjà chargé ; règles mobile et clavier du §6. | `apps/web/src/app/(app)/_components/app-header.tsx` · `_components/user-menu.tsx` · **nouveau** `_components/user-menu-model.ts` + `user-menu-model.test.ts` | — |
| **E2 — Membres sous organisation** | Déplacement de la page, ajout de l'onglet, redirection permanente. | déplacement `apps/web/src/app/(app)/members/**` → `apps/web/src/app/(app)/organisation/membres/**` · `organisation/_components/organization-model.ts` + `organization-model.test.ts` · `apps/web/next.config.mjs` (bloc `redirects()`) · **inchangés** : `apps/web/src/lib/routes.ts`, `routes.test.ts`, toute l'API | E1 (l'entrée « Organisation » doit exister avant que Membres ne disparaisse de la barre) |
| **E3 — Avatar autoritaire** | Le header consomme les initiales du serveur ; `initialsOfEmail` est supprimé ; la pastille reste neutre au chargement. | `apps/web/src/app/(app)/_components/user-menu.tsx` · **nouveau** `_components/profile-context.tsx` · `apps/web/src/app/(app)/compte/_components/profile-panel.tsx` (consomme le contexte au lieu de refaire l'appel) · `apps/web/src/lib/api.ts` (type consommé, aucun nouveau champ inventé) | E1 |
| **E4 — Photo dans la navigation** | Branchement de la photo aux deux emplacements du §7, repli sur les initiales, garde-fous de mise en page. | `apps/web/src/app/(app)/_components/user-menu.tsx` · `_components/profile-context.tsx` · `apps/web/src/lib/api.ts` (alignement sur le contrat d'API une fois figé) · `apps/web/next.config.mjs` (`img-src`, **si et seulement si** l'URL est distante) · `docs/17-SECURITE.md` | E3 **et** contrat d'API figé par le chantier en cours |
| **E5 — Documentation** | Section « Navigation » de `docs/04`, correction de l'affirmation de `docs/04:130`. | `docs/04-UX-UI.md` | E1 à E4 livrées ou arbitrées |

E4 est la seule étape qui peut rester en attente sans bloquer les autres : jusqu'à ce qu'un
contrat d'API existe, l'avatar affiche les initiales et le produit est cohérent.

## Conséquences

- Un espace entier, `/organisation`, cesse d'être inatteignable — et `docs/04-UX-UI.md:130`
  cesse de décrire une entrée qui n'existe pas.
- Trois pages cessent d'être inatteignables sous 640 px.
- La barre passe de sept éléments à cinq, sans qu'aucune destination ne disparaisse.
- Une URL publique change. C'est la seule dette créée, et elle est bornée par une redirection
  permanente ; aucun email n'en dépend (vérifié, `mail.links.ts`).
- Le menu du compte devient le point d'entrée unique vers tout ce qui n'est pas un projet. Il
  faudra le tenir : chaque nouvel espace devra déclarer s'il est un onglet d'un espace existant
  ou une entrée du menu, jamais un huitième lien dans la barre.
- Les initiales deviennent stables. Certains comptes verront leurs lettres **changer une fois**,
  au déploiement — celles du profil deviennent les bonnes partout.
- Sécurité et Préférences passent à deux clics au lieu d'un. Coût accepté avec l'arbitrage
  « une seule entrée Mon compte ».

## Plan de validation

- `user-menu-model.test.ts` (nouveau) : ordre des six entrées, filtrage d'« Administration »
  selon `canReadAdmin`, entrée active déduite du premier segment du chemin (`/compte/securite`
  allume « Mon compte », `/comptes-annuels` n'allume rien) — logique pure, testable sans DOM,
  comme `admin-model.ts` et `organization-model.ts` le font déjà (`admin-model.ts:3-5`).
- `organization-model.test.ts` : l'onglet « Membres » est absent sans `organization.manage`,
  présent avec, et absent tant que les permissions sont inconnues.
- Test de redirection : `GET /members` répond 308 vers `/organisation/membres` ;
  `/members-quelque-chose` n'est pas capturé par erreur.
- Test de non-régression clavier sur le menu : les sept comportements du tableau du §6, plus
  l'absence de trou dans la circulation quand « Administration » est masquée.
- Revue manuelle à 375 px : chaque destination du menu est atteignable, Aide garde un nom
  accessible, le panneau ne provoque pas de défilement horizontal.
- Contrôle documentaire : plus aucune occurrence de `href="/members"` ni d'appel à
  `initialsOfEmail` dans `apps/web/src`.

## Décisions ouvertes — elles appartiennent au décideur

**DO-1 — L'onglet Membres doit-il être masqué aux six rôles qui ne peuvent pas le lire ?** Le
filtrage retenu (§3) suit la doctrine des onglets d'organisation. Il a un coût : ces six rôles
perdent le chemin de découverte vers la page qui leur explique justement ce que leur rôle
permet (`members/page.tsx:10-13`). L'espace `/admin` a tranché l'inverse pour quatre de ses cinq
onglets — visibles, avec un refus explicite à l'arrivée (`docs/04-UX-UI.md:187-189`). Les deux
positions se défendent ; elles ne devraient pas coexister sans raison.

**DO-2 — Deux portes vers l'argent.** « Abonnement » (`/souscription`, tunnel autonome,
`souscription/page.tsx:3-7`) et « Facturation » (`/organisation/facturation`, réservé au
Propriétaire) sont deux écrans distincts sur le même sujet. Ce document conserve les deux avec
des libellés distincts et le lien croisé existant (`subscription-funnel.tsx:456`). Les fusionner
— ou faire de la facturation la seule porte, le tunnel n'étant qu'un parcours — est une décision
produit.

**DO-3 — Origine autorisée pour les images de profil.** Dès que le contrat d'API de la photo
sera figé, il faudra savoir si la CSP doit accepter une origine distante
(`apps/web/next.config.mjs:62`). Le même besoin existe pour le logo d'organisation, aujourd'hui
saisi par URL faute de stockage (`docs/04-UX-UI.md:157`) : les deux devraient relever du même
stockage et de la même directive, pas de deux réponses différentes.

## Liens

- `CLAUDE.md` — ADR obligatoire pour une décision structurante.
- `docs/03-PARCOURS-UTILISATEUR.md:62-70` — principes UX, dont « accessibilité et navigation clavier ».
- `docs/04-UX-UI.md:10-16` — architecture de navigation cible ; `:60-73` responsive et accessibilité ; `:79-115` espace compte ; `:117-160` espace organisation ; `:161-215` espace admin.
- `docs/12-ROLES-PERMISSIONS.md` — rôles et actions ; ADR-0012 pour le modèle exécutable.
- ADR-0012 §8 — aucune matrice de rôles côté client. ADR-0012 §9 — `/compte` sans organisation.
- ADR-0009 — infrastructure DigitalOcean (stockage objet, arrière-plan de DO-3).
- ADR-0013 — secrets d'intégration (espace `/admin`, onglet conditionné).
- `apps/api/src/authz/permissions.ts` — source de vérité unique des permissions.
