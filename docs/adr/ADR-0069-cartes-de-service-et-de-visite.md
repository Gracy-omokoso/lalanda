# ADR-0069 — Cartes de service (badge vérifiable) et cartes de visite

Statut : **Accepted**
Date : 2026-11-07
Décideuse : Gracy Omokoso (demande et décisions du 7 nov. 2026).

> Prolonge [ADR-0045](ADR-0045-ressources-humaines.md) (dossier collaborateur), réutilise
> l'identité visuelle d'[ADR-0028](ADR-0028-modeles-de-facture-et-identite.md), le moteur de
> gabarits non fiables d'[ADR-0029](ADR-0029-modeles-de-facture-sur-mesure.md) et le rendu
> Chromium confiné d'[ADR-0025](ADR-0025-documents-pdf-factures.md) (S22e). Ne change aucune
> règle de facture, de paie ni de donnée sensible.

## Contexte

Les organisations clientes (RDC d'abord) impriment des **cartes de service** pour leurs agents :
contrôle d'accès à un site, présentation à un client, à une administration ou à un poste de
contrôle. Une carte imprimée se falsifie facilement ; une carte perdue continue de « parler »
pour quelqu'un qui a quitté l'organisation. La dirigeante demande :

1. une **carte de service** au format bancaire, avec un **QR de vérification** qui renvoie à une
   page publique de Lalanda disant si la personne est **toujours en fonction** ;
2. une **carte de visite** recto verso tirée de la fiche et de l'identité visuelle ;
3. **vingt modèles** Lalanda par défaut, aux couleurs de l'organisation ;
4. deux portes **sur mesure** : un paquet code (développeur ou IA), un gabarit de graphiste
   (Illustrator / Photoshop) avec zones nommées.

Contraintes héritées : ADR-0045 § 2.1 **exclut la photo** du dossier (minimisation) ; un gabarit
tiers est du **contenu non fiable** (ADR-0029) ; toute donnée est **isolée par organisation** ;
aucune donnée nominative n'est envoyée à l'IA.

## Options considérées

### O1 — Ce que le QR encode

| Option | Pour | Contre |
|---|---|---|
| Matricule ou identifiant de fiche | rien à stocker | **devinable** et énumérable ; non révocable ; une carte perdue reste valide |
| Jeton signé (HMAC) portant l'identifiant | sans stockage | révocation impossible sans liste noire ; fuite de structure |
| **Jeton aléatoire stocké, révocable** | ≥ 128 bits, sans structure ; réémettre = invalider l'ancienne carte ; révocation immédiate | une lecture en base par vérification (bornée par le débit) |

**Retenu : jeton aléatoire de 144 bits** (18 octets, 24 caractères base64url), stocké **en
clair** dans `hr_card_profiles.verification.token` (index unique). Il est imprimé sur la carte :
ce n'est pas un secret, c'est une **référence non devinable** ; il ne donne accès qu'à ce que la
page publique montre. Le stocker en clair permet de **réimprimer** la carte sans la réémettre.

URL encodée : `<CARD_VERIFY_BASE_URL>/v/<jeton>`, défaut `https://lalanda.co` (variable
d'environnement pour la préproduction).

### O2 — Où vit la photo

- Dans `hr_employees` : **écarté** (ADR-0045 § 2.1, et un autre lot modifie ce schéma).
- Dans `hr_employee_private` chiffré : écarté — la photo doit être **montrée** sur la carte et,
  avec consentement, sur la page publique ; la chiffrer imposerait un déchiffrement à chaque
  vérification anonyme pour un gain nul (elle est imprimée sur un support remis à des tiers).
- **Collection dédiée `hr_card_profiles`**, photo **facultative**, conditionnée à un
  **consentement daté avec son auteur**. **Retenu** : exception documentée à la minimisation.

### O3 — Moteur des modèles

Les vingt modèles sont du **code TypeScript du dépôt** (comme les six modèles de facture), rendus
par le **même Chromium confiné** (JavaScript coupé, réseau avorté, CSP `default-src 'none'`). Les
paquets sur mesure réutilisent **l'interprète Mustache strict, la politique HTML et la politique
CSS** d'ADR-0029 (aucun nouveau moteur, aucune dépendance nouvelle).

## Décision

### 1. Formats (constantes `hr/cards/card-formats.ts`)

| Format | Coupe | Fond perdu | Zone de sécurité | 300 dpi (coupe) | 300 dpi (avec fond perdu) |
|---|---|---|---|---|---|
| **Carte de service** — CR80, ISO/IEC 7810 ID-1 | 85,60 × 53,98 mm | 0 (impression bord à bord des imprimantes à cartes PVC) | 3 mm | 1011 × 638 px | — |
| **Carte de visite** | 85 × 55 mm | 3 mm par côté | 4 mm | 1004 × 650 px | 1075 × 720 px |

Orientation **horizontale** ou **verticale** (largeur et hauteur échangées). Recto obligatoire,
verso facultatif pour la carte de service, recto **et** verso pour la carte de visite.

Exports : **PDF vectoriel** (texte, filets, QR en SVG ; logos et photo restent des images), une
page par face, page = coupe + fond perdu ; **PNG 300 dpi** (`deviceScaleFactor` 3,125) d'une face ;
**planche A4** (cartes centrées, 2 × 5, traits de coupe hors carte) ; **archive ZIP de PNG** pour
un lot. Lot ≤ 100 collaborateurs par requête.

### 2. Données (`hr_card_profiles`, `hr_card_settings`, `hr_card_template_packages`)

`hr_card_profiles` — un document par `{ organizationId, employeeId }` (unique) :

| Champ | Règle |
|---|---|
| `photo` | `null` \| `{ objectId (128 bits), contentType, width, height, byteSize, sha256 }` ; octets **reconstruits** par la porte de la photo de profil (`validateAndSanitizeImage` : PNG/JPEG/WebP, ≤ 2 Mio, 32–4 096 px, métadonnées EXIF supprimées) ; clé `hr-card-photos/<objectId>` |
| `photoConsent` | `null` \| `{ given: true, at, by }` (auteur = l'utilisateur RH qui enregistre le consentement recueilli auprès de la personne). **Sans consentement, pas de téléversement** (`409 CARD_PHOTO_CONSENT_REQUIRED`). Retirer le consentement **efface** la photo (objet supprimé) |
| `photoPublic` | booléen, défaut `false` : la photo n'est montrée sur la page publique que si la personne y a consenti **en plus** (case distincte) |
| `verification` | `null` \| `{ token, serial, issuedAt, issuedBy }` ; `serial` croît à chaque émission |
| `revokedAt`, `revokedBy` | dernière révocation (traçabilité) |
| `revision` | concurrence optimiste (`409 STALE_CARD_REVISION`) |

**Émettre** (`issue`) tire un nouveau jeton et **remplace** l'ancien : une carte réémise (perte,
changement de poste) invalide la précédente. **Révoquer** met `verification` à `null`.

`hr_card_settings` — un document par organisation : modèle par défaut de chaque type
(`badge`, `business`), variante de couleur (`brand` \| `mono` \| `inverse`), accent facultatif,
`showEmployeeNumber` (défaut `true`), `badgeVerso` (défaut `true`), `vcardQr` (défaut `true`),
coordonnées imprimées de l'organisation (`address`, `website`, `phone`, `slogan`, chacune ≤ 160
caractères) — Lalanda n'a pas encore de fiche « coordonnées publiques » de l'organisation.

`hr_card_template_packages` — paquets sur mesure installés (§ 6), immuables, par organisation.

Isolation : chaque lecture filtre par `organizationId` ; le `employeeId` est vérifié appartenir
à l'organisation avant toute écriture ; un identifiant d'une autre organisation donne **404**.

### 3. Anonymisation et sortie

- **Sortie** (`status: exited` ou `endDate` passée) : la page publique affiche « N'est plus en
  fonction » ; rien n'est effacé (une carte retrouvée doit pouvoir être contrôlée).
- **Anonymisation** : `HrLifecycleHub` appelle aussi le point d'extension
  `HR_CARDS_LIFECYCLE` (même motif que `HR_DOCUMENTS_LIFECYCLE`) : photo **effacée** (objet
  supprimé), consentement et jeton **retirés**. Par ceinture : la page publique dit « Carte non
  valide » pour toute fiche anonymisée, même si l'effacement avait échoué.

### 4. Page publique de vérification

- Web : `/v/<jeton>` (hors coquille, sans session, `noindex, nofollow`, `Cache-Control: no-store`).
- API : `GET /public/cards/:token` et `GET /public/cards/:token/photo`, **sans session** (inscrites
  dans `SANS_PERMISSION`), débit borné **avant toute lecture** : 30 requêtes / minute par
  empreinte d'IP (HMAC, l'adresse n'est jamais conservée) et 60 / minute par jeton.
  Journalisation HTTP automatique coupée pour ce préfixe (le jeton n'entre pas dans les journaux).
- Réponse **valide** : `{ valid: true, displayName, jobTitle, organization: { name, logoUrl },
  status: 'active' | 'inactive', statusLabel, photoUrl | null, checkedAt }`. Statut dérivé par
  le moteur (`employeeStatusOf`, jour de Kinshasa) : `exited` ⇒ « N'est plus en fonction », sinon
  « En fonction ». Ni matricule, ni service, ni manager, ni coordonnées.
- **Jeton inconnu, mal formé, révoqué, remplacé, fiche anonymisée ou absente** : **la même
  réponse** `200 { valid: false }` (aucun oracle). La photo : **404 unique** dans tous les cas où
  elle n'est pas montrable.

### 5. Les vingt modèles Lalanda

Pour chaque type, **5 verticaux + 5 horizontaux**, chacun avec sa composition propre (bandeau,
colonne, diagonale, cadre, éditorial, plein fond, photo dominante…). Ils tirent **couleurs, logo
et police** de l'identité visuelle (`organization_brands`, même dérivation de contraste que les
factures : `inkSafe`, `readableOn`, `tint`). Personnalisation : modèle par défaut de chaque type,
variante (`brand`, `mono`, `inverse`), accent ; un autre modèle peut être choisi à l'export. Les
modèles sont **versionnés** (`id@version`) ; changer un rendu, c'est publier une nouvelle version.

Éléments **imposés par le moteur** sur toute carte de service (modèles intégrés et paquets) :
QR de vérification (≥ 15 mm de côté, zone de silence blanche de 4 modules) et la mention
« Vérifier : lalanda.co/v » ; sur un paquet, ils sont posés dans une **couche du moteur hors du
conteneur du gabarit** (§ 6), que son CSS ne peut atteindre ni recouvrir.

### 6. Gabarits sur mesure

**(1) Paquet code** (`format: "lalanda.modele-carte"`) — même archive ZIP, mêmes plafonds, même
lecteur, même empreinte canonique qu'ADR-0029 § 1 ; `gabarit.html` (Mustache strict) rendu une
fois par face (`{{#face.recto}}…{{/face.recto}}`, `{{#face.verso}}…{{/face.verso}}`) ; `style.css`
confiné (`.lx-modele`, `@scope`, liste blanche ; `position`, `z-index`, `transform`, `opacity`,
`display: none`… refusés). Contrat de données **version 1** (`hr/cards/custom/card-data-contract.ts`,
recopié dans le guide, un test vérifie la concordance). Le manifeste déclare `kind`
(`badge` \| `business`), `orientation`, `faces`, et la place du QR (`qr: { face, x, y, size }` en
mm, `size` ≥ 15 mm, entièrement dans la zone de sécurité) ; le moteur pose QR et mention au-dessus
du conteneur. Validation à l'installation : manifeste strict, gabarit contre le contrat, HTML, CSS,
batterie de rendu (badge actif, sans photo, noms longs, caractères à échapper, sans logo).

**(2) Gabarit graphiste** (`format: "lalanda.modele-carte-graphiste"`) — archive ZIP avec
`manifest.json` et les fonds `images/fond-recto.png` (et `images/fond-verso.png`) **aux dimensions exactes à
300 dpi au moins** (coupe + fond perdu pour la carte de visite ; rapport largeur/hauteur à 1 % près),
PNG ou JPEG, passés par la porte d'image. Le manifeste déclare des **zones nommées** en mm,
mesurées depuis le coin haut gauche de la **coupe** : `nom`, `prenom`, `nom-complet`, `poste`,
`service`, `matricule`, `photo`, `qr`, `logo`, `telephone`, `email`, `site`, `adresse`,
`organisation`, `slogan`, avec police intégrée, taille (≥ 6 pt), graisse, couleur opaque, alignement.
Lalanda superpose les données. La zone `qr` est **obligatoire** pour une carte de service.
**SVG à calques `zone-*` et PDF vectoriel : non livrés** dans cette version (refus explicite à la
validation ; décision ouverte n° 4).

Guides téléchargeables : `docs/cartes/guide-paquet-code.md` et `docs/cartes/guide-graphiste.md`,
recopiés dans `apps/web/public/guides/` (un test vérifie qu'ils sont identiques).

### 7. Contrat HTTP et permissions

**Aucune action nouvelle** : la lecture et l'export reprennent `hr.read`, toute écriture
`hr.manage` (photo, consentement, émission, révocation, réglages, paquets) — mêmes détenteurs que
la fiche collaborateur. Toutes les routes internes sous `/hr` portent `@RequireFeature('hr')`.

| Route | Permission |
|---|---|
| `GET /hr/cards/settings` · `PUT /hr/cards/settings` | `hr.read` · `hr.manage` |
| `GET /hr/cards/templates/:templateId/preview` (exemple fictif ; 120/h/utilisateur) | `hr.read` |
| `GET /hr/cards/packages` · `POST /hr/cards/packages` (ZIP, 20/h) | `hr.read` · `hr.manage` |
| `POST /hr/cards/batch` (lot ≤ 100 ; 30/h) | `hr.read` |
| `GET /hr/employees/:id/card` · `GET …/card/photo` | `hr.read` |
| `PUT …/card/consent` · `PUT …/card/photo` · `DELETE …/card/photo` | `hr.manage` |
| `POST …/card/issue` · `POST …/card/revoke` | `hr.manage` |
| `GET …/card/export?kind&format&face&template` (120/h/utilisateur) | `hr.read` |
| `GET /public/cards/:token` · `GET /public/cards/:token/photo` | **aucune** (jeton) |

Audit : `hr.card_photo_consent_recorded` / `_withdrawn`, `hr.card_photo_uploaded` / `_removed`,
`hr.card_issued` (serial), `hr.card_revoked`, `hr.card_settings_updated`,
`hr.card_template_package_installed`. Jamais le jeton dans le journal.

## Conséquences

- Une carte perdue se neutralise en un clic (révoquer ou réémettre) ; un agent sorti n'est plus
  « en fonction » sur la page publique sans action RH supplémentaire.
- La photo est une **exception documentée** à ADR-0045 § 2.1 : facultative, consentie, effacée au
  retrait du consentement et à l'anonymisation, jamais montrée publiquement sans second accord.
- Le QR expose l'existence de la personne dans l'organisation à qui tient la carte : c'est
  l'objet même d'une carte de service (le nom et le poste y sont déjà imprimés).
- Aucune dépendance nouvelle (QR : `qrcode`, déjà présent ; ZIP : lecteur et écrivain du dépôt).

## Plan de validation

- Unitaires : formats et conversions mm/px ; jeton (longueur, alphabet, entropie) ; statut dérivé ;
  vCard (échappement) ; vingt modèles (QR présent sur chaque badge, aucune donnée non échappée,
  ids uniques, compositions distinctes) ; paquet code (manifeste, QR trop petit ou hors zone,
  CSS hostile, variable inconnue) ; gabarit graphiste (dimensions, zones hors carte, zone `qr`
  manquante, SVG refusé) ; guides recopiés à l'identique.
- Rendu Chromium réel (si présent) : PDF et PNG 300 dpi d'aperçu des vingt modèles.
- E2E `hr-cards.e2e.test.ts` : RBAC (lecture `hr.read`, écriture `hr.manage`), consentement
  préalable à la photo, émission, export PDF/PNG, réémission qui invalide l'ancien jeton,
  révocation, sortie ⇒ « N'est plus en fonction », anonymisation ⇒ « Carte non valide » et photo
  effacée, jeton inconnu ⇒ réponse identique, photo publique seulement avec second accord,
  **isolation** entre organisations, lot et planche.

## Décisions ouvertes — elles appartiennent à la dirigeante

1. **Libre-service** : un collaborateur peut-il voir et télécharger sa propre carte (`/rh/moi`) ?
   Retenu pour l'instant : non (RH seulement).
2. **Date d'expiration** imprimée et contrôlée par la page publique (ex. 2 ans) : non retenue.
3. **Coordonnées publiques de l'organisation** (adresse, site) : saisies dans les réglages des
   cartes faute de fiche commune ; à fusionner quand l'organisation aura une fiche « contact ».
4. **Fonds vectoriels** des graphistes (SVG à calques `zone-*`, PDF) : à livrer après une analyse
   de sécurité du SVG (refusé partout ailleurs, ADR-0028 décision ouverte 5).
5. **Domaine** de vérification : `lalanda.co` en dur par défaut ; un domaine propre à
   l'organisation (`verifier.exemple.cd`) demanderait un certificat par client.

## Liens

- [ADR-0045](ADR-0045-ressources-humaines.md) § 2.1, § 2.4, § 3.1 ;
  [ADR-0028](ADR-0028-modeles-de-facture-et-identite.md) ; [ADR-0029](ADR-0029-modeles-de-facture-sur-mesure.md) ;
  [ADR-0025](ADR-0025-documents-pdf-factures.md) ; [ADR-0048](ADR-0048-formulaire-public-de-prospects.md)
  (page publique à jeton).
- Code : `apps/api/src/hr/cards/`, `apps/web/src/app/v/`, `apps/web/src/app/(app)/rh/cartes/`.
- Guides : `docs/cartes/`.
