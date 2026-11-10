# ADR-0073 — Identité visuelle v2 : un seul logo, favicon, motifs de fond

Statut : **Accepted**
Date : 2026-11-10
Décideuse : Gracy Omokoso (décisions du 10 nov. 2026, appliquées telles quelles) ; CTO
Lalanda (contrat technique).

> **Amende [ADR-0028](ADR-0028-modeles-de-facture-et-identite.md)** (identité visuelle, § 6
> présentation figée, § 7 identité, § 8 routes) : nouveaux champs **facultatifs** dans la
> présentation figée ; six modèles publiés en **1.2.0**, les versions 1.0.0 et 1.1.0 restent et
> réimpriment à l'identique. **Prolonge** [ADR-0029](ADR-0029-modeles-de-facture-sur-mesure.md)
> (paquets sur mesure : logo préféré, motif posé par le moteur),
> [ADR-0069](ADR-0069-cartes-de-service-et-de-visite.md) (cartes : modèles 1.1.0, favicon de la
> page `/v/[token]`) et [ADR-0072](ADR-0072-documents-rh-generes.md) (attestations et certificats :
> modèles version 2). Aucune mention légale ni aucun élément DGI ne change.

## Contexte

L'identité visuelle d'ADR-0028 a quatre déclinaisons de logo (`primary`, `horizontal`, `symbol`,
`light`). Chaque modèle choisissait la sienne dans un ordre figé propre (Classique : principal ;
Minimal : horizontal ; Compacte : symbole…) : une organisation ne savait pas quel logo sortirait
sur quel document. Le nom de marque était **toujours** écrit en gras à côté du logo, même quand le
logo le contient déjà. Pas de favicon d'organisation, pas de motif de fond.

La dirigeante a décidé le 10 nov. 2026 :

1. un **choix de logo unique** pour toute l'organisation, « Logo carré » ou « Logo horizontal »,
   affiché par tous les documents ; la version claire reste utilisée sur fond de couleur ;
2. une fois l'identité configurée (au moins un logo), **le nom de marque n'est plus écrit dans la
   zone du logo** ; sur les factures, devis et avoirs, la raison sociale reste **obligatoirement**
   dans le bloc d'identité légale, en texte normal ; avant toute configuration, rendu actuel ;
3. un **favicon** d'organisation pour les onglets (espace de l'organisation, pages publiques),
   repli sur celui de Lalanda ;
4. des **motifs de fond** (bibliothèque Lalanda d'au moins huit motifs, ou PNG transparent
   téléversé, intensité bornée, option « aucun motif ») sur factures, devis, avoirs, cartes et
   attestations ;
5. les **documents déjà émis restent inchangés**.

## Options considérées

### O1 — Correspondance « carré / horizontal » avec les quatre déclinaisons

- **A. Remplacer les quatre déclinaisons par deux emplacements.** Écarté : casse les identités
  enregistrées et les factures gelées, qui désignent leurs logos par déclinaison (ADR-0028 § 6).
- **B. Garder les quatre déclinaisons et ajouter un CHOIX qui fixe l'ordre.** Retenu.

| Choix | Ordre d'impression (le premier présent s'imprime) | Fond de couleur |
|---|---|---|
| **Logo carré** (`square`) | `primary` → `symbol` → (repli) `horizontal` | `light` d'abord, sinon le logo choisi sur une pastille blanche |
| **Logo horizontal** (`horizontal`) | `horizontal` → (repli) `primary` → `symbol` | idem |

**Migration douce** : aucun document n'est réécrit. Le champ `organization_brands.logoChoice` vaut
`null` pour toutes les identités d'avant ; le choix **effectif** est alors **déduit** de ce qui est
téléversé : « horizontal » si c'est la seule forme présente (ni principal ni symbole), sinon
« carré » — l'ordre qu'utilisaient la plupart des modèles. L'écran affiche « Choisi par défaut »
tant que l'organisation n'a pas tranché. Code : `packages/shared/src/branding/index.ts`
(`logoOrderFor`, `deducedLogoChoice`, `effectiveLogoChoice`), partagé par l'API et le web.

### O2 — Documents déjà émis

- **A. Lire le choix et le motif courants au rendu.** Écarté : une facture gelée changerait d'aspect
  (ADR-0025 § O2, ADR-0028 § 4).
