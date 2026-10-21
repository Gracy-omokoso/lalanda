# ADR-0028 — Modèles de facture et identité visuelle de l'organisation

Statut : Proposed
Date : 2026-10-21
Décideurs : Gracy Omokoso (décision du 21 oct. 2026 : six modèles validés sur maquettes,
options, identité visuelle) ; CTO Lalanda (contrat technique)

> **Amende [ADR-0025](ADR-0025-documents-pdf-factures.md)** (§ 11 ajouté) : la mise en page
> du PDF n'est plus unique ; un nouveau champ figé optionnel `presentation` s'ajoute à
> `softwareVersion`. Le **contenu** imprimé (ADR-0025 § 1 à § 7, ADR-0026 § 3 et § 6.2) est
> inchangé et désormais **vérifié à chaque rendu**. Réutilise la porte de téléversement de la
> photo de profil (docs/17, docs/24) et le rendu Chromium confiné (S22e). Indépendant du format
> des numéros (ADR-0027) : le numéro est une chaîne déjà figée.

## Contexte

Jusqu'ici, toutes les factures sortaient d'une seule mise en page (« gabarit 1.0.0 »,
`invoice-document-html.ts`), sans logo ni couleur ; le logo de l'organisation n'était qu'une
URL saisie dans les paramètres, jamais imprimée. Les entreprises clientes veulent une facture
à leur image. La dirigeante a validé le 21 oct. 2026 **six modèles** sur maquettes (Classique,
Bandeau, Latérale, Minimal, Compacte, Éditoriale), chacun avec des options, alimentés par une
**identité visuelle** de l'organisation (logo principal et trois déclinaisons, couleurs,
police).

Trois contraintes non négociables encadrent le choix :

1. **Les mentions DGI sont verrouillées.** Un modèle change la présentation, jamais le
   contenu : intitulé selon `documentKind`, numéro, dates, vendeur complet, client et type,
   lignes (type, groupe), ventilation par groupe, totaux, paiements, montant en lettres,
   contre-valeur, cadre « Éléments de sécurité DGI » et QR code encodé tel quel, opérateur,
   version du logiciel figée, DUPLICATA, et le filigrane / bandeau « Environnement de test
   DGI — sans valeur fiscale » + TEST.
2. **Réimpression à l'identique.** L'original se retélécharge identique, même si
   l'organisation change ensuite de modèle, de couleurs ou de logo (ADR-0025 § O2, § O3).
3. **Confinement du rendu.** Chromium ne charge rien depuis le réseau (S22e) : ni police en
   ligne, ni image distante.

## Options considérées

### O1 — Où vit le contenu DGI

- **A. Chaque modèle compose tout son HTML** à partir du document brut. Écarté : chaque
  modèle réimplémenterait les règles d'impression, et un oubli passerait inaperçu.
- **B. Le contenu est décidé une fois (`InvoiceDocumentModel`), le modèle ne fait que le
  placer ; le moteur VÉRIFIE ensuite que chaque mention exigée figure dans le HTML.** Retenu.
  La liste des mentions est **dérivée du document** : ce qui s'imprime aujourd'hui ne peut pas
  manquer demain, quel que soit le modèle.

### O2 — Figer quoi au gel

- **A. Ne rien figer, rendre avec le modèle courant.** Écarté : contraire à la réimpression à
  l'identique.
- **B. Conserver le PDF émis (MinIO).** Écarté pour ce lot (même raisonnement qu'ADR-0025
  O2 : décision ouverte O2.2 de conservation), et ne couvre pas le duplicata.
- **C. Figer la présentation : modèle + version, options RÉSOLUES, empreinte de l'identité
  (logos par identifiant immuable + SHA-256, couleurs, police).** Retenu. Les logos sont
  conservés comme objets immuables ; les modèles et polices sont versionnés dans le code.

### O3 — Logos : formats

- **SVG** : refusé. L'assainissement existant (`image-validation.ts`) n'analyse pas le XML et
  refuse le SVG par construction (document exécutable). Rien ne permet de l'accepter « sans
  risque » sans écrire un assainisseur XML/SVG complet : hors périmètre.
