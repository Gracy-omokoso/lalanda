# ADR-0029 — Modèles de facture sur mesure (paquets téléversés)

Statut : Proposed
Date : 2026-10-21
Décideurs : Gracy Omokoso (demande du 21 oct. 2026 : « facture sur mesure », puis place de
marché) ; CTO Lalanda (contrat technique)

> **Prolonge [ADR-0028](ADR-0028-modeles-de-facture-et-identite.md)** : même contenu imprimé
> (`InvoiceDocumentModel`), même vérification des mentions à chaque rendu, même présentation
> figée au gel, même rendu Chromium confiné (S22e). Ce qui change : un modèle peut venir
> **de l'extérieur du dépôt**, sous forme d'un **paquet** écrit par un développeur, par Claude
> ou par Codex, téléversé par une organisation pour ses propres factures. Un paquet est du
> **contenu non fiable** ; tout ce qui suit découle de ce fait.

## Contexte

Les six modèles d'ADR-0028 sont du code TypeScript relu et versionné dans le dépôt. Une
entreprise qui veut une facture « à elle » (mise en page de sa charte, typographie de sa
marque) ne peut pas l'obtenir sans une livraison de Lalanda. La dirigeante demande qu'un
modèle puisse être **écrit comme un gabarit à variables**, remis à n'importe quel développeur
ou agent IA avec un guide, puis **téléversé et installé** par l'organisation. Plus tard, une
**place de marché** permettra de vendre des modèles : on la prépare (format, métadonnées,
empreinte, signature), on ne la construit pas.

Contraintes non négociables, héritées d'ADR-0025/0028 :

1. **Les éléments DGI ne dépendent pas du modèle.** Cadre « Éléments de sécurité DGI », QR
   code tel quel, bandeau et filigrane de test, mention DUPLICATA, pied réglementaire (version
   du logiciel, numéro, mentions répétées) : un paquet ne peut ni les retirer ni les masquer.
2. **Réimpression à l'identique** d'un original et d'un duplicata, même si l'organisation
   change ensuite de modèle ou installe une nouvelle version.
3. **Confinement du rendu** : aucun script, aucune requête réseau, aucune ressource hors du
   paquet ; un paquet hostile ne doit atteindre ni le serveur ni une autre organisation.

## Options considérées

### O1 — Langage de gabarit

