# ADR-0072 — Documents RH générés : attestation de travail et certificat de travail

Statut : **Accepted**
Date : 2026-11-08
Décideuse : Gracy Omokoso (demande du 8 nov. 2026, manque RH n° 4 de
[docs/30](../30-COUVERTURE-RH-REFERENTIEL.md) § 3 ; autorisation de trancher selon ce qui
s'applique en RDC, chaque choix juridique étant marqué **« à revoir avec le juriste »**).

> Prolonge [ADR-0045](ADR-0045-ressources-humaines.md) (dossier collaborateur, § 2.4 données
> sensibles, § 2.8 documents RH, § 9 droit du travail), réutilise l'identité visuelle
> d'[ADR-0028](ADR-0028-modeles-de-facture-et-identite.md), le rendu Chromium confiné
> d'[ADR-0025](ADR-0025-documents-pdf-factures.md) (S22e) déjà partagé par
> [ADR-0069](ADR-0069-cartes-de-service-et-de-visite.md), et le motif des compteurs `hr_counters`
> (ADR-0051, ADR-0068). Ne change aucune règle de paie, de facture ni de donnée sensible.

## Contexte

Une PME congolaise délivre chaque semaine des **attestations de travail** (banque, ambassade,
bailleur, école des enfants) et, à chaque départ, un **certificat de travail**. Aujourd'hui, la RH
les tape dans un traitement de texte, sans numéro, sans trace, et les dépose (ou non) dans la fiche.
Les risques : une mention interdite (motif de licenciement, appréciation) dans un certificat, une
donnée sensible (salaire, adresse) imprimée sans besoin, une pièce falsifiée qu'on ne sait pas
rapprocher d'un original.

## Ce que dit le droit de la RDC (sources)

| Point | Texte | Certitude |
|---|---|---|
| Obligation de délivrer un certificat à la fin du contrat, « pour quelque cause que ce soit » | Loi n° 015/2002 du 16 oct. 2002 portant Code du travail, **art. 79** (titre IV, chap. VI, section II « Du certificat de fin de service ») | **Élevée** : texte lu dans le Journal officiel, n° spécial du 25 oct. 2002, copie de l'OIT (NATLEX) |
| Mentions : **nature et durée des services prestés**, **date du début et de la fin des prestations**, **numéro d'immatriculation à l'Institut National de Sécurité Sociale** | art. 79, al. 1 | **Élevée** (même source) |
| **« Aucune autre indication ne peut y être ajoutée. »** | art. 79, al. 1 | **Élevée** (même source) |
| Remise **au plus tard deux jours ouvrables** après la fin du contrat ; exempt de droit de timbre et d'enregistrement | art. 79, al. 2 | **Élevée** (même source) |
| Article 79 **non modifié** par la loi n° 16/010 du 15 juillet 2016 | exposé des motifs et art. 1er de la loi n° 16/010 (articles modifiés : 1er, 6, 7, 62, 119, 121, 125, 129, 190, 216 à 219, 241 et 321 ; ajouts 61 bis et 61 ter) | **Moyenne** : liste lue dans une reproduction (a-mla.org), pas dans le Journal officiel — **à confirmer par le juriste** |
| Infraction à l'art. 79 : amende (art. 321, a), appliquée autant de fois qu'il y a de travailleurs concernés (art. 328, b) | art. 321 et 328 du Code de 2002 | **Moyenne** : l'art. 321 est **modifié** par la loi n° 16/010 (montant et liste non relus) — **à confirmer par le juriste** |
| L'INSS est devenu la **CNSS** (le certificat porte donc le numéro d'immatriculation **CNSS**) | loi n° 16/009 du 15 juillet 2016 (régime général de sécurité sociale), mêmes textes que ceux cités par ADR-0070 | **Moyenne** — **à confirmer par le juriste** |
| Attestation de travail (salarié en poste) | **aucun texte trouvé** : pratique d'usage, contenu libre | **à confirmer par le juriste** |