- **PNG, JPEG, WebP** : acceptés, par la porte de la photo de profil (contenu analysé,
  métadonnées EXIF/GPS retirées, octets reconstruits, 2 Mio, 32 à 4096 px). `sharp` n'est pas
  utilisé (la porte existante l'écarte délibérément, docs/17).

### O4 — Polices

- **Google Fonts au rendu** : interdit (réseau, confinement S22e, déterminisme).
- **Paquets npm `@fontsource/*` en dépendance** : écarté (dépendances nouvelles évitables).
- **Fichiers `woff2` OFL-1.1 dans le dépôt, intégrés en `data:`** : retenu
  (`apps/api/assets/fonts`, notices et licences, empreintes figées par test).

## Décision

### 1. Six modèles, une liste fermée

| Modèle | Défauts | Polices proposées |
|---|---|---|
| Classique | marque, `#0f5132`, Inter | Inter, IBM Plex Sans, Manrope, Source Serif 4 |
| Bandeau | marque, `#1d4ed8`, Manrope | idem |
| Latérale | marque, `#7c2d12`, IBM Plex Sans | idem |
| Minimal | **noir et blanc**, `#0f5132`, Inter | idem |
| Compacte | marque, `#334155`, IBM Plex Sans | idem |
| Éditoriale | marque, `#7f1d1d`, Fraunces + Inter | Fraunces + Inter, Source Serif 4 + IBM Plex Sans, Source Serif 4 + Manrope |

Options : **palette** « couleurs de la marque » ou « noir et blanc » (logos en niveaux de
gris), **couleur d'accent** (`#rrggbb` ; texte posé dessus toujours lisible, contraste WCAG
AA ≥ 4,5:1 garanti par `branding/colors.ts`), **police** (liste du modèle). Mises en page
fidèles aux maquettes `*.dc.html` validées.

Écart assumé avec les maquettes : la ligne « Total HT » n'est pas imprimée — le moteur ne la
fournit pas et l'API ne calcule rien (la base HT par groupe est imprimée). Voir décisions
ouvertes.
**Résorbé le 21 oct. 2026** par les versions 1.1.0 (amendement plus bas).

### 2. Zone DGI imposée, vérifiée à chaque rendu

`templates/dgi-content.ts` dérive de `InvoiceDocumentModel` la liste des mentions exigées
(intitulé, mentions de nature et d'état, DUPLICATA, bandeau et mot TEST, numéro et date avec
leurs libellés, vendeur et client ligne par ligne, référence d'avoir, devise qui fait foi,
mode de prix, chaque champ de chaque ligne, chaque groupe, taxe spécifique, TVA, total,
montant en lettres, paiements, contre-valeur, les cinq éléments de sécurité et leurs
libellés, opérateur, commentaires) et vérifie que chacune figure **échappée telle quelle** dans
le HTML, que le **SVG du QR code** y figure à l'identique, et que l'en-tête ou le pied répété
porte le bandeau de test, le DUPLICATA et la version figée. Une mention manque : le PDF
n'est pas rendu (`500 TEMPLATE_DGI_CONTENT_MISSING`) — jamais une facture amputée.

Le moteur, pas le modèle, pose : la CSP (`default-src 'none'; img-src data:; font-src
data:`), les polices, le **filigrane** (au-dessus du contenu : un aplat de couleur ne le masque
pas), les fragments imposés (`dgi.testBand`, `dgi.sampleBand`, `dgi.qrSvg`), l'en-tête et le
pied répétés sur chaque page.

### 3. Interface d'un modèle (préparer les modèles écrits hors du dépôt)

`templates/template.contract.ts` :

- **entrée typée** `TemplateRenderInput` : `document` (contenu imprimé, lecture seule), `dgi`
  (fragments imposés), `brand` (logos déjà intégrés en `data:`, initiales), `theme`
  (couleurs et polices dérivées : le modèle n'en calcule aucune), `options` ;
- **sortie** `{ css, body }` ; `page` (marges) ; `id`, `version`, `label`, `defaults`,
  `fontChoices`.

Cette interface — données d'entrée typées, sortie HTML, zone DGI imposée et vérifiée — est
celle qu'un gabarit à variables écrit par un tiers devra satisfaire (feuille de route,
docs/19). Aucun chargement de modèle externe n'est implémenté.

