# ADR-0038 — Navigation par modules (accueil, bureaux, colonne d'applications) et « Initiative »

Statut : Accepté
Date : 2026-10-29
Décideurs : Gracy Omokoso (dirigeante) — **décisions validées le 29 oct. 2026** (lot R0) ;
équipe de développement (traduction technique).

> **Amende [ADR-0030](ADR-0030-refonte-ui-ux.md) § 2 et § 8** : la barre latérale à quatre
> groupes (BUILD · RUN · GROW · Organisation) cède la place à une navigation **à trois
> niveaux** (barre du haut → bureau du module → colonne des applications du module). Le
> design system, les jetons, la mise en route, la barre basse du téléphone et les règles
> d'accès d'ADR-0030 sont conservés.
> **Amende [ADR-0016](ADR-0016-navigation-applicative.md) § 1** : le menu de l'avatar perd ses
> entrées de travail quotidien (Tableau de bord, Ventes, Trésorerie, Croissance), désormais
> portées par la barre du haut, et reçoit les réglages de l'organisation.
> **Tranche [ADR-0030](ADR-0030-refonte-ui-ux.md) D1, D2 et D4.**
> **Aucun nom interne ne change** : modèles Mongoose, routes d'API `/projects`, type
> `Project`, permissions `project.*`. Seuls changent le texte visible et les routes web.

## Contexte

ADR-0030 a rendu les trois modules visibles, mais dans **une seule colonne** qui liste toutes
les fonctions de toutes les familles : vingt et une entrées depuis l'arrivée de l'Idea Lab, du
business plan, du CRM, des devis, des encaissements, de la trésorerie et de l'espace
Croissance (ADR-0031 à ADR-0037). La colonne défile, le module courant se perd, et la
dernière section (« Organisation ») mélange les réglages avec le travail quotidien.

Deux constats de vocabulaire s'y ajoutent :

1. **« Plans financiers » nomme mal l'objet.** Ce que l'utilisateur crée dans BUILD
   (`/projects`) porte un Canvas, des objectifs, un plan financier, un réalisé et un business
   plan : c'est une **initiative** d'entreprise, dont le plan financier n'est qu'une partie.
   Le parcours BUILD se lit désormais : **Idées → Validation → Initiatives → Business plan**.
2. **Le mot « Projets » est réservé** au futur gestionnaire de tâches de RUN (lot R1). Le
   garder pour l'objet de BUILD créerait deux « projets » de sens différents dans le même
   produit.

La dirigeante a validé le 29 oct. 2026 les décisions ci-dessous ; elles ne sont pas soumises
à nouvelle discussion ici.

## Options considérées

1. **Garder la colonne unique et la replier par groupe.** Écarté : les entrées restent
   mêlées ; rien ne dit « où je suis » au premier coup d'œil.
2. **Onglets de modules dans la barre du haut, sans page de module** (le clic ouvre la
   première application). Écarté : l'utilisateur ne voit jamais ce que le module contient.
3. **Trois niveaux : barre des modules → bureau du module → colonne des applications.**
   Retenu (décision de la dirigeante).

## Décision

### 1. « Initiative » (BUILD)

- Libellé visible : **Initiative** (féminin) — « une initiative », « Nouvelle initiative »,
  « Créer l'initiative », « Nom de l'initiative », « Initiatives » (entrée et titre),
  « 1 initiative / 3 initiatives », « initiative archivée ». Les accords sont vérifiés à la
  relecture (adjectifs et participes au féminin).
- **Routes web** : `/projects/...` devient `/initiatives/...` (liste, fiche, saisie, Canvas,
  objectifs, réalisé, business plan de l'initiative). Les anciennes URL **redirigent en 308**
  (`next.config.mjs`, bloc `redirects()`) : `/projects` → `/initiatives` et
  `/projects/:path*` → `/initiatives/:path*`. La chaîne de requête est conservée par Next
  (`/projects?idee=…` → `/initiatives?idee=…`). Aucun email ne pointait sur `/projects`
  (vérifié, `apps/api/src/mail/mail.links.ts`).
- **Inchangés** : collections et schémas Mongoose, routes d'API `/projects`, types `Project*`,
  permissions `project.*`, codes d'erreur (`PLAN_LIMIT_PROJECTS`…), noms de fichiers et de
  dossiers de code hors `apps/web/src/app/(app)/initiatives`.
- **Ce qui n'est PAS renommé** : les autres sens du mot « projet » — le projet
  entrepreneurial au sens large dans un texte d'aide (« votre projet d'entreprise »), les
  documents juridiques (CGU, CGV, confidentialité : leur modification relève d'une revue
  juridique, voir § Points ouverts), et le futur « Projets » de RUN.

