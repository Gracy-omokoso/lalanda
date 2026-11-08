# Guide — modèle de carte « paquet code » (développeur ou IA)

Version du format : **1** · contrat de données : **1** · référence : ADR-0069 § 6 (1).

Un paquet code est une archive `.zip` qui décrit **une** carte (carte de service ou carte de
visite, horizontale ou verticale) en HTML et CSS à variables. Lalanda remplit les variables pour
chaque collaborateur, impose le QR de vérification et rend la carte en PDF vectoriel et en PNG
300 dpi. Le paquet est du **contenu non fiable** : il est validé à l'installation, confiné au
rendu, et ne peut ni exécuter de script ni charger quoi que ce soit hors de l'archive.

Exemple complet et valide : `docs/cartes/exemple-badge-code/` (compresser le dossier, installer).

## 1. Dimensions

| Carte | Coupe (mm) | Fond perdu | Zone de sécurité | Pixels à 300 dpi |
|---|---|---|---|---|
| Carte de service (CR80, ISO/IEC 7810 ID-1), horizontale | 85,60 × 53,98 | aucun | 3 mm | 1011 × 638 |
| Carte de service, verticale | 53,98 × 85,60 | aucun | 3 mm | 638 × 1011 |
| Carte de visite, horizontale | 85 × 55 | 3 mm par côté → 91 × 61 | 4 mm | 1004 × 650 (1075 × 720 avec fond perdu) |
| Carte de visite, verticale | 55 × 85 | 3 mm par côté → 61 × 91 | 4 mm | 650 × 1004 (720 × 1075 avec fond perdu) |

Le conteneur de votre gabarit a **exactement** la taille de la boîte avec fond perdu. Pour une
carte de visite, les 3 premiers et les 3 derniers millimètres seront coupés : prolongez-y vos
aplats, n'y mettez aucun texte. Gardez tout texte à l'intérieur de la **zone de sécurité**
(mesurée depuis le bord de coupe). Travaillez en `mm`.

## 2. Contenu de l'archive

| Fichier | Rôle | Plafond |
|---|---|---|
| `manifest.json` | identité, type, faces, place du QR | 16 Kio |
| `gabarit.html` | gabarit Mustache, rendu **une fois par face** | 128 Kio |
| `style.css` | feuille du modèle (confinée, liste blanche) | 64 Kio |
| `images/*.png\|jpg\|jpeg\|webp` | images fixes — **pas de SVG** | 8 fichiers, 2 Mio, 32 à 4 096 px chacun |
| `polices/*.woff2` | polices propres (WOFF2 seulement) | 6 fichiers, 256 Kio chacun |
| `LICENCE.txt`, `LISEZMOI.md`, `polices/*.txt` | licences, notes | 64 Kio |

Archive ≤ 3 Mio, ≤ 40 fichiers, noms en minuscules `[a-z0-9._-]`. Un seul dossier racine est
toléré (« Compresser » sur macOS ou Windows).

## 3. Le manifeste

```json
{
  "format": "lalanda.modele-carte",
  "formatVersion": 1,
  "contract": 1,
  "id": "atelier-kin.badge-ruban",
  "name": "Ruban",
  "description": "Ruban de marque, photo, identité.",
  "version": "1.0.0",
  "kind": "badge",
  "orientation": "horizontal",
  "faces": ["recto", "verso"],
  "qr": { "face": "recto", "x": 66, "y": 31.5, "size": 16 },
  "author": { "name": "Atelier Kin", "email": null, "url": null },
  "license": "proprietary",
  "fonts": [
    { "family": "Ruban Titre", "file": "polices/ruban-titre-700.woff2", "weight": 700, "style": "normal" }
  ]
}
```

- `kind` : `badge` (carte de service) ou `business` (carte de visite).
- `faces` : `["recto"]` ou `["recto", "verso"]`.
- `qr` (carte de service, **obligatoire**) : face, coin haut gauche (`x`, `y`) et côté (`size`) en
  mm **depuis le coin de coupe**. Côté **≥ 15 mm** (16 à 20 mm conseillés). Le carré et la mention
  « Vérifier : lalanda.co/v » (2,4 mm dessous) doivent tenir dans la zone de sécurité. Pour une
  carte de visite : `"qr": null`.
- `id` : `editeur.nom` ; `version` : `MAJEUR.MINEUR.CORRECTIF`. Une version installée ne change
  plus : publiez `1.0.1` pour corriger.
- Tout champ inconnu est refusé.

## 4. Le gabarit (`gabarit.html`)

Syntaxe **Mustache stricte** (celle des modèles de facture) : `{{variable}}` (toujours échappée),
sections `{{#x}}…{{/x}}`, sections inverses `{{^x}}…{{/x}}`, commentaires `{{! … }}`. Refusés :
`{{{x}}}`, `{{&x}}`, partiels, changement de délimiteurs, lambdas.

Le gabarit est rendu une fois par face : encadrez chaque face.

```html
{{#face.recto}} … recto … {{/face.recto}}
{{#face.verso}} … verso … {{/face.verso}}
```

HTML admis : balises de structure et de texte (`div`, `span`, `p`, `h1`–`h6`, `ul`, `li`, `img`,
`section`, `header`, `footer`, `strong`, `em`, tableaux), attributs `class` (préfixe `lx-` réservé),
`alt`, `src` (img), `width`/`height`. Refusés : `script`, `style`, `link`, `iframe`, `svg`, `form`,
attributs `style` et `on*`, commentaires HTML, caractères invisibles.

