# ADR-0030 — Refonte de l'interface : navigation par module, design system, mise en route

Statut : Proposed
Date : 2026-10-21
Décideurs : Gracy Omokoso (demande : « le design Lalanda actuel n'est plus adapté ») ;
équipe de développement (proposition, en attente de revue — **non publiée**)

> **Amende [ADR-0016](ADR-0016-navigation-applicative.md)** : la navigation principale
> quitte le menu de l'avatar pour une **barre latérale par module** (BUILD · RUN · GROW ·
> Organisation). Le menu du compte est conservé tel quel (ses sept entrées, son clavier,
> ses tests) ; il redevient ce que son nom dit : le menu **du compte**. La barre du haut
> garde ses cinq éléments (marque, sélecteur d'organisation, Aide, thème, avatar), le
> sélecteur d'organisation passant en tête de la barre latérale sur grand écran.
> Aucune logique métier, aucun appel d'API, aucune règle d'accès ne change.

## Contexte

Depuis l'ADR-0018 (amendement du 18 oct. 2026), Lalanda n'est plus un générateur de plan
financier mais **trois ensembles synchronisés** : BUILD (concevoir : plan d'affaires,
prévisionnel), RUN (exploiter : ventes, factures, facture normalisée DGI, fiscalité) et
GROW (croître : pilotage, analyses, IA qui explique). L'interface, elle, est restée celle
d'un outil à un seul usage. L'audit ci-dessous a été fait sur l'application lancée
(v0.1.0-dev, branche `main` à v0.9.4), en 1440 × 900 et en 390 × 844 ; les captures
« avant » sont dans [`docs/refonte-ui/`](../refonte-ui/).

### Audit — ce qui ne va plus

| # | Constat | Où | Gravité |
|---|---|---|---|
| A1 | **Les trois modules sont invisibles.** RUN (« Ventes ») n'est atteignable que par le menu de l'avatar ; GROW n'a aucune entrée ; BUILD se confond avec « Tableau de bord ». Rien ne dit à l'utilisateur que Lalanda fait plus qu'un plan. | `app-header.tsx`, `user-menu-model.ts` | Haute |
| A2 | **Débordement horizontal sur téléphone.** À 390 px la barre du haut (aigle + sélecteur + Aide + thème + avatar) dépasse l'écran : l'avatar — seule porte vers tout le reste — est coupé. | barre du haut | Haute |
| A3 | **Vendre sur téléphone est laborieux.** Il faut trois écrans de défilement (titre d'espace, paragraphe d'intro, onglets sur deux lignes, filtres empilés) avant de voir le premier client ; « Nouveau document » n'est pas à portée de pouce. | `/ventes/*` | Haute |
| A4 | **Colonne unique de 1024 px** sur tous les écrans : tableaux de factures et formulaires fiscaux à l'étroit sur bureau, grandes marges perdues. | `(app)/layout.tsx` (`max-w-5xl`) | Moyenne |
| A5 | **Aucun repère de l'endroit où l'on est.** Chaque espace refait son propre titre et ses propres onglets (trois copies de la même chaîne de classes : projet, organisation, ventes). Aucun fil d'Ariane hors projet. | `project-tabs.tsx`, `organization-tabs.tsx`, `sales-access.tsx` | Moyenne |
| A6 | **Pas de système de composants.** `packages/ui` est un squelette (S0) ; les boutons, champs, pastilles et alertes sont redéfinis par écran (`form-ui.tsx`, `normalized-invoicing-panel.tsx`, `fiscal-profile-panel.tsx`…), avec des variantes qui divergent (bordure, rayon, hauteur). | tout `apps/web` | Moyenne |
| A7 | **Contraste juste.** Le texte secondaire `#6c685a` sur le fond crème `#eee7d7` est à ~4,6:1 — conforme de justesse, en dessous dès qu'il est posé sur `--surface-muted`. Les champs ont un fond crème sur fond crème : leur limite tient à une bordure à 1,3:1. | `globals.css` | Moyenne |
| A8 | **Les natures de données ne se voient pas.** ADR-0018 exige que hypothèses, prévisions, réalisés et suggestions de l'IA restent distinctes et étiquetées ; il n'existe aucun composant pour le dire, chaque écran l'écrit (ou non) à sa façon. | résultats, réalisé, Lala | Moyenne |
| A9 | **Une organisation neuve ne sait pas par où commencer.** Identité visuelle, fiche fiscale, points de vente : trois onglets séparés, découverts par hasard, sans ordre ni progression. | `/organisation/*` | Moyenne |
| A10 | **L'offre ne se voit qu'au refus.** On découvre la limite du plan (1 projet en Gratuit) en cliquant « Créer », jamais avant. | `/projects` | Basse |

## Options considérées

1. **Repeindre** (nouvelles couleurs, mêmes gabarits). Écarté : ne corrige ni A1, ni A2, ni A3.
2. **Tout réécrire écran par écran.** Écarté : des milliers de lignes de logique éprouvée
   (normalisation DGI, ré-authentification, révisions concurrentes) pour un gain visuel ;
   risque de régression disproportionné, et d'autres chantiers modifient ces écrans en
   parallèle.
3. **Coquille neuve + jetons + composants partagés, migration par le haut.** Retenu. La
   coquille (navigation, en-tête, pied) et les jetons changent tout l'aspect d'un coup, car
   les écrans lisent déjà leurs couleurs dans des variables CSS ; les en-têtes et onglets
   d'espace passent aux composants partagés ; le cœur des écrans n'est pas touché.

## Décision

### 1. Principes

1. **Le module d'abord.** On sait toujours dans quel ensemble on se trouve (BUILD, RUN,
   GROW, Organisation) : la barre latérale le dit, l'en-tête d'espace le répète.