| Option | Pour | Contre |
|---|---|---|
| **Handlebars** (mode strict, sans helpers) | connu, syntaxe Mustache | compile le gabarit en **JavaScript** (`new Function`) : la sûreté repose sur le générateur de code ; historique de failles d'exécution par pollution de prototype (CVE-2019-19919, CVE-2021-23369) ; helpers intégrés (`lookup`, `with`, `log`) à neutraliser un par un |
| **Liquid** (`liquidjs`) | conçu pour des gabarits de tiers (Shopify), sans `eval`, limites de rendu | dépendance nouvelle ; langage riche (filtres, affectations, boucles bornées, `include`) : grande surface à auditer pour un besoin de mise en page |
| **Mustache** (`mustache.js`) | sans logique, spécification stable et publique, connue de tous les outils et agents IA | bibliothèque peu active (dernière version 2021) ; résolution de noms qui suit la chaîne de prototypes ; triple moustache, partiels, changement de délimiteurs à interdire |
| **Sous-ensemble strict de Mustache, interprété par Lalanda** | aucune dépendance ; **aucune génération de code** (interprète d'arbre) ; résolution limitée aux propriétés propres de données construites par le moteur ; **chaque variable vérifiée contre le contrat de données à l'installation** (rapport ligne/colonne) ; bornes de taille et de profondeur maîtrisées | ~300 lignes à maintenir et à tester nous-mêmes |

**Retenu : sous-ensemble strict de Mustache, interprété par Lalanda**
(`apps/api/src/sales/documents/templates/custom/mustache.ts`). La syntaxe est celle de
Mustache (que développeurs, Claude et Codex écrivent sans apprentissage), le moteur est un
interprète de quelques centaines de lignes sans `eval`, et le **contrôle statique** contre le
contrat typé est ce qui rend l'objectif « valide du premier coup » atteignable : une variable
mal orthographiée est refusée à la validation locale, pas découverte sur une facture.

Sous-ensemble admis : `{{chemin.vers.valeur}}` (texte **toujours échappé**), sections
`{{#x}}…{{/x}}` (liste : répétition ; objet ou texte non vide : contexte ; booléen : condition),
sections inverses `{{^x}}…{{/x}}`, élément courant `{{.}}`, commentaires `{{! … }}`. Refusés :
`{{{x}}}` et `{{&x}}` (HTML brut), partiels `{{> x}}`, changement de délimiteurs `{{= =}}`,
blocs et héritage (`{{$ }}`, `{{< }}`), lambdas. Aucun helper, aucun filtre, aucune
arithmétique : le moteur fournit des chaînes déjà mises en forme.

### O2 — Où vit la zone DGI, et comment le CSS d'un modèle ne l'atteint pas

- **A. Le modèle place la zone, le moteur vérifie le HTML** (ADR-0028 pour les modèles du
  dépôt). Insuffisant ici : la vérification par chaîne prouve qu'une mention est **écrite**,
  pas qu'elle est **visible** ; un CSS de tiers peut écrire `display:none`.
- **B. Contrôle du CSS par liste noire** (`display:none`, `opacity`…). Écarté seul : une liste
  noire oublie toujours une propriété (`clip-path`, `transform: scale(0)`, `text-indent`
  négatif, `color: transparent`, recouvrement par un bloc positionné…).
- **C. Shadow DOM déclaratif autour de la zone DGI.** Écarté : les propriétés héritées
  (`visibility`, `color`) et celles posées sur un ancêtre (`opacity`, `display`, `transform`)
  traversent la frontière ; le modèle stylerait l'hôte.
- **D. Zone DGI dans une couche que le CSS du modèle ne peut pas atteindre** + CSS du modèle
  **confiné** à son conteneur et **filtré par liste blanche**. **Retenu**, en trois barrières
  indépendantes :
  1. **Couches hors d'atteinte.** Le DUPLICATA, le bandeau de test et le pied réglementaire
     sont répétés dans l'**en-tête et le pied de page Chromium** (documents séparés, rendus
     dans les marges : aucun sélecteur de la page n'y accède — déjà le cas, ADR-0025/0028).
     Le filigrane TEST/EXEMPLE est posé par le moteur hors du conteneur, au-dessus de tout.
  2. **Zones du moteur hors du conteneur du modèle.** Le corps est assemblé par le moteur :
     `zone haute` (bandeau de test, bandeau EXEMPLE, DUPLICATA) — `<main class="lx-modele">`
     (le seul endroit où le gabarit écrit) — `zone de sécurité` (cadre DGI, QR, cinq
     éléments, libellés). Le CSS du modèle est **réécrit** : chaque sélecteur commence par
     `.lx-modele:scope` **et** l'ensemble est placé dans `@scope (.lx-modele)` ; il ne peut
     donc sélectionner que le conteneur et ses **descendants**. Les deux barrières sont
     indépendantes (prouvé dans Chromium réel : des règles hostiles derrière une seule des
     deux ne changent pas un octet du PDF). Les sélecteurs `html`, `body`, `main`, `:root`,
     `:host`, les classes réservées `lx-*`, `:scope ~ …` / `:scope + …` (voisins du
     conteneur), les pseudo-éléments, les at-règles (`@import`, `@page`, `@media`,
     `@font-face`, `@layer`…), l'imbrication CSS et les échappements `\` sont refusés. Les
     zones du moteur sont positionnées au-dessus du conteneur (`z-index`, fond blanc) et le
     conteneur est isolé (`isolation: isolate`) : un débordement du contenu du modèle ne les
     recouvre pas.
  3. **Liste blanche de propriétés CSS** (typographie, couleurs opaques, boîtes, flex/grid
     sans placement explicite, bordures, fonds, sauts de page). Absentes, donc refusées :
     `position`, décalages, `z-index`, `transform`, `opacity`, `visibility`, `filter`,
     `clip-path`, `mask`, `overflow`, `content`, `contain`, `isolation`, `mix-blend-mode`,
     `will-change`, `animation`, `transition`, propriétés personnalisées `--*`. Valeurs
     contrôlées : `display: none` refusé, `color` opaque seulement (ni `transparent`, ni
     canal alpha), `font-size` en `px`/`pt`/`mm` ≥ 6 px, `text-indent`, marges et
     `letter-spacing` négatifs refusés, longueurs ≤ 1 000 px, `url()` limité aux images du
     paquet, `var()` limité aux variables `--lalanda-*` du moteur.

  Effet recherché : sans positionnement, sans `z-index` et sans aucune propriété qui crée
  un contexte d'empilement, **le texte du modèle se peint au-dessus de tous les fonds** du
  conteneur (ordre de peinture CSS 2.1, annexe E) ; un aplat ne peut pas recouvrir une
  mention, et rien dans le conteneur ne peut recouvrir les zones du moteur.

### O3 — Format du paquet

- **Dossier téléversé fichier par fichier** : écarté (multipart, arborescence côté client).
- **JSON unique** (fichiers en base64) : écarté (illisible pour un humain, mauvaise
  expérience pour un designer).
- **Archive ZIP d'un dossier normalisé** : retenu. Universelle (« Compresser » sur macOS et
  Windows). Lue par un lecteur ZIP **écrit pour ce besoin** (`security/zip-reader.ts`, `node:zlib`), qui
  applique les plafonds **avant** et **pendant** la décompression ; aucune dépendance.