Sources consultées le 8 nov. 2026 :
[Code du travail 2002, Journal officiel n° spécial du 25 oct. 2002 (copie OIT)](https://webapps.ilo.org/public/libdoc/nonigo/2002/RDC%20Code%20du%20travail.pdf) ;
[fiche NATLEX du Code du travail](https://natlex.ilo.org/dyn/natlex2/r/natlex/fe/details?p3_isn=62645) ;
[loi n° 16/010 du 15 juillet 2016 (reproduction a-mla.org)](https://a-mla.org/en/country/pdf/1002) ;
[fiche LEAP de la loi n° 16/010](https://leap.unep.org/en/countries/cd/national-legislation/loi-ndeg-16010-du-15-juillet-2016-modifiant-et-completant-la-loi).
Le droit français (« libre de tout engagement », art. L. 1234-19) **ne s'applique pas** et n'est pas
repris.

## Options considérées

### O1 — Où vit le PDF généré

| Option | Pour | Contre |
|---|---|---|
| Rendu à la volée, rien de stocké | simple | aucun original : une pièce falsifiée ne se rapproche de rien ; le contenu change si la fiche change |
| Collection propre avec son stockage | indépendance | double les règles de droits, de chiffrement, de conservation et d'anonymisation d'ADR-0045 § 2.8 |
| **Document RH de la fiche (`hr_documents`) + registre des pièces** | mêmes droits de lecture, même stockage, même chiffrement des pièces sensibles, même effacement ; le registre ne garde que le numéro et la forme | une catégorie de document de plus |

**Retenu : la troisième.** Le PDF passe par `HrDocumentsService.upload` (classement par contenu,
borne de 1 Gio commune, chiffrement côté application d'une pièce sensible, audit
`hr.document.uploaded`). Une nouvelle catégorie **`attestation`** (« Attestation / certificat »)
est ajoutée **en fin** de `HR_DOCUMENT_CATEGORIES` ; elle est **visible du collaborateur** par
défaut (le certificat lui appartient ; il le retrouve dans « Mon espace »).

### O2 — Personnalisation par l'organisation

- **Paquets de code (ADR-0029)** : écartés pour ce lot (voir « Hors périmètre »).
- **Texte libre en HTML** : écarté (injection dans le rendu, mise en page cassée).
- **Retenu** : deux textes **bornés, sans HTML** (`<`, `>` et caractères de contrôle refusés),
  **pour l'attestation seulement** — introduction (≤ 600) et formule finale (≤ 300) — avec des
  **champs nommés** remplacés par le moteur : `{nom}`, `{poste}`, `{date_entree}`,
  `{organisation}`. Un champ inconnu est refusé à l'enregistrement (`422`). Le **certificat n'a
  aucun texte personnalisable** : l'art. 79 interdit toute autre indication.

## Décision

### 1. Deux types de document

| Type | Pour qui | Contenu imprimé (exhaustif) |
|---|---|---|
| `attestation` — « Attestation de travail » ou « Attestation d'emploi » (titre choisi) | collaborateur **en poste** (`status: active`, date d'entrée passée) ; sinon `409 GENERATED_DOC_EMPLOYEE_NOT_ACTIVE` | en-tête de l'organisation ; titre ; introduction (réglage ou défaut : « Nous soussignés, {organisation}, attestons que {nom} fait partie de notre personnel depuis le {date_entree} et y occupe l'emploi de {poste}. ») ; **options cochées à la génération** : type de contrat (libellé de l'organisation), service, matricule, **adresse personnelle** ; formule finale (réglage ou défaut « La présente attestation est délivrée à l'intéressé(e) pour servir et valoir ce que de droit. ») ; lieu et date ; signataire (nom, qualité) ; numéro de pièce |
| `certificate` — « Certificat de travail » | collaborateur **sorti** ou dont la date de sortie est posée (`endDate`) ; sinon `409 GENERATED_DOC_NO_END_DATE` | en-tête de l'organisation ; titre ; « {nom} a été au service de {organisation} du {début} au {fin}. » ; **nature des services prestés** : emplois occupés (1 à 10 lignes `{ intitulé, du, au }`, pré-remplies avec le poste de la fiche et ses dates, modifiables) ; **durée des services** (années, mois, jours, calculée des deux dates) ; **numéro d'immatriculation CNSS** (saisi à la génération ; s'il est vide, la ligne indique « non communiqué » et l'écran prévient que le certificat est incomplet) ; lieu et date ; signataire ; numéro de pièce |

**Jamais**, sur aucun des deux, par construction (aucun champ du modèle ne les porte) : **motif de
sortie** (`exitCategory`, note de sortie), **appréciation du travail**, **salaire** (non proposé du
tout dans ce lot), coordonnées bancaires, pièce d'identité, date de naissance, nationalité, photo.
L'adresse personnelle n'est imprimée que sur **choix explicite** à la génération, pour une
attestation, par un détenteur de `hr.sensitive.read` ; sa lecture passe par la porte `reveal`
d'ADR-0045 § 2.4 (débit de 30/h, **audit strict** `hr.private.revealed` avant lecture) et la pièce
produite est alors **sensible** (chiffrée côté application, visible des seuls détenteurs de
`hr.sensitive.read` et du collaborateur).

**À revoir avec le juriste** : (a) que l'en-tête de l'employeur (raison sociale, adresse, RCCM,
id. nat., NIF), le numéro de pièce et la signature ne sont pas des « autres indications » au sens de
l'art. 79 (retenu : ils identifient l'employeur et la pièce, pas le travailleur) ; (b) que la
« durée » en années, mois et jours est la forme attendue ; (c) le titre « Certificat de travail »
(le Code dit « certificat de fin de service ») ; (d) le délai de deux jours ouvrables (rappelé à
l'écran, non contrôlé).

### 2. Numéro de pièce

`ATT-AAAA-NNNN` et `CT-AAAA-NNNN` (4 chiffres au moins, davantage au-delà de 9 999), compteur
**annuel au jour de Kinshasa** dans `hr_counters` (`kind: 'ATT' | 'CT'`, `year`), **`$inc`
seulement, jamais décrémenté ni réutilisé**. Le tirage est **hors transaction** : un échec après
tirage laisse un **trou**, jamais un doublon (motif ADR-0068). Index unique `{ organizationId,
number }` sur le registre. **Regénérer = nouvelle pièce** : nouveau numéro, nouveau document ;
l'ancien reste dans la fiche (sa suppression suit les règles des documents RH).

### 3. Registre `hr_generated_documents` et réglages `hr_generated_document_settings`

Registre — un document par pièce : `organizationId`, `employeeId`, `kind`, `number`, `year`,
`templateId` (`id@version`), `documentId` (le `hr_documents`), `issuedOn`, `place`,
`signatory { name, title }`, `options` (booléens : contrat, service, matricule, adresse), `sensitive`,
`createdBy`, `createdAt`. **Aucun nom de collaborateur, aucune adresse, aucun numéro CNSS** n'y est
copié : le contenu nominatif ne vit que dans le PDF (chiffré s'il est sensible).

Réglages — un document par organisation : `templateId` par défaut, `place` par défaut (≤ 80),
`signatory` par défaut (facultatif, nom et qualité ≤ 120 — pré-remplissage seulement), textes de
l'attestation (§ O2), `revision` (concurrence optimiste, `409 STALE_REVISION`).

### 4. Modèles et rendu

Trois mises en page **A4 sobres**, du code du dépôt, versionnées : `classique@1` (logo à gauche,
coordonnées à droite, filet de couleur), `bandeau@1` (bandeau plein à la couleur de marque, logo
clair), `marge@1` (colonne de couleur à gauche). En-tête et pied tirés de l'**identité visuelle**
(`organization_brands` : logo, couleurs, police ; contraste par `inkSafe`/`readableOn`) et de la
**fiche fiscale** (`organization_fiscal_profiles` : raison sociale, siège, téléphone, e-mail, RCCM,
id. nat., NIF — **chacun seulement s'il est renseigné** ; sans fiche fiscale, le nom de
l'organisation). Rendu par le **Chromium confiné partagé** (`PdfRenderingService` : JavaScript
coupé, réseau avorté, CSP `default-src 'none'`, images en `data:`), une page A4, date de
métadonnées figée à la date de la pièce. Tout texte est **échappé** ; aucun HTML d'origine
utilisateur n'entre dans le document.

**Aperçu** : même rendu, filigrane « APERÇU — sans valeur », numéro `…-AAAA-····`, **rien n'est
tiré, stocké ni audité** au-delà du débit (60/h/utilisateur).

### 5. Contrat HTTP et permissions

**Aucune action nouvelle.** Générer et prévisualiser exigent `hr.manage` (plus `hr.sensitive.read`
pour l'adresse personnelle) ; lire le registre et les réglages, `hr.read` ; la lecture et le
téléchargement **des PDF** sont ceux des documents RH (ADR-0045 § 2.8 : `hr.read` pour les non
sensibles, `hr.sensitive.read` pour les sensibles, le collaborateur pour les siens). Toutes les
routes portent `@RequireFeature('hr')`.

| Route | Permission |
|---|---|
| `GET /hr/generated-documents/settings` | `hr.read` |
| `PUT /hr/generated-documents/settings` | `hr.manage` |
| `GET /hr/employees/:employeeId/generated-documents` (registre) | `hr.read` |
| `POST /hr/employees/:employeeId/generated-documents/preview` (PDF, 60/h) | `hr.manage` |
| `POST /hr/employees/:employeeId/generated-documents` (30/h) | `hr.manage` |

Isolation : la fiche est relue avec `organizationId` ; une fiche d'une autre organisation ou
anonymisée donne `404 EMPLOYEE_NOT_FOUND`.

Audit : `hr.generated_document.created` (`employeeId`, `kind`, `number`, `templateId`,
`documentId`, options booléennes, `sensitive`) et `hr.generated_document_settings.updated` —
**jamais** un nom, une adresse, un texte ni un numéro CNSS. **Aucune donnée n'est envoyée à
l'IA.**

### 6. Anonymisation

Rien de nouveau : les PDF sont des documents RH. Une pièce **sensible** est effacée par
`eraseSensitive` (ADR-0045 § 3.1) ; les pièces non sensibles suivent la règle des documents RH (la
conservation reste une décision ouverte d'ADR-0045, n° 14). Le registre ne contient aucune donnée
nominative.

## Hors périmètre (dit explicitement)

- **Contrats de travail et avenants** générés depuis un modèle : lot suivant. Extension prévue : un
  type de plus dans `GENERATED_DOCUMENT_KINDS`, un préfixe de compteur (`CTR`, `AVT`), les
  catégories `contract` et `amendment` existantes, et des **clauses** paramétrées (durée, essai,
  rémunération) qui exigent un ADR propre (données sensibles, mentions obligatoires du contrat
  écrit à sourcer dans le Code du travail).
- **Paquets de code** (gabarits sur mesure d'ADR-0029) pour ces documents : non livrés ; les trois
  modèles Lalanda et les textes bornés suffisent au lot.
- Salaire sur une attestation (« attestation de salaire ») : non proposé.
- Signature électronique, cachet numérique, QR de vérification de la pièce : non livrés.
- Autres langues (anglais) : non livrées.
- Envoi par courriel au collaborateur : non livré (il retrouve la pièce dans « Mon espace »).

## Conséquences

- Collections nouvelles : `hr_generated_documents`, `hr_generated_document_settings` ; deux
  compteurs de plus dans `hr_counters` ; une catégorie de document de plus (`attestation`).
- Le certificat est conforme **par construction** à l'interdiction d'« autre indication » de
  l'art. 79 (sous réserve de l'avis du juriste, § 1).
- Aucune dépendance nouvelle.

## Plan de validation

- Unitaires : numéro (`ATT-2026-0001`, largeur au-delà de 9 999) ; durée en années, mois, jours ;
  textes personnalisés (champs inconnus, HTML refusés) ; rendu HTML des trois modèles (échappement,
  aucune mention de motif ni de salaire, mentions de l'art. 79 présentes, en-tête sans RCCM si
  absent) ; contrats partagés.
- E2E `hr-generated-documents.e2e.test.ts` : RBAC (`hr.manage` pour générer, `hr.read` pour le
  registre, Lecteur refusé) ; attestation rangée dans les documents de la fiche et téléchargeable ;
  numéros successifs, regénération = nouvelle pièce, l'ancienne reste ; certificat refusé sans date
  de sortie, accepté après la sortie, sans motif ; adresse personnelle refusée sans
  `hr.sensitive.read`, pièce sensible et chiffrée sinon ; aperçu sans tirage ; isolation entre
  organisations ; audit sans donnée nominative.

## Décisions ouvertes — elles appartiennent à la dirigeante (et au juriste)

1. Points (a) à (d) du § 1 : à revoir avec le juriste.
2. **Numéro CNSS** du collaborateur : aujourd'hui saisi à chaque certificat, faute de champ dans la
   fiche ; à ajouter au dossier (probablement aux données sensibles) dans un lot RH.
3. **Historique des emplois** : saisi à la génération, faute d'historique des postes dans la fiche.
4. **Délai de deux jours ouvrables** : rappel ou tâche automatique à la sortie (non livré).
5. Attestation pour un collaborateur **sorti** (« a fait partie de notre personnel ») : non
   proposée ; le certificat en tient lieu.

## Liens

- [ADR-0045](ADR-0045-ressources-humaines.md) § 2.4, § 2.8, § 3.1, § 9 ;
  [ADR-0028](ADR-0028-modeles-de-facture-et-identite.md) ; [ADR-0025](ADR-0025-documents-pdf-factures.md) ;
  [ADR-0069](ADR-0069-cartes-de-service-et-de-visite.md) ; [ADR-0068](ADR-0068-rh-invitation-matricules-postes.md) ;
  [docs/30](../30-COUVERTURE-RH-REFERENTIEL.md) (manque n° 4).
- Code : `apps/api/src/hr/generated-documents/`, `packages/shared/src/hr/generated-documents.ts`,
  `apps/web/src/app/(app)/rh/_components/documents-generes*.tsx`.
