# ADR-0055 — Thèmes au choix et design « plus professionnel » : fondations

Statut : **Accepté**
Date : 2026-11-03
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> Prolonge [ADR-0030](ADR-0030-refonte-ui-ux.md) (design system) et
> [ADR-0038](ADR-0038-navigation-par-modules-et-initiatives.md) (navigation). Ne les remplace pas :
> les noms de jetons, les composants partagés et la navigation par modules restent.

## Contexte

La dirigeante aime le design actuel mais ne le trouve pas assez « professionnel ». Le 3 nov. 2026,
elle a écarté trois pistes de nouveau design system (Registre, Origami, Cuivre) et validé une
**évolution de l'existant** sur maquette : trois thèmes au choix, une police de texte plus sobre, une
densité d'outil de gestion, des animations courtes et des graphiques partout.

L'audit ADR-0030 reste valable ; ce qui manquait :

- une seule apparence imposée (pétrole), alors que certaines personnes veulent un outil clair et aéré,
  d'autres un outil sombre en permanence ;
- Poppins, géométrique et ronde, donne un ton grand public dans des tableaux de factures ;
- des rayons et des hauteurs de contrôle disparates (6 / 10 / 14 px ; boutons de 40 px) ;
- aucune règle sur le mouvement : quelques transitions, sans durée commune, et aucune garantie pour
  qui demande moins d'animations ;
- aucun jeton de graphique, alors que la vague 4 en dessinera à tous les niveaux.

## Décision

### 1. Trois thèmes, choisis par personne

| Thème | Pour qui | Barre de navigation | Clair / sombre |
|---|---|---|---|
| **Lalanda** (défaut) | « le thème d'origine, barre latérale pétrole » | pétrole `#00323D` | oui |
| **Lagune** | « clair et aéré, barre latérale blanche » | blanche, entrée active `#E3F0F2` / `#00566A` | oui |
| **Ébène** | « sombre en permanence » | `#050F12` | **non : toujours sombre** |

- Le choix est **personnel** et enregistré sur le compte (`uiTheme` de `/account/preferences`,
  `lalanda` par défaut, validé par zod). Il suit la personne d'un appareil à l'autre, comme le mode
  clair/sombre (S20b). Il ne dépend pas de l'organisation.
- **Ébène ignore le mode** sans l'effacer : le réglage clair/sombre est désactivé dans Mon compte ›
  Préférences avec sa raison écrite, et le bouton de l'en-tête aussi. Revenir à Lalanda ou Lagune
  retrouve le mode choisi.
- **Lalanda clair reste l'apparence d'aujourd'hui**, à peine retouchée : fond `#F5F4F0`, surface
  atténuée `#F7F5F0`, bordures fines `#E2DED5` ; les champs gardent une bordure forte ≥ 3:1.
- **Mécanisme** : deux attributs sur `<html>`, posés avant le premier paint par le script de
  `app/layout.tsx` (`lib/theme-boot.ts`) : `data-ui-theme="lalanda|lagune|ebene"` et
  `data-theme="light|dark"`, ce dernier étant le mode **affiché** (`dark` sous Ébène, si bien que le
  logo et tout ce qui lit `[data-theme='dark']` restent justes).
- **Cinq combinaisons**, chacune déclarant **tous** les jetons (couleurs, modules, natures, étiquettes,
  navigation, graphiques) dans `packages/ui/src/styles/tokens.css`. Les noms existants sont gardés :
  les écrans changent d'aspect sans être réécrits. Le miroir typé `tokens.ts` et `tokens.test.ts`
  vérifient l'égalité CSS/TS et les contrastes de chaque paire employée, pour chaque combinaison.
  **Règle : on ajuste une couleur, jamais un seuil.**

### 2. Typographie

- **IBM Plex Sans** (400, 500, 600) remplace Poppins pour le texte ; **Archivo** reste pour les
  titres, **IBM Plex Mono** pour les chiffres. Auto-hébergée en woff2 (sous-ensemble latin,
  licence OFL 1.1).
- Échelle de l'outil : texte courant **14 px**, tableaux **13 px**, titres **24 / 18 / 15 px**
  (`--font-size-ui`, `--font-size-table`, `--font-size-h1..h3`).