- **B. Figer au gel, dans la présentation déjà figée, des champs FACULTATIFS ; publier une nouvelle
  version des modèles.** Retenu :
  - `presentation.identity.logoChoice` (choix **résolu**) et `presentation.pattern`
    (`{ source: 'library', id, color, intensity }` ou `{ source: 'upload', image: { assetId,
    sha256, … }, intensity }`) ; absents de toutes les présentations gelées avant ce jour ⇒ rendu
    d'avant ; ils entrent dans `contentSha256` comme le reste de `presentation` ;
  - les six modèles intégrés sont publiés en **1.2.0** ; **1.0.0 et 1.1.0 ne changent pas d'un
    octet** (empreintes SHA-256 du rendu 1.1.0 relevées le 10 nov. 2026 **avant** la modification,
    figées dans `invoice-templates.test.ts`, à côté de celles de 1.0.0) ;
  - le **moteur** ne pose la couche de motif que si la présentation porte un motif : sans motif, le
    HTML est celui d'avant octet pour octet.

### O3 — Motifs : format de la bibliothèque

- **PNG générés et versés au dépôt** : écarté (binaires à maintenir, couleur figée).
- **SVG constants écrits dans le code, paramétrés par UNE couleur `#rrggbb` vérifiée** : retenu.
  Ce ne sont pas des SVG téléversés (toujours refusés, ADR-0028 O3) : chaque tuile est une chaîne
  du dépôt, sans script, lien ni `url()` (test), encodée en `data:image/svg+xml,…` en pourcentage
  (ni guillemet ni parenthèse : l'URI ne peut pas sortir de `url("…")`). Onze motifs : Points,
  Diagonales, Quadrillage, Losanges, Vagues, Nid d'abeille, Chevrons, Anneaux, Croix, Triangles,
  Tissage. Couleur : l'accent du document (noir en palette « noir et blanc »).

### O4 — Transparence d'un motif téléversé

- **Type de couleur déclaré seulement** (RVBA) : insuffisant, un PNG RVBA peut être entièrement
  opaque.
- **`sharp` / libvips** : écarté (binaire natif sur des octets choisis par un tiers, docs/17 et
  `account/image-validation.ts`).
- **Décompression `node:zlib` bornée et défiltrage des lignes** (`branding/png-alpha.ts`) :
  retenu. Sortie bornée **avant** allocation par les dimensions déjà contrôlées ; aucune
  dépendance. PNG RVBA ou gris + alpha, 8 bits, non entrelacé ; au moins **10 %** de pixels non
  opaques, sinon `422 PATTERN_NOT_TRANSPARENT`.

## Décision

### 1. Choix du logo

`PUT /organizations/current/brand/logo-choice` `{ logoChoice: 'square' | 'horizontal' | null,
expectedRevision }` (`null` : revenir au choix déduit). Appliqué par :

- **factures, devis, avoirs** (modèles 1.2.0, `parts.ts` `markPrefs`) ; les paquets **sur mesure**
  reçoivent dans `brand.logo` la déclinaison du choix **seulement si** la présentation figée porte
  `logoChoice` (sinon l'ordre d'origine : les factures sur mesure déjà gelées sont inchangées ;
  version du moteur sur mesure inchangée, contrat de données 1 inchangé) ;
- **cartes de service et de visite** (`hr-cards.service.ts`, paquets de cartes compris) ;
- **attestations et certificats** (`hr-generated-documents.service.ts`) ;
- **formulaires publics** (`lead-intake.service.ts`) et **page de vérification d'une carte**.

### 2. Nom de marque et zone du logo

Règle, par emplacement : **un logo s'imprime ⇒ le nom n'est pas écrit à côté** ; sinon (aucun logo
téléversé), initiales et nom comme avant.

- **Factures, devis, avoirs (1.2.0)** : la raison sociale (`seller.title`) reste imprimée, en
  **texte normal**, dans le bloc d'identité légale (avec RCCM, id. nat., NIF, adresse) ; seule la
  répétition en gras dans l'en-tête disparaît (Minimal, Éditoriale, Bandeau : l'en-tête ne porte
  plus le nom ; Classique, Latérale, Compacte : le nom reste en tête du bloc légal, sans graisse).
  Le vérificateur DGI (`dgi-content.ts`) passe pour chaque modèle × document, avec et sans logo,
  avec et sans motif (test). Aucune mention légale ni DGI n'est retirée.
- **Cartes (modèles 1.1.0)** : `logo()` n'imprimait déjà le nom qu'avec le monogramme ; les textes
  « organisation » posés à côté du logo (badge « Latéral », badge « Marge », carte « Éditoriale »
  recto et verso) disparaissent quand un logo s'imprime ; la carte de visite « Éditoriale » montre
  désormais le logo au verso au lieu du monogramme.
- **Attestations et certificats (version 2)** : le nom quitte l'en-tête quand un logo s'y imprime ;
  il reste au **pied**, avec les identifiants légaux (RCCM, id. nat., NIF) et le numéro de pièce.

