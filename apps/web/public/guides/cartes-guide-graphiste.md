# Guide — gabarit de carte pour graphiste (Illustrator, Photoshop)

Version du format : **1** · référence : ADR-0069 § 6 (2).

Vous dessinez le **fond** de la carte (recto, et verso si besoin) dans votre logiciel ; Lalanda
superpose les données de chaque collaborateur dans des **zones nommées** que vous mesurez en
millimètres. Le QR de vérification d'une carte de service est toujours posé par Lalanda, dans
la zone `qr` que vous réservez.

Exemple complet et valide : `docs/cartes/exemple-graphiste/`.

## 1. Préparer le document

| Carte | Format du document (avec fond perdu) | Coupe | Zone de sécurité | Export PNG à 300 dpi |
|---|---|---|---|---|
| Carte de service horizontale (CR80) | 85,60 × 53,98 mm (pas de fond perdu) | 85,60 × 53,98 mm | 3 mm | **1011 × 638 px** |
| Carte de service verticale | 53,98 × 85,60 mm | idem | 3 mm | **638 × 1011 px** |
| Carte de visite horizontale | **91 × 61 mm** (3 mm de fond perdu par côté) | 85 × 55 mm | 4 mm | **1075 × 720 px** |
| Carte de visite verticale | **61 × 91 mm** | 55 × 85 mm | 4 mm | **720 × 1075 px** |

- **Illustrator** : plan de travail à la taille de coupe, fond perdu de 3 mm (carte de visite) ;
  *Fichier › Exporter › Exporter pour les écrans* ou *Exporter sous… PNG*, 300 ppp, « Utiliser le
  fond perdu du document » coché.
- **Photoshop** : nouveau document aux dimensions **avec fond perdu** du tableau, 300 ppp, mode
  RVB ; *Exporter › Exporter sous… PNG*.
- Une résolution supérieure (600 dpi) est acceptée si les **proportions** sont exactes (1 % de
  tolérance) et que le fichier reste sous 2 Mio et 4 096 px de côté. Préférez le JPEG qualité 90
  pour un fond photographique.

**Profil couleur** : exportez en **sRGB**. Le PDF de Lalanda est en RVB ; l'imprimeur convertit en
CMJN (prévoir une épreuve). **Ne mettez aucun texte variable dans le fond** : nom, poste,
téléphone… viennent des zones. Le fond ne contient que le décor, le logo s'il est fixe, les
mentions fixes.

## 2. Mesurer les zones

Chaque zone est un rectangle : `x`, `y` (coin haut gauche), `width`, `height`, en **mm mesurés
depuis le coin haut gauche de la COUPE** (pas du fond perdu). Dans Illustrator : origine des
règles sur le coin de coupe, palette *Transformation*, point de référence en haut à gauche.

Zones disponibles :

| Nom | Contenu |
|---|---|
| `prenom`, `nom`, `nom-complet` | prénom, nom, « Prénom Nom » |
| `poste`, `service`, `matricule` | poste, service, matricule (si l'organisation l'imprime) |
| `telephone`, `email` | coordonnées professionnelles |
| `site`, `adresse`, `organisation`, `slogan` | réglages de l'organisation |
| `photo` | photo consentie (sinon rien) — `fit: "cover"` par défaut, `radius` en mm |
| `logo`, `logo-clair` | logo de l'identité visuelle (`contain`) |
| `qr` | **carte de service : obligatoire**, carré ≥ **15 mm** (16 à 20 mm conseillés), dans la zone de sécurité, avec 2,4 mm libres dessous pour la mention « Vérifier : lalanda.co/v » |
| `qr-vcard` | carte de visite : QR de contact facultatif (≥ 12 mm conseillé) |

Options d'une zone de texte : `font` (`inter`, `ibm-plex-sans`, `manrope`, `source-serif-4`,
`fraunces`, `jetbrains-mono`, ou une police WOFF2 déclarée dans `fonts`), `size` en **points**
(6 à 48), `weight` (100 à 900), `color` opaque `#rrggbb`, `align` (`left`, `center`, `right`),
`uppercase`. Un texte trop long passe à la ligne dans sa zone puis est coupé : prévoyez des zones
assez hautes pour les noms longs (deux lignes).

Gardez les textes dans la zone de sécurité (sinon avertissement) ; une image peut aller jusqu'au
bord du fond perdu.

## 3. Le manifeste

```json
{
  "format": "lalanda.modele-carte-graphiste",
  "formatVersion": 1,
  "id": "studio-kin.visite-fleuve",
  "name": "Fleuve",
  "description": "Carte de visite du studio, fond aquarelle.",
  "version": "1.0.0",
  "kind": "business",
  "orientation": "horizontal",
  "faces": ["recto", "verso"],
  "backgrounds": { "recto": "images/fond-recto.png", "verso": "images/fond-verso.png" },
  "author": { "name": "Studio Kin", "email": null, "url": null },
  "license": "proprietary",
  "fonts": [],
  "zones": [
    { "name": "nom-complet", "face": "recto", "x": 6, "y": 8, "width": 50, "height": 7, "font": "manrope", "size": 13, "weight": 700, "color": "#111827" },
    { "name": "poste", "face": "recto", "x": 6, "y": 15.5, "width": 50, "height": 5, "size": 8, "color": "#0f766e" },
    { "name": "qr-vcard", "face": "verso", "x": 66, "y": 36, "width": 14, "height": 14 }
  ]
}
```

`kind` : `badge` (carte de service) ou `business` (carte de visite) ; `orientation` :
`horizontal` ou `vertical`. Tout champ inconnu est refusé.

## 4. L'archive

```
mon-modele/
├── manifest.json
├── images/fond-recto.png
├── images/fond-verso.png
└── polices/ma-police-700.woff2   (facultatif, licence d'intégration requise)
```

Noms de fichiers en minuscules, chiffres, `.`, `_`, `-`. Archive ≤ 3 Mio ; image ≤ 2 Mio,
32 à 4 096 px. Formats acceptés : **PNG, JPEG** pour les fonds (WebP accepté), **WOFF2** pour les
polices. **Non acceptés dans cette version** : SVG à calques `zone-*`, PDF vectoriel, AI, PSD,
EPS (exportez en PNG 300 dpi).

## 5. Installer

Compressez le dossier en `.zip`, puis **Ressources humaines › Cartes › Modèles sur mesure ›
Installer un modèle**. Le rapport dit, zone par zone, ce qui ne va pas (proportions du fond,
résolution insuffisante, zone hors de la carte, QR trop petit, police inconnue). Une version
installée ne change plus : publiez `1.0.1` pour corriger.