### 4. Versions

Chaque modèle garde toutes ses versions publiées (`registry.ts`). **Une version publiée ne
change plus jamais de rendu** ; modifier un modèle, c'est publier une nouvelle version. Le
choix d'une organisation pointe la dernière ; une facture gelée garde la sienne. Une version
introuvable (code rétrogradé) : `409 INVOICE_TEMPLATE_UNAVAILABLE`. Les polices suivent la
même règle (fichier jamais remplacé en place ; empreintes figées par
`invoice-fonts.test.ts`).

### 5. Polices

Inter, IBM Plex Sans, Manrope, Source Serif 4, Fraunces (paires d'Éditoriale) et JetBrains
Mono (codes DGI), sous-ensemble latin, OFL-1.1, provenance Fontsource 5.3.x, copiés sans
modification. Notices : `apps/api/assets/fonts/NOTICE.md` et `OFL.txt` par famille. Noms CSS
préfixés « Lalanda … » (aucune collision avec une police installée). Le dossier voyage avec
le paquet de l'API (`/app/assets/fonts` dans l'image) ; le build Docker échoue s'il manque.

### 6. Gel et réimpression

Au gel (`InvoiceFreezingService`, dans la transaction), si l'organisation a choisi un modèle,
le champ figé optionnel **`presentation`** reçoit :

```
{ template: { id, version },
  options: { palette, accent, font },            // RÉSOLUES : saisie, puis identité, puis défaut
  identity: { primaryColor, secondaryColor, font,
              logos: { primary|horizontal|symbol|light: { assetId, sha256, contentType, width, height } | null } } }
```