### 2. Navigation à trois niveaux

**Niveau 1 — barre du haut** : `[Accueil] [BUILD] [RUN] [GROW]`, puis Aide, thème et avatar à
droite. Chaque module porte sa petite icône (§ 4). Sur grand écran, la marque et le
sélecteur d'organisation (avec l'offre effective, ADR-0030 § 3) sont à gauche des onglets.
Sous 1024 px : bouton du tiroir, onglets réduits à leur icône (nom accessible et info-bulle
conservés — jamais une icône muette), avatar ; le sélecteur d'organisation passe dans le
tiroir. Le thème reste offert sous 640 px dans `/compte/preferences` (règle ADR-0016 § 6 : rien
n'est masqué sans autre chemin d'accès). L'onglet du module courant porte
`aria-current="page"`.

**Niveau 2 — bureau du module** (`/build`, `/run`, `/grow`) : en-tête du module (nom, verbe,
description) puis la **grille de tuiles** de ses applications, façon bureau : icône de
navigation existante (`NavIconId`) en grand, libellé, courte description. Grille de
**2 colonnes sur téléphone**, 3 à 4 au-delà. Une tuile n'apparaît que si son application est
visible pour le rôle (§ 3).

**Niveau 3 — page d'application** : la page de détail existante, inchangée. La colonne de
gauche ne liste **que les applications du module courant** ; une application qui a des
sous-options se **déroule** (bouton `aria-expanded`, ouverte d'office quand on est dedans).
Sur téléphone, la colonne devient le tiroir (dialogue modal d'ADR-0030 § 5). Hors module
(Accueil, Mon compte, réglages de l'organisation, administration), il n'y a pas de colonne :
la page prend toute la largeur, le tiroir du téléphone liste alors les trois modules.

**Module courant** : déduit du chemin, par frontière de segment, la plus longue
correspondance gagne (même règle que `entreeActive`). `/build`, `/run`, `/grow` désignent
leur module ; sinon le module est celui de l'application (ou de la sous-option) qui
correspond. `/organisation` seul et `/organisation/brief` sont GROW ; les autres
`/organisation/*` ne sont d'aucun module.

#### Applications par module

| Module | Application | Destination | Condition (confort) | Sous-options |
|---|---|---|---|---|
| BUILD | Idées | `/idees` | aucune | — |
| BUILD | Validation | `/idees/validation` | aucune | — |
| BUILD | Initiatives | `/initiatives` | aucune | — |
| BUILD | Business plan | `/business-plan` | aucune | — |
| RUN | Factures | `/ventes/factures` | `sales.read` | Modèle de facture (`/ventes/modele-facture`) · Journal (`/ventes/factures/journal`) |
| RUN | Devis | `/ventes/devis` | `sales.read` | — |
| RUN | Encaissements | `/ventes/encaissements` | `sales.read` | — |
| RUN | Clients | `/ventes/clients` | `sales.read` | — |
| RUN | Catalogue | `/ventes/catalogue` | `sales.read` | — |
| RUN | CRM | `/ventes/crm` | `crm.read` | Pipeline · Contacts et prospects · Réglages du pipeline |
| RUN | Trésorerie | `/tresorerie` | `treasury.read` | Dépenses · Comptes · Réalisé vs prévu |
| GROW | Pilotage | `/organisation` | aucune | — |
| GROW | Brief du matin | `/organisation/brief` | aucune | — |
| GROW | Santé | `/croissance/sante` | aucune | — |
| GROW | Indicateurs investisseurs | `/croissance/investisseurs` | aucune | — |
| GROW | Parcours | `/croissance/parcours` | aucune | — |

Les onglets internes des espaces (Ventes, Trésorerie, Croissance, CRM) restent en place : ils
portent la lecture des permissions de leur espace et ne sont pas réécrits dans ce lot.

### 3. Conditions d'affichage

Inchangées par rapport à ADR-0030 : une application (ou sous-option) porte une `action`
servie par `GET /me/permissions`, ou `null`. Tant que les permissions ne sont pas connues,
seules les entrées sans condition s'affichent. Masquer est un confort ; l'API refuse
(ADR-0012 § 8). Un module dont aucune application n'est visible garde son onglet (le
bureau explique alors que rien n'est ouvert au rôle) : l'onglet ne disparaît pas sous
l'utilisateur pendant le chargement.

**Révisé le 29 oct. 2026 (choix de Gracy)** : les rangées d'onglets internes qui
répétaient la colonne — Ventes (Factures, Devis, Encaissements, Clients, Catalogue, CRM,
Modèle de facture), Trésorerie (Dépenses, Comptes, Réalisé vs prévu) et la sous-navigation
du CRM (Pipeline, Contacts, Réglages) — sont retirées. La colonne de gauche, et le tiroir sur
téléphone, sont la seule navigation entre ces sections ; les espaces gardent leur en-tête
et leur frontière d'accès (refus explicite sans `sales.read` / `treasury.read`).

### 4. Icônes de module

Révisé le 29 oct. 2026 (choix de Gracy) : icônes **Lucide** (`lucide-react`, licence ISC),
dépendance de `packages/ui` — style outline (viewBox 24, trait `currentColor`, extrémités
arrondies), qui remplace les trois tracés dessinés à la main. **BUILD** = `Sprout` (l'idée
qui germe), **RUN** = `Orbit` (ce qui tourne), **GROW** = `Rocket` (ce qui décolle).
Composant `ModuleIcon` dans `packages/ui`, réutilisé en petit (barre du haut, tiroir) et en
grand (cartes de l'accueil, bureaux). Couleur : `--module-build/run/grow`. Les autres
icônes de l'application peuvent passer à Lucide au fil des lots.

### 5. Accueil (`/accueil`)

Page d'arrivée après connexion (middleware, connexion, inscription, acceptation
d'invitation, changement d'organisation, marque). Contenu :

1. **Trois grandes cartes BUILD · RUN · GROW** : nom en grand, verbe dessous (Concevoir /
   Exploiter / Croître), icône du module dans une pastille à sa couleur, deux ou trois
   chiffres utiles en tuiles (grand chiffre, libellé dessous) **lus sur des API existantes**, lien vers le bureau du module.
   - BUILD : nombre d'initiatives (`GET /projects`), nombre d'idées actives
     (`GET /idea-lab/ideas`).
   - RUN (si `sales.read`) : factures à encaisser et factures en retard
     (`GET /sales/settlements?open=true`).
   - GROW : alertes du brief du matin (`GET /morning-brief`), score de santé quand il est
     calculable (`GET /grow/health`).
   - Un chiffre illisible (droit manquant, offre, panne) n'est **pas inventé** : la carte
     affiche une phrase d'appel (« Ouvrir le module… ») à sa place.
2. **Ce qui concerne toute l'entreprise** : les alertes du brief du matin (trois au plus, lien
   vers le brief complet) et le rappel de mise en route tant qu'une étape reste ouverte
   (anciennement en bas de la barre latérale).

Règle d'ADR-0016 conservée : la page ne promet rien qui n'existe pas. Aucune API nouvelle.

Le choix des modules de la mise en route (ADR-0030 § 8, D3) **ne masque plus rien** : il
place les modules choisis en tête de l'accueil. La barre du haut garde un ordre fixe
(BUILD → RUN → GROW), pour que la mémoire des gestes ne dépende pas d'un réglage.

### 6. Organisation dans le menu de l'avatar

« Organisation » n'est plus un module. Le menu de l'avatar devient :

| Groupe | Entrée | Destination | Condition |
|---|---|---|---|
| 1 | Mon compte | `/compte` | aucune |
| 2 — Organisation | Mise en route | `/organisation/mise-en-route` | aucune |
| 2 | Identité visuelle | `/organisation/identite` | `organization.manage` |
| 2 | Fiscalité | `/organisation/fiscalite` | `fiscal.manage` |
| 2 | Membres | `/organisation/membres` | `organization.manage` |
| 2 | Paramètres | `/organisation/parametres` | `organization.manage` |
| 2 | Abonnement | `/souscription` | aucune |
| 3 | Administration | `/admin` | `canReadAdmin` |
| 4 | Déconnexion | — | session |

Les permissions viennent de la coquille (`GET /me/permissions`, déjà lue une fois) : le menu
n'émet **aucun appel supplémentaire**. Tant qu'elles ne sont pas connues, seules les entrées
sans condition s'affichent. Facturation et Journal d'audit restent des onglets de
`/organisation`.

**« Pilotage » (`/organisation`, tableau de bord par rôle) va dans GROW** (recommandation
retenue) : il lit les écarts, ratios et validations — c'est du pilotage, pas un réglage.

### 7. Barre basse du téléphone

Conservée (ADR-0030 § 6). Sa première entrée devient « Initiatives » (`/initiatives`).

## Conséquences

- La navigation latérale passe de 21 entrées à 4–7 selon le module ; le module courant se
  lit dans la barre du haut et dans le titre de la colonne.
- Quatre routes web nouvelles (`/accueil`, `/build`, `/run`, `/grow`), protégées par session
  comme les autres espaces (`lib/routes.ts`).
- Une famille d'URL publiées change (`/projects/*`) ; dette bornée par la redirection 308,
  testée (`redirects.test.ts`).
- `nav-model.ts` porte désormais modules, applications, sous-options, module courant et
  ordre de l'accueil ; `user-menu-model.ts` les entrées d'organisation. Tous deux restent
  de la logique pure testée sans DOM.
- Le rail de trajectoire de la barre latérale (ADR-0030 § 1.6) disparaît avec la barre ; la
  trajectoire BUILD → RUN → GROW est désormais lue dans l'ordre des onglets et des cartes de
  l'accueil.

## Plan de validation

- `nav-model.test.ts` : applications par module, sous-options, filtrage par permission
  (et permissions inconnues), module courant depuis le chemin (dont `/organisation` vs
  `/organisation/fiscalite`, `/ventes/modele-facture`, `/initiatives-x`), ordre de l'accueil.
- `user-menu-model.test.ts` : entrées, groupes, conditions, séparateurs.
- `redirects.test.ts` : `/projects` et `/projects/:path*` en 308 vers `/initiatives`.
- `routes.test.ts` : les nouvelles routes exigent une session.
- Revue visuelle en 1440 px et 375 px : barre sans débordement, tiroir, bureau en deux
  colonnes, accueil.

## Points ouverts pour la dirigeante

1. **Documents juridiques** (CGU, CGV, politique de confidentialité) : ils disent « projet ».
   Les modifier change un texte accepté par les utilisateurs ; à faire avec la prochaine
   version des CGU (ADR-0016, acceptation versionnée), pas dans ce lot.
2. **Nom du score de santé et des chiffres de l'accueil** : faut-il d'autres chiffres (chiffre
   d'affaires du mois vs prévu) ? Ils demanderaient une API d'agrégat nouvelle.
3. **Onglets internes en double** de la colonne (Ventes, Trésorerie) : les retirer dans un
   lot suivant, une fois la colonne éprouvée sur téléphone réel ?

## Liens

- [ADR-0016](ADR-0016-navigation-applicative.md) (amendé) ;
  [ADR-0030](ADR-0030-refonte-ui-ux.md) (amendé) ;
  [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) ;
  [ADR-0033](ADR-0033-brief-du-matin.md) ; [ADR-0036](ADR-0036-idea-lab-et-validation.md) ;
  [ADR-0037](ADR-0037-business-plan-narratif.md).
- Code : `apps/web/src/app/(app)/_components/nav-model.ts`, `user-menu-model.ts`,
  `app-shell.tsx`, `app-header.tsx`, `sidebar.tsx`, `apps/web/src/app/(app)/accueil/`,
  `apps/web/src/app/(app)/[module]` (`build`, `run`, `grow`),
  `packages/ui/src/components/module-icon.tsx`, `apps/web/next.config.mjs`.
