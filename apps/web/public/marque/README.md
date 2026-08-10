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
| `app-icone-lalanda.png` | 1024×1024 | Icône d'app : aigle sur badge sombre bord à bord | Source de `src/app/apple-icon.png` (écran d'accueil iOS) |
| `aigle-seul.png` | 1024×1024 | Aigle seul, sans badge, fond transparent | Source de `src/app/icon.png` (favicon) |

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

## Deux icônes, deux fichiers différents — et pourquoi

Le doute portait sur `aigle-seul.png` : un aigle teal sur fond transparent
risquait de se fondre dans une barre d'onglets sombre. **Vérification faite au
rendu réel** (rastérisation à 16 et 32 px sur les gris de barre d'onglets
`#dee1e6`, `#35363a`, `#202124`), c'est l'inverse :

- **Aigle seul** : lisible partout. Sa masse teal est plus claire qu'une barre
  sombre et plus foncée qu'une barre claire, et le bec crème donne un point
  d'accroche dans les deux cas. Il occupe tout le cadre, donc il survit à 16 px.
- **Badge** : à 16 px il se réduit à un carré noir. Le badge ajoute une marge
  qui rétrécit l'aigle d'environ 40 %, et le contraste aigle/badge (teal sur
  presque noir) est plus faible que le contraste aigle/barre d'onglets. Sur une
  barre sombre, le carré se confond en plus avec la barre.

D'où la répartition :

| Fichier livré | Source | Raison |
|---|---|---|
| `src/app/icon.png` (512×512) | `aigle-seul.png` | Favicon : cadre plein, lisible à 16 px sur barre claire comme sombre |
| `src/app/apple-icon.png` (180×180) | `app-icone-lalanda.png` | iOS pose l'icône d'accueil **opaque** : un PNG transparent y est composé sur du noir. Le badge est fait pour ça, et à 180 px la lisibilité n'est pas en jeu |

Si l'un des deux est un jour régénéré, refaire la comparaison plutôt que
supposer : les deux hypothèses intuitives étaient fausses.

## Où c'est branché

- Bascule clair/sombre du lockup : `src/components/brand-logo.tsx`, avec les
  deux règles `.marque-fond-clair` / `.marque-fond-sombre` de `app/globals.css`.
- Icônes : `src/app/icon.png` et `src/app/apple-icon.png` (convention de
  fichiers Next 15 — ce sont des copies redimensionnées, pas des liens).
