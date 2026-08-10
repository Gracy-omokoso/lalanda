# Actifs de marque — Lalanda

Copies des fichiers fournis par le décideur (`logo-lalanda/`). **Source unique :
des PNG.** Il n'existe pas de SVG; ne pas en fabriquer un à partir de ces images
et le faire passer pour l'original.

Ces fichiers sont servis tels quels par `public/`, donc en `'self'` au sens de la
CSP (`apps/web/next.config.mjs`) : aucune origine à ajouter.

## Contenu

| Fichier                        | Dimensions | Contenu                                                                              | Où il sert                                                                             |
| ------------------------------ | ---------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `logo-lalanda-fond-clair.png`  | 1024×273   | Lockup monochrome encre `#07171c` : badge plein, aigle en réserve, mot-symbole encre | Interface **sur fond clair**                                                           |
| `logo-lalanda-fond-sombre.png` | 1024×273   | Lockup monochrome crème `#eee7d7` : badge plein, aigle en réserve, mot-symbole crème | Interface **sur fond sombre**, et panneaux `.bg-ink`                                   |
| `logo-lalanda-blanc.png`       | 1024×273   | Lockup monochrome blanc                                                              | Déclinaison disponible (photo, aplat de couleur). **Non branchée dans l'application.** |
| `logo-lalanda-noir.png`        | 1024×273   | Lockup monochrome noir                                                               | Déclinaison disponible (impression mono). **Non branchée dans l'application.**         |
| `app-icone-lalanda.png`        | 1024×1024  | Icône d'app : aigle sur badge sombre bord à bord                                     | Source de `src/app/apple-icon.png` (écran d'accueil iOS)                               |
| `aigle-seul.png`               | 1024×1024  | Aigle seul, sans badge, fond transparent                                             | Source de `src/app/icon.png` (favicon)                                                 |

## Correspondance avec les noms d'origine

Les fichiers ont été renommés à la copie : `for-ligth` portait une coquille, et
`for-light` / `for-white` côte à côte dans du code se confondent à la lecture.

| Nom d'origine                 | Nom ici                        |
| ----------------------------- | ------------------------------ |
| `logo-lalanda-darkgreen.png`  | `logo-lalanda-fond-clair.png`  |
| `logo-lalanda-ligthbeige.png` | `logo-lalanda-fond-sombre.png` |
| `logo-lalanda-for-white.png`  | `logo-lalanda-blanc.png`       |
| `logo-lalanda-for-black.png`  | `logo-lalanda-noir.png`        |
| `app-icone-lalanda.png`       | inchangé                       |
| `favicon.png`                 | `aigle-seul.png`               |

**Les sources du lockup ont changé le 2026-08-10.** Le décideur a livré
`logo-lalanda-darkgreen.png` (fond clair) et `logo-lalanda-ligthbeige.png`
(fond sombre), qui remplacent `logo-lalanda-for-ligth.png` et
`logo-lalanda-v2.png`. Les anciens fichiers existent toujours dans le dossier
source : ne pas les ré-importer. La coquille `ligthbeige` est celle du fichier
livré, pas une faute de recopie.

## L'aigle est une réserve, pas une encre

Vérifié sur les pixels des deux fichiers, pas supposé d'après l'aperçu : chaque
lockup est **monochrome et à un seul aplat** — `#07171c` pour le fond clair,
`#eee7d7` pour le fond sombre — et l'aigle est **découpé dans le badge**, donc
totalement transparent. Ce qui paraît « un aigle blanc » dans une visionneuse
est le fond blanc de la visionneuse vu au travers.

Conséquence pratique : **l'aigle prend la couleur de ce qu'il y a derrière.**

| Fond de rendu               | Fichier affiché | Badge | Aigle (= le fond) |
| --------------------------- | --------------- | ----- | ----------------- |
| Thème clair `#eee7d7`       | `fond-clair`    | encre | crème             |
| Thème sombre `#07171c`      | `fond-sombre`   | crème | encre             |
| Panneau `.bg-ink` `#005263` | `fond-sombre`   | crème | pétrole           |

Les trois combinaisons gardent un contraste franc entre le badge et l'aigle. À
ne pas poser en revanche sur une photo ou un dégradé : l'aigle y ramasserait
n'importe quoi. Les déclinaisons `blanc` / `noir` sont là pour ces cas.

Les deux fichiers ne partagent donc plus leur badge — c'est le changement par
rapport à la version précédente, où le badge encre était opaque dans les deux
et où seule la couleur du mot-symbole variait.

Les noms d'origine mélangent deux conventions : `for-ligth` / `for-dark`
désignent le **fond de destination**, `for-white` / `for-black` la **couleur du
logo** lui-même, et `darkgreen` / `ligthbeige` la couleur elles aussi — alors
que ce sont les fichiers du fond CLAIR et du fond SOMBRE respectivement, donc
l'inverse de ce que le nom suggère. Les noms retenus ici lèvent l'ambiguïté :
`fond-*` pour la destination, une couleur nue pour les monochromes. **C'est la
raison de garder les noms de destination à la copie** : `brand-logo.tsx` et les
règles `.marque-fond-*` de `globals.css` pointent dessus, et une prochaine
livraison changera encore les noms de source sans qu'aucun code ne bouge.

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

| Fichier livré                      | Source                  | Raison                                                                                                                                                      |
| ---------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/icon.png` (512×512)       | `aigle-seul.png`        | Favicon : cadre plein, lisible à 16 px sur barre claire comme sombre                                                                                        |
| `src/app/apple-icon.png` (180×180) | `app-icone-lalanda.png` | iOS pose l'icône d'accueil **opaque** : un PNG transparent y est composé sur du noir. Le badge est fait pour ça, et à 180 px la lisibilité n'est pas en jeu |

Si l'un des deux est un jour régénéré, refaire la comparaison plutôt que
supposer : les deux hypothèses intuitives étaient fausses.

## Où c'est branché

- Bascule clair/sombre du lockup : `src/components/brand-logo.tsx`, avec les
  deux règles `.marque-fond-clair` / `.marque-fond-sombre` de `app/globals.css`.
- Icônes : `src/app/icon.png` et `src/app/apple-icon.png` (convention de
  fichiers Next 15 — ce sont des copies redimensionnées, pas des liens).