2. **La nature de la donnée est écrite, jamais seulement colorée.** Hypothèse, prévision,
   réalisé, suggestion de l'IA : une étiquette, une forme, puis une couleur en renfort.
3. **RUN se pratique au pouce.** Les écrans de vente sont conçus à 360 px d'abord ; l'action
   « Facturer » est à portée de pouce sur téléphone.
4. **Une seule source de chaque décision.** Les permissions viennent du serveur
   (`GET /me/permissions`), l'offre aussi (`GET /organizations/current/subscription`) ; l'interface masque
   par confort, l'API refuse (ADR-0012 §8). Aucune matrice recopiée.
5. **Un refus est une réponse.** Section non ouverte au rôle, fonction non incluse dans
   l'offre : on dit pourquoi et à qui s'adresser, sans bandeau rouge.
6. **Sobre partout, une signature.** La seule fantaisie est le **rail de trajectoire** de la
   barre latérale : BUILD → RUN → GROW reliés par un trait, rappel permanent de la
   synchronisation qui fait la valeur du produit.

### 2. Architecture de l'information

```text
┌──────────────────────┬──────────────────────────────────────────────┐
│ [Org ▾]  Offre Pro   │ Aide · thème · avatar          (barre du haut)│
│                      ├──────────────────────────────────────────────┤
│ ● BUILD  Concevoir   │ RUN · Ventes                   (eyebrow)      │
│ │  Plans financiers  │ Factures                       (titre)        │
│ ● RUN    Exploiter   │ Factures · Clients · Catalogue · Modèle       │
│ │  Factures          │ ──────────────────────────────────────────    │
│ │  Clients           │ contenu                                       │
│ │  Catalogue         │                                               │
│ ● GROW   Croître     │                                               │
│    Pilotage          │                                               │
│ ─ Organisation       │                                               │
│    Mise en route 2/4 │                                               │
│    Identité visuelle │                                               │
│    Fiscalité         │                                               │
│    Membres · Abonn.  │                                               │
│ [«] v0.9.4 · CGU…    │                                               │
└──────────────────────┴──────────────────────────────────────────────┘
```

| Groupe | Entrée | Destination | Condition d'affichage (confort) |
|---|---|---|---|
| BUILD | Plans financiers | `/projects` | aucune |
| RUN | Factures | `/ventes/factures` | `sales.read` |
| RUN | Clients | `/ventes/clients` | `sales.read` |
| RUN | Catalogue | `/ventes/catalogue` | `sales.read` |
| GROW | Pilotage | `/organisation` (tableau de bord par rôle) | aucune |
| Organisation | Mise en route | `/organisation/mise-en-route` | aucune (chaque étape explique son refus) |
| Organisation | Identité visuelle | `/organisation/identite` | `organization.manage` |
| Organisation | Fiscalité | `/organisation/fiscalite` | `fiscal.manage` |
| Organisation | Membres | `/organisation/membres` | `organization.manage` |
| Organisation | Abonnement | `/souscription` | aucune |
| Organisation | Paramètres | `/organisation/parametres` | `organization.manage` |

