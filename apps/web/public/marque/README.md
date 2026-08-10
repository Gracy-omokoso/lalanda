# Actifs de marque — Lalanda

Copies des fichiers fournis par le décideur (`logo-lalanda/`). **Source unique :
des PNG.** Il n'existe pas de SVG; ne pas en fabriquer un à partir de ces images
et le faire passer pour l'original.

Ces fichiers sont servis tels quels par `public/`, donc en `'self'` au sens de la
CSP (`apps/web/next.config.mjs`) : aucune origine à ajouter.

## Contenu

| Fichier | Dimensions | Contenu | Où il sert |
|---|---|---|---|
| `logo-lalanda-fond-clair.png` | 1024×273 | Lockup : badge sombre + aigle couleur, mot-symbole encre | Interface **sur fond clair** |
| `logo-lalanda-fond-sombre.png` | 1024×273 | Lockup : badge blanc cerclé cyan, mot-symbole crème | Interface **sur fond sombre**, et panneaux `.bg-ink` |
| `logo-lalanda-blanc.png` | 1024×273 | Lockup monochrome blanc | Déclinaison disponible (photo, aplat de couleur). **Non branchée dans l'application.** |
| `logo-lalanda-noir.png` | 1024×273 | Lockup monochrome noir | Déclinaison disponible (impression mono). **Non branchée dans l'application.** |
| `app-icone-lalanda.png` | 1024×1024 | Icône d'app : aigle sur badge sombre bord à bord | Source de `src/app/icon.png` et `src/app/apple-icon.png` |
| `aigle-seul.png` | 1024×1024 | Aigle seul, sans badge, fond transparent | Référence. **Non branché** — voir « Pourquoi pas l'aigle seul » plus bas |

## Correspondance avec les noms d'origine

Les fichiers ont été renommés à la copie : `for-ligth` portait une coquille, et
`for-light` / `for-white` côte à côte dans du code se confondent à la lecture.

| Nom d'origine | Nom ici |
|---|---|
| `logo-lalanda-for-ligth.png` | `logo-lalanda-fond-clair.png` |
| `logo-lalanda-for-dark.png` | `logo-lalanda-fond-sombre.png` |
| `logo-lalanda-for-white.png` | `logo-lalanda-blanc.png` |
| `logo-lalanda-for-black.png` | `logo-lalanda-noir.png` |
| `app-icone-lalanda.png` | inchangé |
| `favicon.png` | `aigle-seul.png` |

`for-ligth` / `for-dark` désignent le **fond de destination**; `for-white` /
`for-black` désignent la **couleur du logo** lui-même. Les noms retenus ici
lèvent l'ambiguïté : `fond-*` pour la destination, une couleur nue pour les
monochromes.

`logo-lalanda-for-filgran25.png` (gris 25 %, filigrane des PDF) n'est
volontairement pas copié ici : il relève des exports, pas de l'interface web.

## Pourquoi pas l'aigle seul en favicon

`aigle-seul.png` (le fichier livré sous le nom `favicon.png`) est un aigle en
teal sombre sur fond transparent. Dans une barre d'onglets en thème sombre, le
fond transparent prend la couleur de la barre et la masse teal du logo s'y fond :
il ne reste qu'un éclat cyan et le bec crème, sans silhouette lisible.

`app-icone-lalanda.png` porte son propre badge sombre : l'aigle garde partout le
fond pour lequel il a été dessiné, et l'icône reste identifiable sur une barre
d'onglets claire comme sombre. C'est donc lui qui alimente `src/app/icon.png` et
`src/app/apple-icon.png`.

## Où c'est branché

- Bascule clair/sombre du lockup : `src/components/brand-logo.tsx`, avec les
  deux règles `.marque-fond-clair` / `.marque-fond-sombre` de `app/globals.css`.
- Icônes : `src/app/icon.png` et `src/app/apple-icon.png` (convention de
  fichiers Next 15 — ce sont des copies redimensionnées, pas des liens).