Images : `src` vaut une image du paquet (`images/motif.png`) ou **exactement** `{{person.photo}}`,
`{{organization.logo}}`, `{{organization.logoLight}}` — à placer dans une section qui vérifie
leur présence (`{{#person.hasPhoto}}…{{/person.hasPhoto}}`, `{{#organization.logo}}…`).

Textes réservés au moteur (refusés dans le texte fixe) : « Vérifier : lalanda… », « Carte non
valide », « En fonction », ainsi que « TEST », « EXEMPLE », « DUPLICATA ».

### Variables (contrat 1)

| Variable | Type | Description |
|---|---|---|
| `face.recto` | booléen | Vrai pendant le rendu du recto. |
| `face.verso` | booléen | Vrai pendant le rendu du verso. |
| `person.firstName` | texte | Prénom (ou prénom d’usage). |
| `person.lastName` | texte | Nom. |
| `person.displayName` | texte | Prénom et nom. |
| `person.initials` | texte | Initiales (deux lettres), à défaut de photo. |
| `person.jobTitle` | texte | Poste. |
| `person.department` | texte ou vide | Service, ou vide. |
| `person.employeeNumber` | texte ou vide | Matricule, ou vide (masqué si l’organisation le décide). |
| `person.workEmail` | texte ou vide | E-mail professionnel, ou vide. |
| `person.workPhone` | texte ou vide | Téléphone professionnel, ou vide. |
| `person.hasPhoto` | booléen | Vrai si une photo consentie existe. |
| `person.photo` | texte ou vide | Photo : à placer tel quel dans `<img src="{{person.photo}}">`. |
| `organization.name` | texte | Nom de l’organisation. |
| `organization.initials` | texte | Initiales de l’organisation. |
| `organization.logo` | texte ou vide | Logo principal : `<img src="{{organization.logo}}">`. |
| `organization.logoLight` | texte ou vide | Logo pour fond sombre : `<img src="{{organization.logoLight}}">`. |
| `organization.address` | texte ou vide | Adresse imprimée, ou vide. |
| `organization.website` | texte ou vide | Site, ou vide. |
| `organization.phone` | texte ou vide | Téléphone de l’organisation, ou vide. |
| `organization.slogan` | texte ou vide | Slogan, ou vide. |
| `card.kindLabel` | texte | « Carte de service » ou « Carte de visite ». |
| `card.serial` | texte ou vide | Numéro d’émission (carte de service), ou vide. |

Aucune donnée sensible n'est fournie (ni salaire, ni pièce d'identité, ni adresse personnelle).

## 5. La feuille (`style.css`)

La feuille est **confinée** au conteneur du gabarit et filtrée par **liste blanche** (règles
d'ADR-0029 § O2) :

- admis : typographie, couleurs **opaques** pour le texte, fonds, bordures, `border-radius`,
  marges et retraits, tailles, `display` (flex, grid, block, inline…), `gap`, `object-fit` ;
- refusés : `position` et décalages, `z-index`, `transform`, `opacity`, `visibility`, `filter`,
  `clip-path`, `overflow`, `content`, `display: none`, at-règles (`@import`, `@font-face`,
  `@media`…), sélecteurs `html`, `body`, `:root`, classes `lx-*`, pseudo-éléments, `\` ;
- `font-size` en `px`, `pt` ou `mm`, au moins 6 px (≈ 1,6 mm) ; aucune longueur négative ;
- `url()` seulement vers les images du paquet ; `var()` seulement vers les variables du moteur :
  `--lalanda-accent`, `--lalanda-on-accent`, `--lalanda-soft`, `--lalanda-line`,
  `--lalanda-side`, `--lalanda-on-side` (couleurs de l'identité, contrastes vérifiés),
  `--lalanda-font-body`, `--lalanda-font-display`, `--lalanda-font-code`.

Sans positionnement, construisez la mise en page en flux (flex, grid, marges). Laissez **libre**
l'emplacement déclaré pour le QR : le moteur y pose le QR et sa mention au-dessus de votre
contenu, sur fond blanc.

## 6. Couleurs, polices, images

- **Couleurs** : sRGB. Le PDF produit est en RVB ; l'imprimeur convertit en CMJN. Évitez les
  aplats très saturés (vert ou bleu électriques) qui virent à la conversion.
- **Polices** : celles de Lalanda via les variables, ou les vôtres en WOFF2 déclarées dans
  `fonts` (licence d'intégration requise ; noms commençant par « Lalanda » réservés).
- **Images** : PNG, JPEG ou WebP, 300 dpi à la taille d'impression (une image de 20 mm de large
  doit faire au moins 236 px). Pas de SVG.

## 7. Vérifier puis installer

1. Compressez le dossier en `.zip`.
2. Lalanda → **Ressources humaines › Cartes › Modèles sur mesure › Installer un modèle**.
3. Un paquet invalide est refusé avec un rapport (code, fichier, ligne, colonne). Les rendus
   d'essai (collaborateur complet, sans photo ni logo, noms longs et caractères à échapper)
   doivent tous passer.
4. Le modèle apparaît alors dans la liste des modèles, avec un aperçu « EXEMPLE ».