### 3. Favicon

- Image téléversée `POST /organizations/current/brand/favicon` (corps binaire, 20/h/utilisateur),
  retrait `DELETE …/favicon`. **PNG carré**, 512 × 512 px conseillés (32 à 1 024), 512 Kio au plus ;
  même porte que les logos (`validateAndSanitizeImage` : contenu analysé, métadonnées retirées,
  octets reconstruits, SVG refusé), puis PNG et carré exigés.
- Servi par la route signée existante `GET /brand-assets/:token` (24 h, révoquée au remplacement ou
  au retrait — `readLinkedAsset` reconnaît désormais `favicon` et `patternImage`).
- **Espace de l'organisation** : `GET /organizations/current/favicon` → `{ url | null }`, pour
  **tout membre** (session et appartenance, sans permission métier — inscrite et justifiée dans
  `SANS_PERMISSION`) ; le web remplace l'`href` des balises d'icône (`lib/favicon.ts`).
- **Pages publiques** : `faviconUrl` (facultatif) dans la réponse de `/public/cards/:token` et de la
  configuration d'un formulaire public. Repli partout : `app/icon.png` de Lalanda.

### 4. Motifs de fond

- Réglage `PUT /organizations/current/brand/pattern` `{ source: 'none' | 'library' | 'upload',
  libraryId, intensity, expectedRevision }` ; image `POST|DELETE …/brand/pattern-image` (PNG
  transparent, 512 × 512 px conseillés, 64 à 2 048, 1 Mio au plus ; retirer l'image choisie
  repasse à « aucun motif »).
- **Intensité** = opacité, de **3 à 20 %** (8 % par défaut), bornée dans le schéma, dans le service
  et de nouveau au rendu (`patternDeclarations` plafonne à 0,20).