- Il entre dans `contentSha256` (champ optionnel : absent ou `null`, l'empreinte est celle
  d'avant). Le journal chaîné n'est pas modifié (il porte déjà l'empreinte).
- **Original et duplicata** se rendent avec la présentation figée ; un **brouillon** (pro
  forma non figé) avec le choix courant.
- Les octets de chaque logo figé sont relus et **comparés à leur SHA-256** avant d'être
  intégrés : objet absent ou altéré → `409 BRAND_ASSET_INTEGRITY` (jamais un original « presque
  identique ») ; stockage indisponible → `503 BRAND_ASSET_UNAVAILABLE`.
- **Sans modèle choisi** (cas de toutes les organisations aujourd'hui) : rien n'est figé, la
  présentation d'origine imprime le document **octet pour octet comme avant**. Les documents
  gelés avant le 21 oct. 2026 n'ont pas le champ : même rendu qu'aujourd'hui, aucune
  migration.
- **Retour en brouillon** : `presentation` est remis à `null` avec les autres champs figés.

### 7. Identité visuelle

- Collections : `organization_brands` (état courant : logos reliés, couleurs, police, modèle
  et options saisies, révision optimiste) et `organization_brand_assets` (un document **immuable
  et jamais supprimé** par logo téléversé : identifiant de 128 bits tiré au hasard, clé
  `brand-assets/<id>` sans donnée de l'organisation, SHA-256, dimensions).
- Remplacer ou retirer un logo ne change que le **pointeur** : l'objet reste (factures
  gelées). Isolation : toute lecture filtre par organisation, cache compris.
- Affichage dans l'interface : URL signée HMAC (clé dérivée d'`AUTH_SECRET`, étiquette propre,
  24 h), servie **seulement si le logo est encore relié** — remplacer ou retirer révoque
  immédiatement les URL distribuées. Le PDF n'utilise jamais cette route.

### 8. Contrat HTTP et permissions

| Route | Permission |
|---|---|
| `GET /organizations/current/brand` | `organization.manage` |
| `PUT /organizations/current/brand/identity` | `organization.manage` |
| `POST /organizations/current/brand/logos/:variant` (corps binaire, 20/h/utilisateur) | `organization.manage` |
| `DELETE /organizations/current/brand/logos/:variant` | `organization.manage` |
| `GET /brand-assets/:token` | jeton signé (comme l'avatar) |
| `GET /sales/invoice-templates` | `sales.read` |
| `PUT /sales/invoice-template` | `organization.manage` |
| `GET /sales/invoice-templates/:id/preview[?palette&accent&font&format=png]` (120/h/utilisateur) | `sales.read` |

Aucune action nouvelle : l'identité visuelle et le choix du modèle sont des paramètres de
l'organisation (`organization.manage` : Propriétaire, Administrateur), qui n'engagent pas le
contribuable — le contenu fiscal n'en dépend pas. La matrice RBAC est inchangée ;
`routes-coverage.test.ts` fixe ces permissions.

**Aperçu** : facture **fictive** (`sample-invoice.ts`, montants constants des maquettes,
codes DGI manifestement fictifs) au nom de la fiche fiscale de l'organisation, marquée
**EXEMPLE** (filigrane, bandeau, pied), rendue par le vrai moteur. Rien n'est enregistré ni
journalisé. `format=png` : première page capturée par le même Chromium, même portillon,
même confinement (la CSP du web interdit d'encadrer un PDF).

Audit : `organization.brand_identity_updated`, `organization.brand_logo_uploaded`,
`organization.brand_logo_removed`, `sales.invoice_template_updated` ; l'export du PDF
d'origine journalise le modèle (`template: id@version`).

### 9. Web

« Organisation › Identité visuelle » (`organization.manage`) et « Ventes › Modèle de facture »
(`sales.read` ; enregistrement réservé à `organization.manage`). Galerie à vignettes réelles,
options, aperçu agrandi, PDF complet, retour à la présentation d'origine.

## Conséquences

- Une facture peut porter le logo et les couleurs de l'entreprise sans qu'aucun modèle puisse
  omettre une mention DGI : la règle est vérifiée, pas promise.
- Le bucket conserve tous les logos jamais téléversés (quelques Mio par organisation). Un
  nettoyage des logos qu'aucune facture ne désigne reste possible plus tard.
- Le PDF d'une facture avec logo dépend du stockage objet : stockage indisponible ⇒ 503
  (réessayable), jamais un PDF sans logo.
- Les PDF embarquent leurs polices (≈ 100 à 200 Kio de plus) ; rendu identique partout.
- Aucune dépendance nouvelle ; audit des dépendances inchangé.

## Plan de validation

- Unitaires (`invoice-templates.test.ts`) : pour **chaque modèle × chaque option** (palette ×
  police × trois accents dont un jaune clair) et chaque sorte de document (normalisée test et
  production, duplicata, pro forma brouillon et en cours, facture ordinaire, avoir, acompte à
  l'exportation, aperçu EXEMPLE, document de 30 lignes avec modifications, taxe spécifique,
  paiements multiples, commentaires et caractères à échapper) : toutes les mentions, QR exact,
  filigrane si test et seulement si test, CSP, aucune ressource distante, échappement,
  déterminisme ; le vérificateur refuse un modèle amputé ; la présentation d'origine passe le
  même vérificateur et reste inchangée octet pour octet.
- Polices : présence, licences, empreintes figées.
- Empreinte : `presentation` couverte, documents sans modèle inchangés.
- Rendu Chromium réel (si disponible) : un PDF par modèle (test, production noir et blanc,
  30 lignes) dans `apps/api/.vitest/pdf-samples/`, polices et logo intégrés, déterministe ;
  vignette PNG.
- E2E (`invoice-templates.e2e.test.ts`, faux serveur e-MCF, MinIO) : RBAC, SVG et faux type
  refusés, octets assainis servis, gel de la présentation, réimpression **identique** après
  changement de modèle, de logo, de couleurs et de police, duplicata figé, révocation des URL,
  isolation entre organisations, aperçu EXEMPLE (PDF et PNG), intégrité du logo (409),
  retour à la présentation d'origine.

## Décisions ouvertes — elles appartiennent à la décideuse

1. **« Total HT »** des maquettes : l'imprimer exige que le moteur le fournisse (somme des
   bases par groupe) ; à décider, puis ajouter au moteur (nouvelle version des modèles).
   — **Tranché le 21 oct. 2026** : imprimé à partir des versions 1.1.0 (amendement plus bas).
2. **Activation** : aucune organisation n'a de modèle choisi aujourd'hui (présentation
   d'origine). Faut-il basculer les organisations sur « Classique » par défaut ?
3. **Logo indisponible** au retéléchargement d'un original : refus (retenu) ou impression
   sans logo marquée comme telle ?
4. **Conservation des logos** : jamais supprimés (retenu) ; durée minimale à aligner sur la
   conservation des factures.
5. **SVG** : à rouvrir seulement avec un assainisseur SVG dédié et audité.
6. Ancien champ « Logo (URL) » des paramètres : à retirer au profit de l'identité visuelle.

## Amendement du 21 oct. 2026 — « Total HT » (décision ouverte n° 1)

- **Moteur** : `invoiceHtTotal(groups)` (`packages/engine/src/invoice-totals/compute.ts`,
  exportée par `@lalanda/engine`) rend la **somme des bases HT par groupe**
  (`GroupTotals.ht`, taxe spécifique comprise), au centime, sans arrondi propre : chaque base
  est déjà arrondie par la politique du calcul. **Aucune règle d'arrondi ne change** ;
  `INVOICE_TOTALS_VERSION` reste `1.1.0`. C'est une fonction pure et non un champ de
  `InvoiceTotals` : le calcul figé des factures déjà gelées (et leur `contentSha256`) ne
  change pas, et ces factures obtiennent le même Total HT que les nouvelles. Propriété
  vérifiée sur tous les cas de référence : Total HT + TVA = total.
- **Modèle d'impression** : `InvoiceDocumentModel.htTotal` (mis en forme comme les autres
  montants). Ce n'est **pas** une mention DGI : le vérificateur de la zone DGI
  (`dgi-content.ts`) ne l'exige pas, sinon les versions 1.0.0 ne passeraient plus.
- **Six modèles en version 1.1.0** (Classique, Bandeau, Latérale, Minimal, Compacte,
  Éditoriale) : une ligne « Total HT » en tête du bloc des totaux, avant la taxe spécifique
  et la TVA, dans le style de ce bloc. C'est la **seule** différence avec 1.0.0 (test : le
  HTML 1.1.0 privé de cette ligne et de son numéro de version est identique au HTML 1.0.0).
  Le choix d'une organisation pointe 1.1.0 ; les versions 1.0.0 restent publiées
  (`registry.ts`) et **réimpriment octet pour octet** les factures gelées avec elles
  (empreintes SHA-256 du rendu 1.0.0, relevées avant le changement, figées dans
  `invoice-templates.test.ts`).
- **Présentation d'origine** (organisations sans modèle choisi, gabarit 1.0.0) : inchangée,
  pas de Total HT.
- Maquettes `*.dc.html` : non présentes dans le dépôt ; position retenue « Total HT, TVA,
  Total TTC », ordre usuel, à faire valider visuellement par la décideuse.

## Amendement du 21 oct. 2026 — présentation exposée dans la vue facture

- `InvoiceView.presentation` (`InvoicePresentationView`, ajout au contrat) : `null` pour un
  brouillon (la présentation se fige au gel) ; `{ kind: 'original', … }` pour un document
  gelé sans modèle choisi (ou avant le 21 oct. 2026) ; `{ kind: 'template', templateId,
  templateLabel, version, options }` sinon — le modèle et la **version** qui impriment
  l'original et les duplicatas. Le nom affiché vient de `INVOICE_TEMPLATE_LABELS`
  (`template.contract.ts`, égal au `label` de chaque modèle, vérifié par test) : la vue ne
  charge pas le rendu des modèles.
- Fiche facture web : ligne « Présentation d'impression » (« Modèle Bandeau — version
  1.1.0 », « · noir et blanc » le cas échéant, ou « Présentation d'origine »).

## Liens

- [ADR-0007](ADR-0007-generation-pdf-excel.md), [ADR-0012](ADR-0012-modele-rbac-complet.md),
  [ADR-0023](ADR-0023-factures-et-avoirs.md), [ADR-0024](ADR-0024-normalisation-dgi.md),
  [ADR-0025](ADR-0025-documents-pdf-factures.md), [ADR-0026](ADR-0026-campagne-homologation.md)
- docs/17 (téléversements, journalisation), docs/24 (stockage objet), docs/19 (feuille de
  route : modèles personnalisés et place de marché)
- Code : `apps/api/src/sales/documents/templates/`, `apps/api/src/branding/`,
  `apps/api/assets/fonts/`
