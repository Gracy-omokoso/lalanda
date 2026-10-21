# Créer un modèle de facture sur mesure pour Lalanda

Ce guide s'adresse à **toute personne ou tout agent IA** (Claude, Codex…) chargé de produire
un modèle de facture pour une organisation qui utilise Lalanda. Il suffit à produire un
paquet **valide du premier coup** : suivez-le à la lettre, puis vérifiez le paquet avec la
commande locale avant de le remettre.

Décision d'architecture : [ADR-0029](../adr/ADR-0029-modeles-de-facture-sur-mesure.md).
Paquet complet d'exemple : [`exemple-ocre/`](exemple-ocre/).

## En une minute

- Un modèle est un **dossier** (remis en `.zip`) : `manifest.json`, `gabarit.html`,
  `style.css`, et au besoin `images/` et `polices/`.
- `gabarit.html` est du **HTML** avec des balises **Mustache** (`{{document.total}}`) ; il
  produit l'intérieur de la facture. **Aucun script**, aucune ressource en ligne.
- Le **moteur de Lalanda pose lui-même** la zone DGI : bandeau « environnement de test »,
  DUPLICATA, cadre « Éléments de sécurité DGI » avec le QR code, filigrane, en-tête et pied
  de page réglementaires. **Ne les écrivez pas** ; vous ne pouvez ni les cacher ni les imiter.
- Le gabarit doit **imprimer toutes les autres mentions** du document (liste au § 5), chacune
  **telle quelle** via sa variable. S'il en manque une, la facture n'est pas imprimée.
- Vérifiez : `pnpm --filter @lalanda/api modele:valider <dossier>` (depuis un clone du dépôt
  Lalanda) ; `--pdf apercu.pdf` pour voir le rendu réel.

## 1. Structure du paquet

```
mon-modele/
├── manifest.json        identité, version, options              (obligatoire, ≤ 16 Kio)
├── gabarit.html         gabarit Mustache                        (obligatoire, ≤ 128 Kio)
├── style.css            feuille de style                        (obligatoire, ≤ 64 Kio)
├── images/              PNG, JPEG ou WebP — pas de SVG          (≤ 8 fichiers, ≤ 2 Mio, 32 à 4 096 px)
├── polices/             WOFF2 + licence .txt                    (≤ 6 polices, ≤ 256 Kio chacune)
├── LICENCE.txt          facultatif
└── LISEZMOI.md          facultatif
```

- Noms de fichiers **en minuscules** : lettres `a-z`, chiffres, `.`, `-`, `_`. Pas d'autre
  dossier, pas de sous-dossier dans `images/` ou `polices/`, pas de lien symbolique.
- Archive : ≤ 3 Mio, ≤ 40 entrées, ≤ 8 Mio une fois décompressée. Un `.zip` fait avec
  « Compresser » (macOS) ou « Envoyer vers › Dossier compressé » (Windows) convient : le
  dossier racine, `__MACOSX/` et `.DS_Store` sont ignorés. La commande locale peut aussi
  écrire l'archive : `--paquet mon-modele.zip`.
- Tout est en **UTF-8**.

## 2. `manifest.json`

```json
{
  "format": "lalanda.modele-facture",
  "formatVersion": 1,
  "id": "atelier-kin.ocre",
  "name": "Ocre",
  "description": "Frise ocre en tête, titre à empattements, totaux encadrés.",
  "version": "1.0.0",
  "contract": 1,
  "author": { "name": "Atelier Kin", "email": null, "url": null },
  "publisher": null,
  "license": "proprietary",
  "price": null,
  "options": {
    "palettes": ["brand", "mono"],
    "accent": "#9a3412",
    "fonts": ["source-serif-4", "inter"],
    "font": "inter"
  },
  "fonts": [
    {
      "family": "Ocre Titre",
      "file": "polices/ocre-titre-600.woff2",
      "weight": 600,
      "style": "normal"
    }
  ],
  "signature": null
}
```