- **Où** : factures, devis, avoirs (modèles intégrés 1.2.0 **et** paquets sur mesure — le moteur
  pose la couche, le gabarit n'y a pas accès), cartes de service et de visite, attestations et
  certificats. Bons de commande : même moteur, même effet.
- **Comment** : une couche posée par le **moteur** sous tout le contenu (`z-index: -1`, répétée sur
  chaque page en `position: fixed` pour les A4 ; dans chaque face isolée pour les cartes). Tout bloc
  qui a son propre fond la masque. En 1.2.0, le **cadre DGI** (éléments de sécurité, QR) est sur
  **fond blanc** : aucun motif sous le QR ni sous les codes. Le filigrane TEST/EXEMPLE reste
  au-dessus de tout.
- Taille de la tuile : SVG à sa taille ; PNG réduit de moitié sur A4 (512 px ⇒ 256 px CSS ≈ 68 mm)
  et au quart sur les cartes.
- Les documents non figés (cartes, attestations au moment de leur génération) lisent le motif
  courant ; une image de motif illisible est omise plutôt que de bloquer l'export.

### 5. Documents déjà émis

- **Factures, devis, avoirs gelés** : réimprimés avec leur présentation figée — même modèle et même
  version, mêmes logos (`assetId` + SHA-256), et **aucun motif** s'ils ont été gelés sans. Prouvé
  par les empreintes 1.0.0 / 1.1.0 et par un test de bout en bout (PDF identique octet pour octet
  après changement du choix et du motif). Un motif figé téléversé est relu et comparé à son
  SHA-256 comme un logo (`409 BRAND_ASSET_INTEGRITY` / `503 BRAND_ASSET_UNAVAILABLE`).
- **Attestations et certificats** : ce sont des PDF rangés dans les documents RH ; ils ne changent
  pas. Le registre porte désormais `…@2` pour les nouvelles pièces.
- **Cartes** : rendues à la demande (aucun original stocké) ; les modèles passent en 1.1.0.
- **Présentation d'origine** (organisations sans modèle de facture choisi) : inchangée, sans logo
  ni motif (voir décisions ouvertes).

### 6. Données

`organization_brands` : `logoChoice` (`null` par défaut), `favicon` (`assetId`), `patternImage`
(`assetId`), `pattern` (`{ source, libraryId, intensity }` ou `null`). `organization_brand_assets` :
`kind` (`logo` par défaut, `favicon`, `pattern`), même immuabilité. Aucune migration : valeurs
absentes = comportement d'avant.

### 7. Contrat HTTP et permissions

| Route | Permission |
|---|---|
| `PUT /organizations/current/brand/logo-choice` | `organization.manage` |
| `PUT /organizations/current/brand/pattern` | `organization.manage` |
| `POST`/`DELETE /organizations/current/brand/favicon` (20/h) | `organization.manage` |
| `POST`/`DELETE /organizations/current/brand/pattern-image` (20/h) | `organization.manage` |
| `GET /organizations/current/favicon` | membre (session, aucune action) |

`GET /organizations/current/brand` renvoie en plus `logoChoice`, `effectiveLogoChoice`, `favicon`,
`patternImage`, `pattern`, la bibliothèque et les bornes. Audit :
`organization.brand_logo_choice_updated`, `organization.brand_pattern_updated`,
`organization.brand_favicon_uploaded` / `_removed`, `organization.brand_pattern_uploaded` /
`_removed`. Isolation : toute lecture filtre par organisation (logos, favicon, motif, cache).
Routes déclarées en fin de `authz/routes-coverage.test.ts`.

### 8. Écran

« Organisation › Identité visuelle » refait : le logo des documents (deux cartes à choix avec
aperçu et repli signalé), les fichiers de logo, le favicon (aperçus 16, 32, 64 px), le motif
(galerie, votre motif, aucun motif, intensité, téléversement avec les indications : PNG transparent
obligatoire, dimensions, poids, opacité conseillée), couleurs et police, **aperçu réel** de la
première page d'une facture EXEMPLE (modèle choisi, sinon Classique) rafraîchi à chaque
enregistrement. Mêmes composants que le reste, responsive à 375 px, mode sombre par les variables
du thème.

## Conséquences

- Une organisation sait quel logo sort sur chaque document ; le nom n'est plus doublé.
- Aucune dépendance nouvelle (`node:zlib` est intégré à Node).
- Le bucket garde aussi les favicons et motifs remplacés (même règle que les logos).
- Les organisations qui avaient un modèle de facture et un logo verront, sur leurs **nouvelles**
  factures, le nom disparaître de l'en-tête (il reste au bloc légal) : c'est la décision n° 2.

## Plan de validation

- Unitaires : `packages/shared/src/branding/branding.test.ts` (choix, repli, déduction, motifs sans
  script, couleur vérifiée, intensité) ; `branding/png-alpha.test.ts` (cinq filtres PNG, opaque,
  sans alpha) ; `invoice-templates.test.ts` (empreintes 1.1.0, mentions DGI de chaque modèle 1.2.0
  × document × logo × motif, choix et repli, nom une seule fois, couche de motif, opacité bornée,
  URI refusée) ; `cards.test.ts` et `generated-documents.test.ts` (nom retiré avec un logo,
  couche de motif) ; `routes-coverage.test.ts`.
- E2E `brand-identity-v2.e2e.test.ts` : RBAC, validation, révision, favicon (SVG et non-carré
  refusés, servi, révoqué, isolé), motif (opaque refusé, transparent accepté), facture gelée avant
  les réglages identique octet pour octet, facture d'après (logo horizontal, motif figé, raison
  sociale au bloc légal, empreinte, duplicata), migration douce.

## Décisions ouvertes — elles appartiennent à la dirigeante

1. **Présentation d'origine** : une organisation qui a téléversé un logo mais n'a choisi aucun
   modèle de facture imprime toujours la présentation d'origine, **sans logo ni motif**
   (ADR-0028, décision ouverte n° 2). Basculer ces organisations sur « Classique » ?
2. **Domaine du favicon** : servi par l'URL signée de l'API (24 h) ; un onglet resté ouvert plus
   de 24 h retombe sur l'icône du navigateur jusqu'au rechargement.
3. **Motifs sur mesure en couleur** : un PNG téléversé garde ses couleurs (seule l'opacité est
   réglée) ; faut-il proposer une teinte automatique à l'accent ?
4. **Paquets sur mesure** : faut-il exposer au gabarit une variable « nom à afficher à côté du
   logo » (contrat de données 1, ajout) pour qu'un paquet suive aussi la règle n° 2 ?

## Liens

- [ADR-0025](ADR-0025-documents-pdf-factures.md), [ADR-0028](ADR-0028-modeles-de-facture-et-identite.md),
  [ADR-0029](ADR-0029-modeles-de-facture-sur-mesure.md),
  [ADR-0069](ADR-0069-cartes-de-service-et-de-visite.md),
  [ADR-0072](ADR-0072-documents-rh-generes.md) ; docs/17 (téléversements).
- Code : `packages/shared/src/branding/`, `apps/api/src/branding/`,
  `apps/api/src/sales/documents/templates/`, `apps/api/src/hr/cards/`,
  `apps/api/src/hr/generated-documents/`, `apps/web/src/app/(app)/organisation/_components/`,
  `apps/web/src/lib/favicon.ts`.