## Décision

### 1. Le paquet

Archive `.zip` (ou dossier, pour la validation locale), éventuellement enveloppée dans un seul
dossier racine (retiré). Fichiers admis, noms en minuscules `[a-z0-9._-]` :

| Chemin | Rôle | Plafond |
|---|---|---|
| `manifest.json` | identité, version, options (§ 2) | 16 Kio |
| `gabarit.html` | gabarit Mustache produisant le corps du document | 128 Kio |
| `style.css` | feuille du modèle (confinée, liste blanche) | 64 Kio |
| `images/*.png\|jpg\|jpeg\|webp` | images fixes (motif, signature graphique) — **pas de SVG** | 8 fichiers, porte de la photo de profil (2 Mio, 32 à 4 096 px, octets reconstruits) |
| `polices/*.woff2` | polices du paquet (WOFF2 seulement) | 6 fichiers, 256 Kio chacun |
| `polices/*.txt`, `LICENCE.txt`, `LICENSE.txt`, `LISEZMOI.md`, `README.md` | licences, notes (non rendues) | 64 Kio |

Archive ≤ 3 Mio, ≤ 40 entrées, ≤ 8 Mio décompressés, taux de compression ≤ 200 par entrée.
Refusés : chemins absolus ou avec `..`, `\`, caractères de contrôle, doublons (casse
ignorée), liens symboliques, entrées chiffrées, ZIP64, multi-volumes, méthodes autres que
« stocké » et « deflate », CRC faux. `__MACOSX/` et `.DS_Store` sont ignorés (mais comptés
dans les plafonds).

**Empreinte du paquet** : SHA-256 d'une liste canonique `chemin NUL sha256(contenu) LF`,
triée par chemin, des fichiers retenus. Elle ne dépend ni de l'outil de compression ni des
dates : deux archives du même dossier ont la même empreinte. C'est elle qui est figée,
vérifiée au rendu, et qui sera signée (§ 9).

### 2. Le manifeste (format 1)

```json
{
  "format": "lalanda.modele-facture",
  "formatVersion": 1,
  "id": "atelier-kin.ocre",
  "name": "Ocre",
  "description": "Bandeau ocre, typographie à empattements.",
  "version": "1.0.0",
  "contract": 1,
  "author": { "name": "Atelier Kin", "email": "contact@exemple.cd", "url": null },
  "publisher": null,
  "license": "proprietary",
  "price": null,
  "options": {
    "palettes": ["brand", "mono"],
    "accent": "#9a3412",
    "fonts": ["source-serif-4", "inter"],
    "font": "source-serif-4"
  },
  "fonts": [
    { "family": "Ocre Titre", "file": "polices/ocre-titre-600.woff2", "weight": 600, "style": "normal" }
  ],
  "signature": null
}
```

- `id` : `éditeur.nom`, minuscules, chiffres, tirets (3 à 64 caractères) ; `version` :
  SemVer `MAJEUR.MINEUR.CORRECTIF` strict.
- `contract` : version **majeure** du contrat de données (§ 3). Seule `1` existe ; un
  ajout de variable reste en `1`, un retrait ou un changement de sens ouvrira `2`.
- `options` : les mêmes options que les modèles intégrés — palettes admises, couleur
  d'accent par défaut, polices **intégrées** proposées (identifiants d'ADR-0028 § 5) et
  police par défaut. Elles se résolvent et se figent exactement comme pour un modèle intégré.
- `fonts` : polices du paquet, utilisables dans `style.css` par leur `family` (un nom
  commençant par « Lalanda » est refusé). Le moteur pose lui-même les `@font-face` (données
  intégrées en `data:`) : `@font-face` est refusé dans `style.css`.
- **Préparation de la place de marché** (lus, contrôlés, non exploités aujourd'hui) :
  `publisher` (`{ id, name, url }`), `license` (identifiant SPDX ou `proprietary`), `price`
  (`null` ou `{ amount: "25.00", currency: "USD"|"CDF" }`), `signature` (doit valoir `null` :
  aucune signature n'est encore vérifiée, une valeur est refusée plutôt qu'ignorée).
- Tout champ inconnu est refusé.

### 3. Contrat de données (version 1)

Le gabarit reçoit, en lecture seule, **le même contenu imprimé que les six modèles**
(`InvoiceDocumentModel`, ADR-0025 § 1 à § 7), réduit à ce que le modèle doit placer :

- `document.*` : intitulé, mentions de nature et d'état, numéro et date (libellé + valeur),
  vendeur et client (titre + lignes), références d'avoir, devise et note des montants, mode
  de prix, lignes (désignation, code, type, groupe, quantité, prix unitaire, modification,
  taxe spécifique, montant), ventilation par groupe, taxe spécifique, total TVA, total,
  montant en lettres, paiements, contre-valeur, opérateur, commentaires ; booléens
  `isInvoice` / `isProforma` ;
- `labels.*` : libellés DGI fixes que le modèle imprime (« Total TVA », « Taxe spécifique »,
  « Établi par ») ;
- `brand.*` : initiales, logo préféré et quatre déclinaisons (à placer dans `src`) ;
- `theme.mono` ;
- variables CSS `--lalanda-accent`, `--lalanda-on-accent`, `--lalanda-soft`,
  `--lalanda-line`, `--lalanda-side`, `--lalanda-on-side`, `--lalanda-font-body`,
  `--lalanda-font-display`, `--lalanda-font-code` (couleurs déjà contrastées, ADR-0028).

Ne sont **pas** fournis au gabarit : DUPLICATA, test, EXEMPLE, éléments de sécurité, QR,
pied : le moteur les pose (§ 4). La liste exhaustive, typée, est générée depuis le code
(`custom/data-contract.ts`) et recopiée dans le guide ; un test vérifie qu'elles concordent.

### 4. Assemblage d'un rendu

```
<body>
  zone haute du moteur      bandeau de test · bandeau EXEMPLE · DUPLICATA n° k
  <main class="lx-modele">  ← sortie du gabarit (seul endroit qu'il écrit)
  zone de sécurité moteur   « Éléments de sécurité DGI », QR tel quel, 5 éléments
  filigrane TEST / EXEMPLE  (moteur, au-dessus de tout)
</body>
+ en-tête et pied Chromium : bandeau de test, DUPLICATA, pied réglementaire, pagination
```

Marges de page fixées par le moteur (12 mm en haut, 16 mm en bas, 0 sur les côtés ; les zones
du moteur ont 12 mm de retrait). Le gabarit ne règle pas `@page`.

Puis **toutes** les vérifications d'ADR-0028 § 2 (`missingMentions`, mentions répétées) : le
gabarit doit imprimer, échappée et d'un seul tenant, chaque mention qui lui revient ; il en
manque une ⇒ rien n'est imprimé (`TEMPLATE_DGI_CONTENT_MISSING`). Enfin la sortie du gabarit
est **re-validée** (balises et attributs autorisés, imbrication équilibrée, `src` limités aux
images du paquet et aux logos) avant substitution des images en `data:`.

HTML admis dans le gabarit : balises de structure et de texte (`div`, `span`, `p`, `h1`–`h6`,
`table` et ses parties, listes, `img`, `section`, `header`, `footer`, `strong`, `em`…),
attributs `class` (préfixe `lx-` réservé), `alt`, `src` (img), `width`/`height` (img),
`colspan`/`rowspan`. Refusés : `script`, `style`, `link`, `meta`, `iframe`, `object`, `svg`,
`form`, attributs `style` et `on*`, commentaires HTML, entités autres que `&amp; &lt; &gt;
&quot; &apos; &nbsp;`, caractères invisibles (catégorie Unicode Cf). Le **texte fixe** du
gabarit ne peut pas contenir les libellés réservés au moteur (« Éléments de sécurité DGI »,
« Code DEF/DGI », « DEF NIM », « DEF Compteurs », « DEF Heure », « ISF », « DUPLICATA »,
« TEST », « EXEMPLE », « Environnement de test », « sans valeur fiscale ») : un modèle ne peut
pas contrefaire un cadre DGI ni un bandeau.

Bornes d'exécution : sortie du gabarit ≤ 1,5 Mio (vérifiée pendant le rendu), profondeur de
sections ≤ 8.

### 5. Validation à l'installation

`validateTemplatePackage` (le même code sert l'API et la commande locale) :

1. lecture de l'archive (plafonds, chemins, types) ;
2. manifeste (schéma strict, SemVer, options, polices déclarées présentes et WOFF2 valides) ;
3. images (porte de la photo de profil) ;
4. gabarit : syntaxe Mustache, **chaque variable contre le contrat** (types, sections),
   HTML autorisé, texte réservé ;
5. CSS : syntaxe, sélecteurs, liste blanche, valeurs, images et polices référencées ;
6. **batterie de rendu** (sans Chromium) : facture normalisée, production noir et blanc,
   test + duplicata, pro forma, avoir, acompte à l'exportation, document riche (30 lignes,
   taxe spécifique, paiements multiples, commentaires, caractères à échapper), avec et sans
   logo — chaque rendu passe le vérificateur de mentions.

Rapport en français, chaque erreur avec un **code stable**, le fichier, la ligne et la
colonne, et le cas de la batterie concerné. Un paquet invalide n'est jamais stocké.

Commande locale : `pnpm --filter @lalanda/api modele:valider <dossier|archive.zip>`
(`--pdf apercu.pdf` : aperçu réel si Chromium est présent ; `--paquet sortie.zip` : archive
prête à téléverser).

### 6. Stockage, versions, isolation

- Collection `invoice_template_packages` : un document **immuable** par version installée
  (`packageId` 128 bits tiré au hasard, `organizationId`, `templateId` = `manifest.id`,
  `version`, `name`, `contentSha256` (empreinte § 1), `archiveSha256`, `objectKey`
  `template-packages/<packageId>`, manifeste, taille, auteur de l'installation, date).
  Index unique `(organizationId, templateId, version)`.
- **Une version installée ne change plus** : téléverser la même version avec la même
  empreinte rend la version existante ; avec une autre empreinte : `409
  TEMPLATE_VERSION_EXISTS` (publier `1.0.1`). Aucune suppression (une facture gelée peut la
  désigner).
- **Isolation** : toute lecture filtre par `organizationId`, cache compris (clé
  `organisation:paquet:empreinte`) ; un `packageId` d'une autre organisation est « introuvable ».

### 7. Gel et réimpression

Le choix de l'organisation devient `invoiceTemplate = { id: "sur-mesure", packageId,
options }`. Au gel, `presentation` reçoit (champ optionnel d'ADR-0028 § 6, déjà couvert par
`contentSha256`) :

```
{ template: { id: "sur-mesure", version: <version du moteur sur mesure, "1.0.0"> },
  package:  { packageId, id, name, version, sha256 },      // sha256 = empreinte § 1
  options, identity }
```

Au rendu d'un original ou d'un duplicata, l'archive est relue, **recompilée avec les mêmes
règles** (sans rejouer la batterie, déjà passée à l'installation), son **empreinte recalculée et
comparée** : différente ou absente ⇒ `409 TEMPLATE_PACKAGE_INTEGRITY` (jamais un original
« presque identique ») ; stockage indisponible ⇒ `503 TEMPLATE_PACKAGE_UNAVAILABLE`. La
version du **moteur** sur mesure suit la règle d'ADR-0028 § 4 : changer l'assemblage ou les
règles d'un rendu, c'est publier une nouvelle version du moteur et garder l'ancienne.

### 8. Contrat HTTP et permissions

| Route | Permission |
|---|---|
| `GET /sales/invoice-template-packages` (paquets installés, versions, plafonds) | `sales.read` |
| `POST /sales/invoice-template-packages` (corps binaire ZIP, 20/h/utilisateur) | `organization.manage` |
| `GET /sales/invoice-template-packages/:packageId/preview[?palette&accent&font&format=png]` (120/h/utilisateur) | `sales.read` |
| `PUT /sales/invoice-template/custom` (`{ packageId, options, expectedRevision }`) | `organization.manage` |

Revenir à un modèle intégré ou à la présentation d'origine : `PUT /sales/invoice-template`
existant. Paquet invalide : `422 TEMPLATE_PACKAGE_INVALID` avec `details.report`. Audit :
`sales.invoice_template_package_installed` (id, version, empreinte, taille) et
`sales.invoice_template_updated` (avec `packageId`). Aucune action RBAC nouvelle.

### 9. Place de marché : préparation seulement

- Le **format** (§ 1–3) est déjà celui d'un modèle distribuable : rien n'y dépend d'une
  organisation.
- Métadonnées présentes dans le manifeste : `publisher`, `license`, `price`, `author`.
- **Empreinte canonique** (§ 1) : c'est elle qu'un éditeur signera.
- **Signature (future)** : Ed25519 sur `lalanda.modele-facture/1\n<id>\n<version>\n<empreinte>`,
  clé publique de l'éditeur certifiée par Lalanda ; le champ `signature` est aujourd'hui
  réservé (`null` exigé).
- Certification Lalanda : même batterie (§ 5) + relecture visuelle humaine + rendu Chromium
  réel ; compatibilité déclarée par `contract`.
- Hors périmètre : catalogue, paiement, rémunération des auteurs, révocation à distance.

## Conséquences

- Une organisation peut imprimer ses factures dans sa propre charte sans livraison de
  Lalanda ; un développeur ou un agent IA produit un paquet valide en suivant
  `docs/modeles-facture/` et en le vérifiant localement.
- Les éléments DGI critiques ne sont jamais entre les mains du paquet.
- **Risque résiduel, assumé et documenté** : le CSS d'un paquet peut encore rendre une
  mention **qu'il place lui-même** peu lisible (texte de la couleur du fond, débordement hors
  de la page d'une ligne en `white-space: nowrap`). La vérification statique ne prouve pas la
  lisibilité. Atténuations : le paquet n'est installé que par l'organisation pour ses propres
  factures (aucun effet sur une autre) ; l'aperçu EXEMPLE est obligatoire avant activation
  dans l'interface ; la certification de la place de marché ajoutera une relecture visuelle
  et une sonde de lisibilité automatique (décision ouverte 3).
- Stockage : quelques Mio par organisation et par version, jamais supprimés.
- Aucune dépendance nouvelle.

## Plan de validation

- Unitaires : lecteur ZIP (bombe, `..`, lien symbolique, chiffré, CRC faux, ZIP64, doublons,
  trop d'entrées, archive tronquée) ; Mustache (spécification du sous-ensemble, échappement,
  balises interdites, variables inconnues, sections, bornes) ; CSS (chaque échappatoire :
  `@import`, `url()` externe, `display:none` sur la zone DGI, `body`, `:root`, `lx-*`,
  `position: fixed`, `opacity`, `transform`, `z-index`, `var()` étranger, `--*`, `\`,
  feuille énorme) ; HTML (script, `on*`, `style`, `iframe`, `svg`, commentaires, entités,
  caractères invisibles, faux cadre DGI) ; manifeste ; empreinte stable au recompactage ;
  le paquet exemple du dépôt est valide et passe la batterie.
- Rendu Chromium réel (si disponible) : PDF de l'exemple (test + duplicata, noir et blanc,
  30 lignes, pro forma) dans `apps/api/.vitest/pdf-samples/`, déterministe ; des règles qui
  cacheraient la zone DGI, placées derrière **une seule** des deux barrières de
  confinement, laissent le PDF identique octet pour octet (témoin : sans barrière, il change).
- E2E (`invoice-template-packages.e2e.test.ts`) : RBAC, paquet hostile refusé avec rapport,
  installation, version immuable (409), aperçu EXEMPLE (PDF, PNG), activation, gel
  (référence id + version + empreinte), réimpression identique après installation d'une
  nouvelle version et changement de modèle, duplicata, isolation entre organisations,
  intégrité (archive altérée ⇒ 409).

## Décisions ouvertes — elles appartiennent à la décideuse

1. **Qui peut installer** : `organization.manage` (retenu) ; faut-il une relecture Lalanda
   avant la première activation d'un paquet non certifié ?
2. **Retrait d'une version** (la masquer de la liste sans la supprimer) : à décider.
3. **Sonde de lisibilité** automatique (rendu Chromium, contraste du texte des mentions) avant
   activation : coût de rendu à arbitrer.
4. **Place de marché** : modèle économique (prix, commission, paiement des auteurs), licence
   par défaut, procédure de certification et de révocation.
5. **SVG** dans les paquets : refusé, comme pour les logos (ADR-0028 décision ouverte 5).
6. **Durcissement futur des règles** : un paquet est recompilé à chaque réimpression ; si une
   faille impose un jour de durcir le validateur, un paquet déjà figé pourrait être refusé.
   Retenu : la sécurité prime (refus explicite, jamais un rendu non contrôlé) ; à arbitrer alors
   pour les factures concernées (réimpression avec l'ancien moteur versionné, ou PDF conservé).

## Liens

- [ADR-0025](ADR-0025-documents-pdf-factures.md), [ADR-0028](ADR-0028-modeles-de-facture-et-identite.md),
  [ADR-0012](ADR-0012-modele-rbac-complet.md)
- docs/17 (téléversements, contenu non fiable, S22e), docs/19 (feuille de route),
  docs/modeles-facture/ (guide des créateurs)
- Code : `apps/api/src/sales/documents/templates/custom/`, `apps/api/src/branding/`