- **Tant que les permissions ne sont pas connues**, seules les entrées sans condition
  s'affichent (même règle qu'`ongletsVisibles`, S21a) : pas de menu qui clignote.
- L'entrée active se déduit du chemin par **frontière de segment, la plus longue gagne**
  (même précaution que `entreeActive`) : `/organisation` allume « Pilotage »,
  `/organisation/fiscalite` allume « Fiscalité », `/ventes/factures/nouvelle` allume
  « Factures ».
- **« Modèle de facture » et « Journal »** restent des onglets de l'espace Ventes : la barre
  latérale ne liste que les destinations quotidiennes (frontière avec le chantier des
  modèles de facture : seule la coquille commune change).
- **GROW ne contient que « Pilotage »** tant que l'ADR dédié n'existe pas : la barre ne
  promet aucune page qui n'existe pas (ADR-0016, même règle que « aucune page de synthèse »).
- **Sélecteur d'organisation** : en tête de la barre latérale, avec le **nom de l'offre
  effective** sous le nom de l'organisation. Sous 1024 px, il vit dans le tiroir de
  navigation ; la barre du haut ne porte plus que la marque, le bouton du tiroir, Aide,
  thème et avatar — elle tient dans 360 px (corrige A2).
- **Repli** : sur bureau, la barre latérale se replie en rail d'icônes (72 px). Le choix est
  mémorisé dans le navigateur (`localStorage`, confort par appareil, lecture protégée).
  Chaque icône garde son nom accessible et une info-bulle.
- **Pied de la barre** : version du logiciel (ADR-0026 § 6.2 : visible de tout écran) et
  liens légaux.

### 3. Accès selon le plan

L'accès est réglé par les forfaits (ADR-0018), pas par des modules à activer.
- Le **nom de l'offre effective** est affiché sous l'organisation (lu une fois par la
  coquille, `GET /organizations/current/subscription`, partagé par contexte).
- Une fonction absente de l'offre reste **visible avec un cadenas et le nom de l'offre qui
  l'inclut**, jamais masquée : aujourd'hui, l'onglet « Réalisé » d'un projet quand
  `entitlements.actualsEnabled` est faux. La page atteinte garde son propre refus serveur.
