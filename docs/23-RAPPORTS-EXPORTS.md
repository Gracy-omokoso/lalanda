# Rapports et exports

**Statut :** Draft  
**Version :** 0.1

## Catalogue initial

- Business Model Canvas;
- résumé exécutif;
- plan financier complet;
- besoins de financement;
- diagnostics;
- prévisionnel/réalisé;
- état mensuel de l’activité;
- rapport de scénario;
- dossier bancaire.

## Métadonnées obligatoires

Organisation, projet, scénario, plan, version, pays, Country Pack, devise, horizon, date de génération, auteur et avertissements.

## Identité visuelle des documents

### Ce qui est en place

Le PDF porte le logo à deux endroits, et à deux seulement :

- **en-tête de la page de garde** — le lockup couleur (badge sombre + mot-symbole)
  sur 62 mm de large, à la place du mot « LALANDA » autrefois composé en texte. Il
  est affiché quel que soit le plan de l'organisation : l'en-tête identifie
  l'éditeur du document, ce n'est pas un marqueur d'offre. Il reste
  volontairement en retrait du nom du projet, qui est ce qu'un banquier doit lire
  en premier;
- **filigrane** — la déclinaison gris 25 %, sur 22 mm, **en plus** du texte
  `Généré avec Lalanda — offre gratuite` et jamais à sa place : c'est le texte qui
  porte l'information commerciale, un logo seul ne dirait pas pourquoi le document
  est marqué. Les deux sont composés sur une même ligne au bas de chaque page.

Le filigrane reste piloté par l'entitlement `pdfWatermark` (`free: true`,
`pro`/`business: false`). Absent ou `false` : ni logo ni texte. Comportement
inchangé.

### La contrainte qui décide de la forme technique

Le rendu PDF coupe JavaScript et **avorte toute requête réseau sortante**
(`apps/api/src/reports/reports.service.ts`, barrière anti-SSRF délibérée). Un
`<img src="http://…">` y donne un cadre vide et un `src="file://…"` ne donne rien
du tout — vérifié en rendant les trois cas côte à côte sous ce confinement.

La seule voie est donc le **data URI base64**, qui n'est pas une requête réseau et
que la CSP du document autorise déjà (`img-src data:`). Les images sont compilées
en constantes TypeScript (`apps/api/src/reports/assets/brand.ts`, régénérable par
`node apps/api/src/reports/assets/generate-brand.mjs`) et non lues sur le disque :
`apps/api` est compilé par `tsc` seul, qui ne copie aucun actif non-TS vers
`dist/` — une lecture de fichier marcherait en développement et échouerait en
production.

Un test verrouille l'invariant : toute valeur de `src`/`href` du document doit
commencer par `data:`. Aucune assertion textuelle ne peut voir une image avortée;
celle-ci voit la cause avant l'effet.

### Poids

Mesuré sur le gabarit de démonstration, avec le confinement de production :

| | HTML | PDF |
|---|---|---|
| Avant, sans filigrane | 9,0 Kio | 119,6 Kio |
| Après, sans filigrane | 30,1 Kio | 139,1 Kio |
| Avant, avec filigrane | 9,1 Kio | 128,4 Kio |
| Après, avec filigrane | 38,4 Kio | 151,4 Kio |

Soit **+19,5 Kio par PDF** pour l'en-tête et **+9,6 Kio** de plus quand le
filigrane est actif. Le filigrane est encodé à sa taille d'affichage (260 px,
≈ 300 ppp). L'en-tête garde sa définition native (1024 px) : le seul
redimensionneur disponible ré-encode sans réoptimiser la compression et produit
un fichier plus lourd qu'à la source. Les mesures comparatives sont dans
l'en-tête de `generate-brand.mjs`.

### Où le logo n'est PAS posé

- **Classeur Excel** — décision motivée au bas de la section Excel de ce document.
- **Emails transactionnels** (`apps/api/src/mail/`) — inchangés, et volontairement.
  Un logo en email suppose une URL publiquement accessible : il n'y a ni domaine
  ni CDN à ce stade. Les data URI, qui sauvent le PDF, ne servent à rien ici — la
  plupart des clients de messagerie les suppriment. Une image distante serait de
  toute façon bloquée par défaut chez le destinataire, ne laissant qu'un cadre
  cassé à la place du seul élément de marque du message, et révélerait au passage
  son IP et son heure de lecture. Les gabarits gardent donc leur monogramme
  composé en CSS. Le raisonnement complet est en tête de `mail.templates.ts`.

## PDF