| Champ | Règle |
|---|---|
| `format`, `formatVersion` | exactement `"lalanda.modele-facture"` et `1` |
| `id` | `editeur.nom` : minuscules, chiffres, tirets, au moins un point (`atelier-kin.ocre`) |
| `name` | 1 à 60 caractères, sans `<` ni `>` |
| `description` | 1 à 280 caractères |
| `version` | SemVer strict `MAJEUR.MINEUR.CORRECTIF` (`1.0.0`, pas `v1.0`). **Une version installée ne change plus** : pour corriger, publiez `1.0.1` |
| `contract` | version du contrat de données : `1` |
| `author` | `{ "name", "email" (ou null), "url" https (ou null) }` |
| `publisher` | `null`, ou `{ "id", "name", "url" }` (place de marché, préparation) |
| `license` | identifiant SPDX (`MIT`, `CC-BY-4.0`…) ou `proprietary` |
| `price` | `null`, ou `{ "amount": "25.00", "currency": "USD" \| "CDF" }` (non exploité aujourd'hui) |
| `options.palettes` | parmi `brand` (couleurs de l'organisation) et `mono` (noir et blanc) |
| `options.accent` | couleur par défaut `#RRGGBB` (la couleur de l'organisation la remplace si elle en a une) |
| `options.fonts` | polices **intégrées** proposées à l'organisation : `inter`, `ibm-plex-sans`, `manrope`, `source-serif-4`, `fraunces+inter`, `source-serif-4+ibm-plex-sans`, `source-serif-4+manrope` |
| `options.font` | police par défaut, prise dans `options.fonts` |
| `fonts` | polices **du paquet** (WOFF2) : `family` (lettres, chiffres, espaces, tirets ; jamais « Lalanda… »), `file` (`polices/….woff2`), `weight` (100 à 900), `style` (`normal` ou `italic`) |
| `signature` | toujours `null` (réservé à la signature des éditeurs) |

Aucun autre champ n'est admis.

## 3. Ce que le moteur pose autour de votre gabarit

```
┌ en-tête de page (moteur) : bandeau de test · DUPLICATA ┐
│ zone haute (moteur) : bandeau de test, DUPLICATA n° k   │
│ ┌ <main class="lx-modele"> ── VOTRE GABARIT ─────────┐ │
│ │ vendeur, intitulé, client, lignes, totaux…          │ │
│ └─────────────────────────────────────────────────────┘ │
│ zone de sécurité (moteur) : Éléments de sécurité DGI,   │
│ QR code, Code DEF/DGI, DEF NIM, DEF Compteurs,          │
│ DEF Heure, ISF                                          │
└ pied de page (moteur) : version, numéro, pagination ───┘
  + filigrane TEST / EXEMPLE au-dessus de tout
```

Marges de page : 12 mm en haut, 16 mm en bas, **0 sur les côtés** — prévoyez votre propre
marge intérieure (ex. `.page { padding: 0 44px; }`). Votre CSS ne peut pas atteindre ces zones.

## 4. `gabarit.html` : syntaxe

### Balises Mustache admises

| Écriture | Effet |
|---|---|
| `{{document.total}}` | texte, **toujours échappé** |
| `{{#document.lines}} … {{/document.lines}}` | liste : le bloc est répété ; à l'intérieur, les champs de l'élément (`{{name}}`, `{{amount}}`) |
| `{{#document.counterValue}} … {{/document.counterValue}}` | texte facultatif : le bloc n'apparaît que si la valeur existe ; `{{.}}` la reprend |
| `{{#document.isProforma}} … {{/document.isProforma}}` | booléen : condition |
| `{{^document.payments}} … {{/document.payments}}` | inverse : liste vide, valeur absente ou faux |
| `{{.}}` | élément courant (liste de textes, texte facultatif) |
| `{{! commentaire }}` | commentaire (les commentaires HTML `<!-- -->` sont interdits) |

Interdits : `{{{ }}}` et `{{& }}` (HTML brut), `{{> }}` (partiels), `{{= =}}`, `{{< }}`,
`{{$ }}`, filtres ou helpers (`{{x | upper}}`). Au plus 8 sections imbriquées. Une variable
inconnue est une erreur : utilisez exactement les noms du § 6.

### HTML admis

- Balises : `div span p br hr strong b em i u small sup sub h1 h2 h3 h4 h5 h6 table thead
  tbody tfoot tr th td caption colgroup col ul ol li dl dt dd img section header footer
  article aside figure figcaption address blockquote`.
- Attributs : `class` partout (pas de classe commençant par `lx-`) ; `src`, `alt`, `width`,
  `height` sur `img` ; `colspan`, `rowspan` sur `td`/`th` ; `span` sur `col`/`colgroup`.
  Valeurs entre **guillemets doubles**.
- `src` d'une image : soit un fichier du paquet (`images/frise.png`), soit **exactement**
  `{{brand.logo}}` ou `{{brand.logos.primary}}` (`horizontal`, `symbol`, `light`).
- Chaque balise ouverte est **fermée explicitement, dans l'ordre** (`<p>…</p>`,
  `<td>…</td>`) ; les balises vides `br`, `hr`, `img`, `col` s'écrivent `<br />`.
- Une section Mustache contient des **éléments complets** : pas de balise Mustache dans un
  nom de balise ni entre deux attributs (`<td {{#x}}class="a"{{/x}}>` est refusé ; écrivez
  deux `<td>` dans deux sections).
- Entités : seulement `&amp; &lt; &gt; &quot; &apos; &nbsp;` ; écrivez les accents
  directement. Pas de caractère invisible (espace de largeur nulle…).
- Interdits : `script`, `style`, `link`, `meta`, `iframe`, `object`, `embed`, `svg`, `form`,
  `input`, attribut `style`, attributs `on…`.
- **Texte réservé** (le moteur seul l'écrit) : « Éléments de sécurité DGI », « Code DEF »,
  « DEF NIM », « DEF Compteurs », « DEF Heure », « ISF », « DUPLICATA », « TEST »,
  « EXEMPLE », « Environnement de test », « sans valeur fiscale » — en texte fixe comme dans
  `alt`, même découpés par des balises.

## 5. Mentions que le gabarit DOIT imprimer

Chaque mention s'imprime **par sa variable, d'un seul tenant** (pas de découpage, pas de
reformulation). Le moteur vérifie leur présence à chaque impression ; il en manque une : la
facture n'est pas imprimée.

| Mention | Comment l'écrire |
|---|---|
| Intitulé | `{{document.title}}` |
| Mentions de nature | `{{#document.natureMentions}}…{{.}}…{{/document.natureMentions}}` |
| Mentions d'état (pro forma) | `{{#document.stateMentions}}…{{.}}…{{/document.stateMentions}}` |
| Numéro | `{{document.reference.label}}` et `{{document.reference.value}}` |
| Date | `{{document.date.label}}` et `{{document.date.value}}` |
| Vendeur | `{{document.seller.title}}` et chaque `{{.}}` de `document.seller.lines` |
| Client | `{{document.customer.title}}` et chaque `{{.}}` de `document.customer.lines` |
| Références d'avoir | chaque `{{.}}` de `document.creditReference` |
| Devise qui fait foi | `{{document.amountsNote}}` |
| Mode de prix | `{{document.priceModeLabel}}` |
| Lignes | dans `document.lines` : `{{name}}`, `{{code}}`, `{{itemType}}`, `{{group}}`, `{{quantity}}`, `{{unitPrice}}`, `{{modification}}`, `{{specificTax}}`, `{{amount}}` (les trois facultatifs dans leur section) |
| Ventilation | dans `document.groups` : `{{group}}`, `{{rate}}`, `{{ht}}`, `{{vat}}`, `{{total}}` |
| Taxe spécifique | dans `{{#document.specificTaxTotal}}` : `{{labels.specificTax}}` et `{{document.specificTaxTotal}}` |
| Total TVA | `{{labels.vatTotal}}` et `{{document.vatTotal}}` |
| Total | `{{document.total}}` et `{{document.currency}}` |
| Montant en lettres | `{{document.totalInWords}}` |
| Paiements | dans `document.payments` : `{{label}}`, `{{amount}}` |
| Contre-valeur | `{{#document.counterValue}}{{.}}{{/document.counterValue}}` |
| Opérateur | dans `{{#document.operator}}` : `{{labels.operator}}` et `{{.}}` |
| Commentaires | chaque `{{.}}` de `document.comments` |

Ne fournissez ni ne calculez **aucun montant** : tout est déjà mis en forme par Lalanda.

## 6. Variables disponibles (contrat 1)

| Variable | Type | Contenu |
|---|---|---|
| `document` | objet | Contenu imprimé, déjà mis en forme |
| `document.title` | texte | « Facture normalisée », « Facture d’avoir », « PRO FORMA — non valable comme facture »… |
| `document.isInvoice` | booléen | facture ou avoir final (numéroté) |
| `document.isProforma` | booléen | pro forma |
| `document.natureMentions` | liste de textes | « EXPORTATION », « D’ACOMPTE », « FACTURE D’AVOIR — Annulation »… |
| `document.stateMentions` | liste de textes | « Normalisation DGI en cours »… |
| `document.reference` | objet | numéro |
| `document.reference.label` | texte | « Facture n° », « Avoir n° », « Référence pro forma » |
| `document.reference.value` | texte | le numéro |
| `document.date` | objet | date d'émission |
| `document.date.label` | texte | « Date et heure d’émission » ou « Établi le » |
| `document.date.value` | texte | « 20/10/2026 10:15:30 » |
| `document.seller` | objet | vendeur |
| `document.seller.title` | texte | raison sociale |
| `document.seller.lines` | liste de textes | NIF, RCCM, adresse, contacts |
| `document.customer` | objet | client |
| `document.customer.title` | texte | nom ou raison sociale |
| `document.customer.lines` | liste de textes | type DGI, NIF, coordonnées |
| `document.creditReference` | liste de textes | facture et code DEF/DGI d'origine d'un avoir |
| `document.currency` | texte | « CDF » ou « USD » |
| `document.amountsNote` | texte | « Montants en francs congolais (CDF) — font foi » |
| `document.priceModeLabel` | texte | « Prix unitaires HT » ou « TTC » |
| `document.lines` | liste d’objets | lignes |
| `document.lines[].name` | texte | désignation |
| `document.lines[].code` | texte ou absent | code article |
| `document.lines[].itemType` | texte | « [SER] », « [BIE] »… |
| `document.lines[].group` | texte | « [B] », « [C] hors champ »… |
| `document.lines[].quantity` | texte | « 2 heure » |
| `document.lines[].unitPrice` | texte | prix unitaire |
| `document.lines[].modification` | texte ou absent | « Prix d’origine 50,00 — remise 10 % » |
| `document.lines[].specificTax` | texte ou absent | « T.S. 1 250,00 » |
| `document.lines[].amount` | texte | montant |
| `document.groups` | liste d’objets | ventilation par groupe |
| `document.groups[].group` | texte | « [B] » |
| `document.groups[].rate` | texte | « 16 % » |
| `document.groups[].ht` | texte | base hors taxe |
| `document.groups[].vat` | texte | TVA |
| `document.groups[].total` | texte | total du groupe |
| `document.specificTaxTotal` | texte ou absent | taxe spécifique totale |
| `document.vatTotal` | texte | total TVA |
| `document.total` | texte | total TTC |
| `document.totalInWords` | texte | « Arrêtée la présente facture à la somme de : … » |
| `document.payments` | liste d’objets | paiements |
| `document.payments[].label` | texte | « Virement », « Espèces »… |
| `document.payments[].amount` | texte | montant |
| `document.counterValue` | texte ou absent | contre-valeur USD |
| `document.operator` | texte ou absent | personne qui a établi le document |
| `document.comments` | liste de textes | commentaires |
| `labels` | objet | libellés DGI fixes |
| `labels.vatTotal` | texte | « Total TVA » |
| `labels.specificTax` | texte | « Taxe spécifique » |
| `labels.operator` | texte | « Établi par » |
| `brand` | objet | identité visuelle de l'organisation |
| `brand.initials` | texte | initiales du vendeur (à défaut de logo) |
| `brand.logo` | texte ou absent | logo préféré, pour `src` |
| `brand.logos` | objet | les quatre déclinaisons |
| `brand.logos.primary` | texte ou absent | logo principal |
| `brand.logos.horizontal` | texte ou absent | version horizontale |
| `brand.logos.symbol` | texte ou absent | symbole seul |
| `brand.logos.light` | texte ou absent | version claire (fond sombre) |
| `theme` | objet | options de rendu |
| `theme.mono` | booléen | palette noir et blanc |

La commande `pnpm --filter @lalanda/api modele:valider --variables` affiche cette liste.

## 7. `style.css` : règles

**Portée.** Votre feuille ne s'applique qu'à l'intérieur de votre gabarit : le moteur préfixe
chaque sélecteur par `.lx-modele` et l'enveloppe dans `@scope`. `:scope` en tête de
sélecteur désigne le conteneur lui-même (`:scope { font-size: 10.5px; }`).

**Variables du moteur** (déjà calculées, couleurs contrastées) : `var(--lalanda-accent)`,
`var(--lalanda-on-accent)` (texte sur l'accent), `var(--lalanda-soft)` (fond doux),
`var(--lalanda-line)` (filets), `var(--lalanda-side)`, `var(--lalanda-on-side)`,
`var(--lalanda-font-body)`, `var(--lalanda-font-display)`, `var(--lalanda-font-code)`. En
noir et blanc, elles deviennent grises ; les logos sont passés en niveaux de gris.

**Polices** : `font-family` n'accepte que les variables `--lalanda-font-*`, les familles
déclarées dans `fonts` du manifeste (`'Ocre Titre'`) et `serif`, `sans-serif`, `monospace`.

**Propriétés admises** (toute autre est refusée) : `color` (opaque), `background`,
`background-color`, `background-image`, `background-size`, `background-position`,
`background-repeat`, `font-family`, `font-size`, `font-weight`, `font-style`,
`font-variant-numeric`, `line-height`, `letter-spacing`, `word-spacing`, `text-align`,
`text-transform`, `text-decoration` (et `-line`, `-color`, `-style`, `-thickness`),
`text-underline-offset`, `white-space`, `word-break`, `overflow-wrap`, `hyphens`,
`vertical-align`, `box-sizing`, `display`, `width`, `min-width`, `max-width`, `height`,
`min-height`, `max-height`, `margin` (et côtés), `padding` (et côtés), `border` (et côtés,
`-width`, `-style`, `-color`), `border-radius` (et coins), `border-collapse`,
`border-spacing`, `table-layout`, `caption-side`, `list-style` (et `-type`, `-position`),
`break-before`, `break-after`, `break-inside`, `page-break-before`, `page-break-after`,
`page-break-inside`, `orphans`, `widows`, `object-fit`, `float`, `clear`, `box-shadow`,
`flex` (et `-direction`, `-wrap`, `-flow`, `-grow`, `-shrink`, `-basis`), `justify-content`,
`justify-items`, `justify-self`, `align-items`, `align-content`, `align-self`,
`place-items`, `place-content`, `order`, `gap`, `row-gap`, `column-gap`,
`grid-template-columns`, `grid-template-rows`, `grid-auto-flow`, `grid-auto-rows`,
`grid-auto-columns`.

**Refusé, et pourquoi** : `position`, `top/left/…`, `z-index`, `transform`, `opacity`,
`visibility`, `filter`, `clip-path`, `overflow`, `content`, `grid-area/row/column` (tout ce
qui permettrait de cacher ou de recouvrir une mention) ; `display: none` ; couleur de texte
transparente ou avec canal alpha ; `font-size` sous 6 px ou ailleurs qu'en `px`/`pt`/`mm` ;
valeurs négatives (sauf `letter-spacing` jusqu'à `-1px`) ; longueurs au-delà de 1 000 px ;
`calc()` ailleurs que dans les largeurs, hauteurs et grilles ; `vw`/`vh` ; `@import`,
`@font-face`, `@media`, `@page` et toute at-règle ; règles imbriquées ; `\` ; propriétés
personnalisées `--…` ; `var()` d'une autre variable ou avec valeur de repli ; `url()` hors
`background`/`background-image` ou vers autre chose qu'une image du paquet ; sélecteurs
`html`, `body`, `main`, `:root`, `:host`, classes `lx-…`, pseudo-éléments (`::before`…),
`:scope ~ …` et `:scope + …`.

Restez lisible : texte foncé sur fond clair. Le moteur ne peut pas prouver qu'une couleur de
texte diffère de son fond ; **l'aperçu doit être relu avant activation**.

## 8. Vérifier, puis remettre

```bash
# depuis un clone du dépôt Lalanda (pnpm install fait une fois)
pnpm --filter @lalanda/api modele:valider chemin/vers/mon-modele
pnpm --filter @lalanda/api modele:valider chemin/vers/mon-modele --pdf apercu.pdf --paquet mon-modele.zip
pnpm --filter @lalanda/api modele:valider mon-modele.zip --json   # rapport pour un agent
```

La validation rend le gabarit sur **huit documents** : facture normalisée, noir et blanc sans
logo, environnement de test avec DUPLICATA, pro forma, facture d'avoir, acompte à
l'exportation, document riche (30 lignes, taxe spécifique, deux paiements, commentaires,
caractères à échapper), document sans paiement ni commentaire. Elle affiche « VALIDE » ou la
liste des erreurs (fichier:ligne:colonne, code, cas concerné).

Dans Lalanda : **Ventes › Modèle de facture › Modèles personnalisés** → Téléverser (rôle
Propriétaire ou Administrateur) → rapport de validation → **Aperçu** sur la facture EXEMPLE →
**Activer**. Chaque facture gelée garde la version exacte (identifiant, version, empreinte) :
la réimpression est identique même après une nouvelle version.

## 9. Liste de contrôle (pour un agent IA)

1. Copier `exemple-ocre/` et le renommer ; changer `id`, `name`, `description`, `author`,
   `version: "1.0.0"`.
2. Écrire la mise en page dans `gabarit.html` **en gardant toutes les variables du § 5** ;
   ne rien écrire de la zone DGI (§ 3) ni aucun texte réservé.
3. N'utiliser que les balises et attributs du § 4, chaque balise fermée, guillemets doubles.
4. Écrire `style.css` avec les seules propriétés du § 7, les couleurs `var(--lalanda-*)` et
   des tailles en `px`/`pt`.
5. Lancer `modele:valider` ; corriger chaque erreur par son code (§ 10) jusqu'à « VALIDE ».
6. Lancer `--pdf` et relire l'aperçu (lisibilité, débordements, plusieurs pages).
7. Remettre l'archive produite par `--paquet`.

## 10. Codes d'erreur

| Code | Signification | Correction |
|---|---|---|
| `PACKAGE_TOO_LARGE` | archive > 3 Mio | alléger images et polices |
| `PACKAGE_BAD_PATH` | chemin absolu, `..`, `\`, majuscules | noms en minuscules, relatifs |
| `PACKAGE_UNEXPECTED_FILE` | fichier ou dossier non prévu | voir § 1 |
| `PACKAGE_DUPLICATE_FILE` | même fichier deux fois (casse ignorée) | en garder un |
| `PACKAGE_FILE_TOO_LARGE` | fichier au-delà de son plafond | voir § 1 |
| `PACKAGE_TOO_MANY_FILES` | trop d'images ou de polices | ≤ 8 images, ≤ 6 polices |
| `PACKAGE_MISSING_FILE` | `manifest.json`, `gabarit.html` ou `style.css` absent | l'ajouter |
| `PACKAGE_NOT_UTF8` | texte non UTF-8 | réenregistrer en UTF-8 |
| `ZIP_MALFORMED` | archive illisible ou tronquée | recompresser |
| `ZIP_UNSUPPORTED` | ZIP64, multi-volumes, méthode inconnue | ZIP standard (deflate) |
| `ZIP_TOO_MANY_ENTRIES` | plus de 40 entrées | retirer des fichiers |
| `ZIP_ENTRY_TOO_LARGE` | une entrée > 2 Mio décompressée | alléger |
| `ZIP_TOO_LARGE` | plus de 8 Mio décompressés | alléger |
| `ZIP_BOMB` | taux de compression anormal ou taille mensongère | fichier légitime seulement |
| `ZIP_CRC` | somme de contrôle fausse | recompresser |
| `ZIP_ENCRYPTED` | entrée chiffrée | archive sans mot de passe |
| `ZIP_SYMLINK` | lien symbolique | copier le fichier réel |
| `ZIP_BAD_NAME` | nom non ASCII sans marque UTF-8 | renommer |
| `MANIFEST_INVALID_JSON` | JSON illisible | corriger la syntaxe |
| `MANIFEST_INVALID` | champ manquant, inconnu ou invalide | voir § 2 |
| `MANIFEST_FONT_MISSING` | police déclarée absente | ajouter le fichier ou corriger `file` |
| `FONT_NOT_WOFF2` | fichier de police non WOFF2 | convertir en WOFF2 |
| `FONT_UNUSED` | (avertissement) police non déclarée | la déclarer ou la retirer |
| `IMAGE_UNSUPPORTED_TYPE` | ni PNG, ni JPEG, ni WebP (SVG compris) | exporter en PNG |
| `IMAGE_MALFORMED` | image corrompue | réexporter |
| `IMAGE_DIMENSIONS_REJECTED` | moins de 32 px ou plus de 4 096 px | redimensionner |
| `IMAGE_TOO_LARGE` | image > 2 Mio | compresser |
| `IMAGE_EMPTY` | fichier vide | réexporter |
| `MUSTACHE_UNCLOSED_TAG` | `{{` sans `}}` | fermer la balise |
| `MUSTACHE_RAW_FORBIDDEN` | `{{{ }}}` ou `{{& }}` | `{{ }}` simple |
| `MUSTACHE_TAG_FORBIDDEN` | partiel, bloc, délimiteurs | retirer |
| `MUSTACHE_BAD_NAME` | nom de variable invalide (filtre, espace…) | nom exact du § 6 |
| `MUSTACHE_UNBALANCED` | section non fermée ou mal fermée | `{{#x}}…{{/x}}` |
| `MUSTACHE_TOO_DEEP` | plus de 8 sections imbriquées | simplifier |
| `TEMPLATE_UNKNOWN_VARIABLE` | variable absente du contrat | nom exact du § 6 |
| `TEMPLATE_NOT_TEXT` | liste, objet ou booléen affiché comme texte | utiliser une section |
| `TEMPLATE_TAG_FORBIDDEN` | balise interdite | voir § 4 |
| `TEMPLATE_ATTRIBUTE_FORBIDDEN` | attribut interdit (`style`, `on…`, `id`…) | classe + `style.css` |
| `TEMPLATE_BAD_SRC` | `src` hors images du paquet et logos | voir § 4 |
| `TEMPLATE_RESERVED_CLASS` | classe `lx-…` | renommer |
| `TEMPLATE_RESERVED_TEXT` | texte réservé à la zone DGI | le retirer |
| `TEMPLATE_HTML_COMMENT` | `<!-- -->` | `{{! … }}` |
| `TEMPLATE_HTML_SYNTAX` | balise ou attribut illisible | guillemets doubles, fermetures explicites |
| `TEMPLATE_HTML_UNBALANCED` | balises mal imbriquées | fermer dans l'ordre |
| `TEMPLATE_BAD_ENTITY` | entité non admise | caractère UTF-8 direct |
| `TEMPLATE_INVISIBLE_CHAR` | caractère invisible ou de contrôle | le supprimer |
| `TEMPLATE_MENTION_MISSING` | mention obligatoire non imprimée (cas indiqué) | voir § 5 |
| `TEMPLATE_OUTPUT_TOO_LARGE` | rendu > 1,5 million de caractères | ne pas imbriquer de listes |
| `TEMPLATE_OUTPUT_REJECTED` | la sortie rendue n'est pas un HTML admis | voir § 4 |
| `CSS_SYNTAX` | feuille illisible, `<`, commentaire non fermé | corriger |
| `CSS_AT_RULE_FORBIDDEN` | `@import`, `@font-face`, `@media`, `@page`… | polices dans le manifeste |
| `CSS_ESCAPE_FORBIDDEN` | `\` | écrire le caractère |
| `CSS_NESTING_FORBIDDEN` | règle imbriquée | règles à plat |
| `CSS_SELECTOR_FORBIDDEN` | `html`, `body`, `main`, `:root`, `lx-…`, `::before`, `:scope ~` | viser vos classes |
| `CSS_PROPERTY_FORBIDDEN` | propriété hors liste blanche | voir § 7 |
| `CSS_VALUE_FORBIDDEN` | valeur refusée (transparence, négatif, `url()` externe…) | voir § 7 |