- Lecture impossible de l'abonnement : rien n'est verrouillé côté interface (l'API tranche).

### 4. Design system (`packages/ui`)

**Jetons** (`packages/ui/src/styles/tokens.css`, miroir typé dans `tokens.ts`, contrastes
vérifiés par test). Les anciens noms (`--background`, `--surface`, `--accent`…) sont
conservés : tous les écrans existants changent d'aspect sans être réécrits.

| Rôle | Clair | Sombre | Note |
|---|---|---|---|
| `--background` (fond d'application) | `#F4F2ED` | `#08181D` | plus clair que le crème de charte, qui reste réservé à la marque |
| `--surface` | `#FFFFFF` | `#0E232A` | cartes, champs |
| `--surface-muted` | `#ECE8DF` | `#132E36` | |
| `--border` / `--border-strong` | `#D9D3C6` / `#8F8775` | `#21414B` / `#5A7C86` | bordure forte ≥ 3:1 (limite des champs, WCAG 1.4.11) |
| `--foreground` / `--foreground-muted` | `#14191B` / `#575449` | `#EEE7D7` / `#A7BEC4` | ≥ 4,5:1 sur fond, surface et surface atténuée |
| `--accent` / `--accent-foreground` | `#005263` / `#FFFFFF` | `#3CC4DD` / `#03242B` | pétrole de charte |
| `--focus` | `#007C93` | `#5AD2E8` | anneau de focus, ≥ 3:1 |
| `--module-build` / `-run` / `-grow` | `#005263` / `#00758C` / `#9C4F18` | `#96C9D7` / `#3CC4DD` / `#E39A5E` | |
| `--nav-*` (barre latérale) | pétrole profond `#00323D` | `#04141A` | identique d'esprit dans les deux thèmes |

**Couleur = module d'origine de la donnée.** Hypothèse (saisie dans BUILD, ardoise, cercle
vide), Prévision (calculée par le moteur, BUILD, demi-cercle), Réalisé (issu de RUN, cercle
plein), Suggestion de l'IA (GROW, étoile, bordure pointillée = « pas encore appliquée »).
Composant `DataNature`.

**Typographie** (inchangée dans ses familles, resserrée dans son usage) : Archivo pour les
titres d'espace et les grands nombres, avec retenue ; Poppins (charte) pour le texte ; IBM
Plex Mono pour les chiffres tabulaires et les surtitres de module. Échelle : 12 · 13 · 14 ·
16 · 20 · 24 · 30 px. Le corps reste à 14 px dans les écrans denses, 16 px dans les
parcours guidés.

**Espacements** : pas de 4 px (Tailwind). **Rayons** : 6 px (champs, pastilles), 10 px
(boutons, cartes), 14 px (panneaux, tiroirs). **Ombres** : deux niveaux seulement (carte,
surgissant).

**Composants** : `Button` (primaire, secondaire, discret, danger ; 3 tailles ; état
occupé), `Card`, `PageHeader` (surtitre de module, titre, description, actions),
`TabsNav` (onglets d'espace, `aria-current`, défilement horizontal sur téléphone au lieu
de deux lignes), `Badge` (tons neutre, info, succès, attention, danger — le texte porte
l'information), `DataNature`, `ModuleMark`, `Alert` (`role="alert"` pour les échecs,
`status` sinon), `EmptyState` (orienté vers la prochaine action), `Skeleton` (chargement,
`aria-hidden`, respect de `prefers-reduced-motion`), `Stepper` (parcours guidé).
`packages/ui` ne dépend pas de Next : les liens sont rendus par une fonction fournie par
l'application.

### 5. Accessibilité

- Contraste texte ≥ 4,5:1, éléments d'interface ≥ 3:1, **vérifiés par un test** sur les
  paires de jetons, dans les deux thèmes.
- Focus visible partout (`--focus`, 2 px, décalé) ; lien d'évitement « Aller au contenu ».
- Barre latérale : `nav` nommée, entrée courante `aria-current="page"`, groupes titrés ;
  bouton de repli avec `aria-expanded` ; en rail, nom accessible conservé.
- Tiroir mobile : dialogue modal (`aria-modal`), focus piégé, `Échap` ferme et rend le focus
  au bouton, défilement de la page bloqué.
- Aucune information portée par la seule couleur (natures de données, statuts, cadenas).
- `prefers-reduced-motion` : aucune animation de tiroir ni de squelette.

### 6. Responsive

- **≥ 1024 px** : barre latérale fixe (repliable), contenu jusqu'à 1280 px.
- **< 1024 px** : barre du haut compacte + tiroir ; **barre d'actions basse** sur téléphone
  pour RUN (Plans · Factures · **Facturer** · Clients · Menu), affichée seulement si le rôle
  a `sales.read`. « Facturer » mène à `/ventes/factures/nouvelle` (écran existant).
- Onglets d'espace : une ligne qui défile horizontalement, jamais deux lignes.
- En-têtes d'espace : description masquée sous 640 px quand elle ne fait que répéter le
  titre (elle reste lisible au lecteur d'écran) — le premier client se voit sans défiler.

### 7. États

Chaque écran garde ses états (docs/04 § États obligatoires) ; la refonte leur donne une forme
commune : chargement = squelettes à la taille du contenu (pas de saut), vide = `EmptyState`
avec l'action suivante, erreur récupérable = `Alert` + « Réessayer », refus = phrase qui dit
ce que le rôle permet, limite d'offre = cadenas + nom de l'offre.

### 8. Mise en route (onboarding) d'une organisation

Route `/organisation/mise-en-route`, quatre étapes, **reprenables** :

| Étape | Contenu | API réutilisée | Faite quand (lu sur le serveur) |
|---|---|---|---|
| 1. Identité visuelle | logo principal + 3 déclinaisons, couleurs, police | `GET/PUT /organizations/current/brand`, envoi de logos (ADR-0028) | un logo principal **ou** une couleur principale enregistrés |
| 2. Profil fiscal | raison sociale, NIF, RCCM, siège | `GET/PUT /organizations/current/fiscal-profile` | une fiche existe |
| 3. Points de vente | points de vente e-MCF, facture normalisée | `/organizations/current/normalized-invoicing…` (ADR-0021) | au moins un point de vente |
| 4. Modules | par quoi commencer : BUILD, RUN, GROW | aucune (voir décision ouverte D3) | un choix a été enregistré |

- **Reprenable sans état serveur nouveau** : la progression se **déduit des données déjà
  enregistrées**, pas d'un drapeau « onboarding terminé ». On revient où l'on s'était
  arrêté, sur n'importe quel appareil (sauf l'étape 4, voir D3).
- Les écrans des étapes 1 à 3 **sont** les panneaux existants (aucune logique dupliquée).
- Une étape fermée au rôle (ex. un Directeur financier n'a pas `organization.manage`) se
  présente comme telle, avec qui peut la faire, et se laisse passer.
- **Entrées** : la création d'une organisation depuis le sélecteur y mène directement ; une
  carte « Mise en route n/4 » reste dans la barre latérale tant qu'une étape est ouverte ;
  l'entrée « Mise en route » permet de la rouvrir à tout moment.
- **Le choix des modules n'ouvre ni ne ferme aucun accès** : il ordonne et filtre la barre
  latérale (« afficher tous les modules » le défait). L'accès reste celui de l'offre et du rôle.

## Conséquences

- `packages/ui` devient une vraie dépendance de `apps/web` (composants + jetons) ; Tailwind
  y lit les classes par `@source`.
- Les écrans existants ne sont **pas** réécrits : en-têtes et onglets d'espace passent aux
  composants partagés ; le reste hérite des jetons. Les classes locales (`form-ui.tsx`…)
  restent valides ; leur remplacement progressif par `Button`/`Field` est un travail
  d'entretien, pas un préalable.
- Les tests de logique (`*-model.test.ts`) sont inchangés ; la navigation latérale et la
  mise en route ont leurs propres modèles purs, testés sans DOM (`nav-model.test.ts`,
  `onboarding-model.test.ts`), et les jetons un test de contraste.
- docs/04-UX-UI.md gagne une section « Implémenté — Refonte (ADR-0030) ».

## Décisions soumises à la dirigeante

- **D1** — La navigation principale passe dans une barre latérale par module (amende
  ADR-0016, qui voulait « le menu du compte, point d'entrée unique vers tout ce qui n'est pas
  un projet »). Le menu de l'avatar est gardé à l'identique ; faut-il, à terme, le réduire au
  compte seul (Mon compte, Abonnement, Administration, Déconnexion) ?
- **D2** — « Tableau de bord » reste `/projects` (arbitrage d'ADR-0016). Une page d'accueil
  transverse BUILD/RUN/GROW (chiffre d'affaires réel du mois vs prévu, factures en attente
  DGI, prochaines étapes) est l'étape suivante naturelle : à décider.
- **D3** — Le choix des modules (étape 4) est mémorisé **dans le navigateur, par
  organisation** : aucune API n'existe pour lui. Le porter sur le serveur (champ de
  l'organisation ou préférence du membre ?) le rendrait commun aux appareils.
- **D4** — GROW n'affiche que « Pilotage » (le tableau de bord de l'organisation par rôle)
  en attendant l'ADR GROW.
- **D5** — Le fond d'application quitte le crème de charte (`#eee7d7`) pour `#F4F2ED`, plus
  clair : le crème reste la couleur de la marque (pages publiques, documents), l'outil
  quotidien gagne en contraste. À valider sur écran réel.
- **D6** — Barre d'actions basse sur téléphone, centrée sur RUN. Faut-il y mettre aussi les
  encaissements quand ils arriveront ?
- **D7** — Mise en route : faut-il l'imposer à la première connexion (redirection) plutôt que
  la proposer (carte dans la barre latérale) ? Proposition : proposer, jamais imposer.

## Plan de validation

Revue de la dirigeante sur la branche `feat/refonte-ui` (captures avant/après dans
`docs/refonte-ui/`), puis essai en préproduction sur téléphone réel (Android d'entrée de
gamme, 360 px) avant toute publication. Contrôles du dépôt verts (format, types, lint,
build web, tests web).

## Liens

- [ADR-0016](ADR-0016-navigation-applicative.md) — navigation applicative (amendé) ;
  [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) — BUILD/RUN/GROW ;
  [ADR-0028](ADR-0028-modeles-de-facture-et-identite.md) — identité visuelle ;
  [ADR-0021](ADR-0021-modules-erp-et-identite-fiscale.md) — fiscalité, points de vente.
- docs/04-UX-UI.md, docs/12-ROLES-PERMISSIONS.md, docs/13-PRICING.md.