- page de garde;
- sommaire;
- hypothèses principales;
- tableaux avec répétition des en-têtes;
- graphiques accessibles;
- notes de méthode;
- pagination;
- absence de coupe illisible;
- polices incorporées si nécessaire.

## Excel

- feuille de lecture;
- données d’entrée;
- états;
- diagnostics;
- métadonnées et versions;
- cellules protégées selon usage;
- formats de nombre explicites;
- aucune formule cassée;
- validation LibreOffice.

L’export n’est pas la source de vérité : il matérialise un résultat déjà calculé.

### Implémentation (S14b)

Endpoint : `GET /projects/:id/report/xlsx` (auth requis, isolation par organisation).

Génération : `apps/api/src/reports/report-xlsx.ts`, via [ExcelJS](https://github.com/exceljs/exceljs).
Le classeur reprend un-pour-un les feuilles du moteur ; aucune règle métier n’est
réimplémentée côté export.

Structure du classeur :

- **Hypothèses** — un driver par ligne, label + valeur brute + unité.
- Une feuille par feuille moteur (`activite`, `plan_financement`, `tresorerie`,
  `projection`, `financement`, `ratios`) avec un label français lisible.
- **Métadonnées** — organisation, pays, projet, template, devise, cadre fiscal,
  avertissement du ParameterPack, date de génération.

Comportement des formules DSL → Excel :

- Les identifiants du DSL (drivers, lignes) sont substitués par leur référence
  de cellule qualifiée (`prix_unitaire` → `'Hypothèses'!B2`).
- Les fonctions Excel natives sont préservées avec la même signature :
  `MAX`, `MIN`, `IF`, `IFERROR`, `ABS`, `ROUND`, `SUM`, `AND`, `OR`, `NOT`
  (mathématiques + logique) ainsi que `PMT`, `PV`, `FV`, `NPV`, `IRR`
  (financières). Elles sont normalisées en majuscules par convention Excel.
- Fallback : si un identifiant ne peut pas être résolu (cas défensif, ne
  devrait pas arriver après compilation moteur), la valeur brute calculée est
  écrite à la place — jamais une formule cassée n’est produite.
- Chaque cellule à formule embarque également le résultat pré-calculé
  (`result`) pour que les visionneuses qui ne recalculent pas affichent
  quand même la bonne valeur.
- La feuille `ratios` colore chaque ligne en vert / orange / rouge selon le
  feu tricolore fourni par le moteur, sur la base des seuils du ParameterPack.

Sécurité : les labels et valeurs numériques sont assignés via
`cell.value = …`, jamais concaténés dans une chaîne de formule, ce qui empêche
toute injection de formule depuis une entrée utilisateur.

#### Pas de logo dans le classeur

Décision explicite, pas un oubli. Les deux emplacements possibles s'excluent :

- la feuille **Hypothèses** est la seule qui serait vue — c'est le premier onglet
  ouvert — et c'est celle dont chaque cellule de la colonne B ancre les formules
  de tout le reste du classeur. Une image ExcelJS flotte au-dessus de la grille :
  ancrée en haut, elle masque l'en-tête et les premiers drivers. Lui faire de la
  place impose de décaler des indices de ligne calculés à deux endroits distincts
  du code; un décalage appliqué à l'un et pas à l'autre ne casse pas la
  génération, il produit des formules qui pointent silencieusement sur la ligne
  voisine;
- la feuille **Métadonnées** est sans formule et référencée par aucune autre, donc
  sans risque — mais c'est le dernier onglet, celui que personne n'ouvre pour y
  chercher une marque.

S'ajoute la validation LibreOffice exigée plus haut pour les exports Excel :
embarquer une partie « drawing » sans pouvoir l'exécuter reviendrait à livrer un
binaire non vérifié dans le document déposé en banque. À reconsidérer le jour où
LibreOffice entre dans la chaîne de contrôle.

La marque reste portée par les propriétés du fichier (`creator`, `company`,
`title`), déjà renseignées.

## Word

Prévu après stabilisation des rapports PDF/Excel. Le format vise les dossiers narratifs modifiables, sans devenir une seconde implémentation des calculs.

## Dossier bancaire

Structure configurable : présentation, promoteurs, Canvas, marché, hypothèses, financement demandé, états, ratios, risques, garanties et annexes. Les exigences d’une banque spécifique sont des templates versionnés.

## Sécurité

Exports générés en tâche isolée, analysés, stockés chiffrés, accessibles par URL courte signée, expirables et journalisés. Les modèles empêchent l’injection de formules depuis des entrées utilisateur.

## Reproductibilité

Deux exports du même format, moteur, données et template doivent produire les mêmes valeurs. Les différences non déterministes comme l’horodatage sont isolées.