### 3. Densité

- Rayons unifiés : `--radius-sm 4px`, `--radius-md 6px`, `--radius-lg 8px`.
- Contrôles : `--control-h 36px`, `--control-h-sm 32px` ; lignes de tableau `--row-h 40px`.
- Cible tactile : les actions principales sur téléphone gardent 48 px (`Button size="lg"`).

### 4. Mouvement

- Jetons : `--motion-fast 120ms`, `--motion-base 180ms`, `--motion-slow 240ms`,
  `--ease-standard cubic-bezier(0.2, 0, 0, 1)`. CSS uniquement, **aucune bibliothèque d'animation**.
- **Ce qui s'anime** : changement de couleur de fond ou de bordure au survol et au focus (120 ms),
  ouverture d'un tiroir, d'un menu ou d'une fenêtre (180 ms), repli d'un panneau (240 ms au plus).
  Le mouvement dit d'où vient un élément ; il ne décore pas.
- **Ce qui ne s'anime jamais** : les chiffres qui comptent jusqu'à leur valeur, les apparitions au
  défilement, les rebonds et dépassements, les transitions de page lourdes, toute animation en boucle
  hors indicateur de chargement.
- **Réduction des animations respectée** : sous `prefers-reduced-motion: reduce`, une règle globale
  ramène toutes les transitions et animations à zéro (`apps/web/src/app/globals.css`).

### 5. Graphiques

- Jetons `--chart-1` à `--chart-6` et `--chart-grid` par combinaison ; chaque série tient **3:1**
  contre la surface (élément graphique, WCAG 1.4.11). Une légende écrit toujours le nom de la série :
  la couleur n'est jamais seule.
- Graphiques (courbes, barres, camemberts) en **SVG maison, sans bibliothèque** : vague 4.

### 6. Plan en cinq vagues

| Vague | Contenu | Branche |
|---|---|---|
| **1. Fondations** (cet ADR) | jetons des trois thèmes, choix par personne, Plex Sans, densité, mouvement | `feat/design-v1-fondations` |
| 2. Coquille | barre de navigation, en-tête, menu ; **liens légaux déplacés vers le menu Aide** | à venir |
| 3. Composants | tableaux, champs, filtres, cartes, états vides au nouveau gabarit | à venir |
| 4. Graphiques | composants SVG maison sur les jetons `--chart-*` | à venir |
| 5. Écrans | migration écran par écran, RUN d'abord | à venir |

Chaque vague : branche partant de `integ/design`, captures avant/après dans `docs/refonte-ui/v2/`,
publication lancée par la dirigeante.

## Conséquences

- Couleurs de la maquette ajustées pour tenir les seuils (avant → après) :
  - Ébène `--border-strong` `#3E5E67` → `#55757E` (2,39 → 3,37:1 sur la surface) ;
  - Ébène `--chart-6` `#3E5E67` → `#55757E` ;
  - Lalanda clair `--chart-3` `#00ACCA` → `#0097B2` (2,71 → 3,46:1) et `--chart-6` `#CFC9BC` →
    `#948C7B` (1,65 → 3,34:1) ;
  - Lagune clair `--chart-3` `#4FB3C8` → `#2F98AE` (2,44 → 3,37:1) et `--chart-6` `#C3CDCF` →
    `#7F8E92` (1,62 → 3,39:1).
- Nouveau jeton `--nav-active-fg` : l'entrée active n'est plus écrite en blanc fixe (illisible sur la
  barre blanche de Lagune). Le logo de la barre suit la couleur de la barre (`BrandLogo fond="nav"`).
- `PUT /account/preferences` accepte `uiTheme` **facultatif** : absent, la valeur enregistrée est
  conservée (le bouton clair/sombre et les clients antérieurs ne remettent pas le thème à Lalanda).
- Les pages publiques et d'authentification suivent aussi le thème choisi (crème de charte conservé
  en clair par `.surface-marque`).

## Points ouverts

1. Lagune sombre a été dérivé par l'équipe (gris plus froids que Lalanda sombre, accent `#4FC3D9`) :
   à valider par la dirigeante sur captures.
2. `--row-h` est défini mais aucun composant partagé de tableau n'existe encore : appliqué en vague 3.
