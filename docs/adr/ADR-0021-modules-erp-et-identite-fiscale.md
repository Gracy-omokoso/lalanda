# ADR-0021 — Modules ERP activables, identité fiscale et fondations de la facture normalisée (lot S25b)

Statut : Proposed
Date : 2026-10-18
Décideurs : Gracy Omokoso (décisions produit du 18 oct. 2026) ; CTO Lalanda (contrat technique)

## Contexte

### Décisions de la décideuse (elles font foi)

1. Lalanda devient un **ERP modulaire**, sur le modèle de Dolibarr : chaque organisation
   **active** les modules qu'elle veut. Le premier est « Ventes et facturation ».
2. Dans la facturation, l'organisation **choisit** d'utiliser ou non la **facture
   normalisée DGI**. Si oui, elle saisit **son** identité fiscale et **ses** jetons e-MCF
   (un par point de vente). Le logiciel porte tout le nécessaire pour dialoguer avec la DGI.
3. L'**ISF** est l'identifiant attribué par la DGI au **logiciel homologué** (Lalanda,
   éditeur Go Freelance SARLU) : c'est un paramètre **plateforme**, pas un paramètre
   d'organisation (ADR-0019, révision du 18 oct.).
4. Une organisation qui a activé la facture normalisée **ne peut plus émettre de facture
   non normalisée**. La désactivation reste possible, mais elle est tracée, jamais
   silencieuse (pièce exigée par le dossier d'homologation).
5. Priorité : l'homologation. Environnement de test DGI `https://developper.dgirdc.cd/edef`,
   production `https://edef.dgirdc.cd`.

### Ce lot, et ce qu'il n'est pas

S25b pose les **fondations** : activation des modules, identité fiscale, interrupteur de
facture normalisée, points de vente e-MCF avec jeton chiffré, test de connexion à la DGI
et lecture de ses listes de référence. **Aucune facture n'est émise dans ce lot** : clients,
catalogue, devis et factures viennent ensuite (ADR-0018, lot 1) ; l'envoi et la
confirmation des factures auprès de la DGI forment le lot **S25f**, qui n'est pas spécifié
ici.

### Faits du dépôt vérifiés le 18 oct. 2026 (commit `7ad7e88`)

| Fait | Où |
|---|---|
| `integrations` porte `scope: 'platform' \| 'organization'` et `organizationId`, mais **toutes** les requêtes filtrent `scope: 'platform'` ; index unique `{ provider, scope, organizationId }` | `integrations/integration.schema.ts`, `integrations.service.ts:115-396`, `secrets.service.ts:107` |
| `INTEGRATION_PROVIDERS` sert à la fois d'enum du schéma, de liste affichée dans `/admin` et de liste journalisée au démarrage | `integrations/providers.ts`, `integrations.service.ts:117`, `secrets.service.ts:198-207` |
| Chiffrement AES-256-GCM ; dérivation HKDF liée à `provider:secretName` ; AAD `documentId\|provider\|secretName\|keyId` | `integrations/secrets-crypto.ts:221-238` |
| La rotation `secrets:rewrap` ne parcourt que `integrations` | `integrations/rewrap.ts` |
| La ré-authentification (fenêtre de 10 min liée à la session) n'est exposée que sous `admin/reauth`, réservée à `platform_super_admin` ; `ReauthService` n'est pas exporté du module | `integrations/integrations.controller.ts:144`, `integrations.module.ts:42` |
| Matrice RBAC : 15 actions, 8 rôles organisation, 6 rôles plateforme ; trois interdits plateforme absolus | `authz/permissions.ts` |
| Toute route doit déclarer une permission ou figurer, justifiée, dans `SANS_PERMISSION` ; la liste des contrôleurs est vérifiée contre les fichiers | `authz/routes-coverage.test.ts` |
| `audit_events` : `record()` non bloquant, `recordStrict()` bloquant, sans prise en charge de transaction | `authz/audit.service.ts` |
| `organization_settings` : préférences d'affichage seulement, une fiche par organisation | `organization-space/organization-settings.schema.ts` |
| Les onglets de `/organisation` sont filtrés par `GET /me/permissions`, une action par onglet | `apps/web/.../organisation/_components/organization-model.ts` |
| L'ordonnanceur et la création des index en production existent | `scheduler/`, `database/indexes.service.ts` (création seule, jamais de suppression) |
| `cd-2026.yaml` déclare `tva_taux_reduit: 0.08` ; **aucun des cinq modèles sectoriels** ne déclare de driver `tva_*` ; l'évaluateur ne résout que les drivers du modèle | `packages/engine/src/parameter-packs/cd-2026.yaml:43`, `packages/engine/src/templates/*.yaml`, `packages/engine/src/evaluator/index.ts:925-946` |
| L'empreinte d'un plan hache les drivers résolus et `packVersion` (= l'année) | `apps/api/src/plans/fingerprint.ts` |
| Les branches `feat/zeptomail` et `feat/emails-zeptomail` sont **entièrement fusionnées** (0 commit hors de `main`) : le module e-mail n'est PAS en cours de modification. `feat/mfa-plateforme` est un travail **abandonné le 9 août 2026** (7 commits WIP non fusionnés) : on ne l'attend pas | `git rev-list --count main..<branche>` (relecture du coordinateur, 18 oct. 2026) |

La documentation DGI du compte développeur n'est pas publique ; elle reste hors dépôt
(`dgi/`, jamais commité). Cet ADR n'en reprend que ce qui est nécessaire au contrat, en
substance. Les faits techniques de l'API viennent de la spécification publique
(`docs/sources/dgi-rdc/edef-api-v2.0-2026-10-18.json`).

## Options considérées

### O1 — Où ranger l'activation des modules

1. **Dans `organization_settings`.** Écarté : cette collection porte des préférences
   d'affichage que « aucun calcul ne consomme » ; un module conditionne des droits et des
   routes, il ne s'y mélange pas.
2. **Dans les droits d'abonnement (`billing/entitlements`).** Écarté pour ce lot : le prix
   des modules n'est pas décidé (décision ouverte n° 2). Une activation est un choix de
   l'organisation ; un droit d'abonnement, s'il vient, s'y ajoutera comme une condition.
3. **Collection dédiée `organization_modules`, un document par (organisation, module).**
   **Retenu.**

### O2 — Permission RBAC

1. **Tout sous `organization.manage`.** Retenu **pour les modules** : activer un module est
   un réglage de l'organisation, réversible, sans engagement fiscal. Propriétaire et
   Administrateur, comme les autres paramètres.
2. **Pour l'identité fiscale et la facture normalisée, `organization.manage` aussi.**
   Écarté : saisir le jeton qui certifie des factures au nom du contribuable et basculer
   son régime de facturation **engagent le contribuable devant la DGI**. ADR-0012 §3 a déjà
   tranché ce cas de figure : les actes financiers engageants (`plan.approve`,
   `period.close`) appartiennent à l'autorité financière (Propriétaire, Directeur
   financier), pas à l'administration technique.
3. **Nouvelle action `fiscal.manage`.** **Retenu** (§8).

### O3 — Stockage des jetons e-MCF

1. **`integrations` avec `scope: 'organization'`.** Écarté, pour trois raisons tirées du
   code :
   - l'index unique `{ provider, scope, organizationId }` n'admet **qu'un** document par
     organisation, alors qu'il faut un jeton par point de vente. Le changer impose de
     **supprimer** un index de production, ce que `IndexesService` ne fait jamais par
     construction : migration manuelle, risque d'exploitation ;
   - `INTEGRATION_PROVIDERS` alimente l'enum, la page `/admin` et le journal de démarrage :
     un fournisseur « organisation » y apparaîtrait comme un fournisseur plateforme
     fantôme, ou bien il faudrait scinder l'enum et revoir chaque requête. Le jour où un
     filtre `scope: 'platform'` serait oublié, des jetons clients entreraient dans le
     chemin plateforme ;
   - la liste blanche `config`, les `requiredSecrets` à noms fixes et le secours
     `envFallback` n'ont pas de sens pour un jeton d'organisation (jamais de secours par
     l'environnement).
2. **Jeton chiffré directement dans le document du point de vente (module fiscal).**
   Écarté : le module fiscal détiendrait la clé maîtresse et du code de déchiffrement hors
   de `integrations/`. ADR-0013 fait de la résolution un point de déchiffrement unique ;
   les barrières anti-fuite seraient à dupliquer.
3. **Collection `organization_secrets` dans `integrations/`, mêmes primitives
   cryptographiques, service distinct `OrganizationSecretsService`.** **Retenu** (§4).
   Le chemin plateforme (`SecretsService`) n'a aucun modèle pour cette collection : il est
   **physiquement** incapable de lire un secret d'organisation, et réciproquement.

### O4 — Paramètres plateforme DGI (ISF, URL)

1. **Page `/admin`.** Écarté : aucun de ces paramètres n'est secret ni ne change en
   exploitation courante. L'ISF est attribué à une **version homologuée** du logiciel ; le
   changer est un acte de livraison, pas un réglage.
2. **`integrations` portée plateforme.** Écarté : ce ne sont pas des secrets.
3. **Variables d'environnement validées au démarrage.** **Retenu** (§5) : l'ISF suit le
   code déployé, et ouvrir la production devient un acte de déploiement relu.

### O5 — Correction du pack TVA

1. **Nouveau pack `cd-2026-02`.** Écarté : il change la sélection par défaut des projets
   CD et répartit les projets sur deux packs, pour **aucune** différence de calcul.
2. **Version du pack dans `packVersion`.** Écarté : `packVersion` entre dans l'empreinte de
   chaque plan ; la changer modifierait l'empreinte de tous les plans CD, et le contrôle
   `PLAN_UNCHANGED` ne reconnaîtrait plus une ré-approbation identique — régression sur une
   règle bancaire (« un chiffre déjà montré à une banque ne doit jamais être re-figé sous
   un autre numéro »).
3. **Erratum en place, tracé par un champ `revisions`, autorisé seulement pour un
   paramètre qu'aucun modèle ne consomme, et verrouillé par un test.** **Retenu** (§7).

## Décision

### 1. Modules ERP activables par organisation (chantier A)

**Catalogue fermé, dans le code** (`apps/api/src/erp-modules/erp-modules.types.ts`) :

```ts
export const ERP_MODULES = ['sales'] as const;
export type ErpModuleKey = (typeof ERP_MODULES)[number];
```

Un seul module dans ce lot. « Dépenses et trésorerie » et « CRM » (ADR-0018) entreront
dans le catalogue **avec** le lot qui les livre : déclarer aujourd'hui un module sans
contenu serait annoncer une fonctionnalité absente.

**Collection `organization_modules`** — un document par (organisation, module) :

| Champ | Type | Règle |
|---|---|---|
| `organizationId` | string | requis |
| `module` | enum `ERP_MODULES` | requis |
| `enabled` | boolean | requis |
| `changedAt` | Date | dernière bascule |
| `changedBy` | string | identifiant utilisateur |
| `_schemaVersion` | number | `1` |
| `createdAt`, `updatedAt` | Date | horodatage Mongoose |

Index unique `{ organizationId: 1, module: 1 }`. **Aucun document = module désactivé.**
Rien n'est créé à la création d'une organisation : **tout est désactivé par défaut**.

**Dépendances entre modules et fonctions.** Le service expose un registre de **bloqueurs
de désactivation** : un autre module enregistre au démarrage une fonction qui, pour une
organisation, renvoie un motif de refus ou `null`. C'est le même patron que
`scheduler.register` : `erp-modules/` n'importe jamais `fiscal/`. Premier bloqueur (posé
par le chantier B) : « Ventes » ne se désactive pas tant que la facture normalisée est
activée.

**Effet sur la navigation web.** Dans ce lot, activer « Ventes » ne fait apparaître
**aucune** entrée de navigation : il n'existe encore aucune page de ventes. Son seul effet
visible est de rendre activable la section « Facture normalisée » de l'onglet Fiscalité.
L'entrée « Ventes » du menu (ADR-0016) arrivera avec les pages de ventes, conditionnée par
`modules[].enabled` **et** les permissions de vente que ce lot-là créera.

**Journal.** `erp_module.enabled` / `erp_module.disabled` par `AuditService.record`
(non bloquant : réglage réversible, sans portée fiscale). Une bascule vers l'état déjà en
place répond 200 sans écrire d'événement.

**Droits d'abonnement.** Aucun contrôle de forfait dans ce lot (décision ouverte n° 2).

### 2. Identité fiscale de l'organisation (chantier B)

**Collection `organization_fiscal_profiles`** — une fiche par organisation. Les champs
couvrent les mentions vendeur qu'une facture normalisée doit porter (dénomination, NIF,
adresse, téléphone, adresse e-mail), plus ce que la facture d'une société porte d'usage.

| Champ | Type | Validation | Mention couverte |
|---|---|---|---|
| `organizationId` | string | unique | — |
| `legalName` | string | requis, 1–200, espaces de bord retirés | dénomination |
| `tradeName` | string \| null | ≤ 200 | enseigne (facultatif) |
| `legalForm` | enum \| null | `entreprise_individuelle sarl sarlu sa sas sasu snc scs gie cooperative asbl etablissement_public autre` | forme juridique (facultatif) |
| `legalFormOther` | string \| null | ≤ 100, **requis si** `legalForm = 'autre'`, sinon `null` | — |
| `nif` | string | requis ; normalisé (majuscules, espaces et tirets retirés) ; `^[A-Z0-9]{5,20}$` | NIF |
| `rccm` | string \| null | ≤ 64, format libre | RCCM (facultatif) |
| `nationalId` | string \| null | ≤ 64, format libre | identification nationale (facultatif) |
| `vatRegistered` | boolean | requis | assujetti à la TVA |
| `headOffice.line1` | string | requis, ≤ 200 | adresse |
| `headOffice.line2` | string \| null | ≤ 200 | |
| `headOffice.commune` | string \| null | ≤ 100 | |
| `headOffice.city` | string | requis, ≤ 100 | |
| `headOffice.province` | string \| null | ≤ 100 | |
| `headOffice.country` | string | ISO-2 ; vaut par défaut le pays de l'organisation | |
| `phone` | string | requis, `^\+?[0-9][0-9 .-]{6,19}$` | téléphone |
| `email` | string | requis, adresse e-mail, ≤ 254 | e-mail |
| `updatedBy`, `createdAt`, `updatedAt`, `_schemaVersion: 1` | | | |

Trois précisions :

- **Le contrôle du NIF est volontairement souple.** Le format exact n'est pas publié dans
  une source que nous pouvons citer. La seule validation qui fait foi est la
  **concordance** avec le NIF que la DGI renvoie lors du test d'un jeton (§4). On
  n'invente pas de règle de format.
- **L'adresse du lieu de vente n'est pas celle du siège.** Elle appartient au point de
  vente : la DGI la renvoie pour chaque e-MCF (`emcfList[].address1..3`) et c'est elle que
  la facture imprimera (lot ultérieur). `headOffice` est le siège.
- **RCCM, forme juridique, identification nationale** sont facultatifs : aucune source
  disponible ne les rend obligatoires sur la facture normalisée. Leur présence sur les
  factures de société relève du droit OHADA, à confirmer par un juriste — non sourcé ici,
  donc non imposé.

**Verrou.** Tant que la facture normalisée est **activée**, le NIF ne se modifie pas
(`409 FISCAL_IDENTITY_LOCKED`). Les autres champs restent modifiables. Désactivée, la
modification du NIF est permise ; les points de vente dont le NIF DGI ne correspond plus
passent à l'état `nif_mismatch` et doivent être re-testés.

**Écriture complète seulement** (`PUT`, schéma Zod `.strict()`) : une fiche enregistrée
est donc toujours complète. Journal : `fiscal_profile.updated`, par `record`, avec la
liste des **noms** de champs modifiés, jamais leurs valeurs.

### 3. Facture normalisée par organisation (chantier B)

**Collection `normalized_invoicing_settings`** — une fiche par organisation :

| Champ | Type | Règle |
|---|---|---|
| `organizationId` | string | unique |
| `state` | `'disabled' \| 'enabled'` | défaut `disabled` |
| `environment` | `'test' \| 'production'` | défaut `test` |
| `firstActivatedAt` | Date \| null | posé à la première activation, **jamais remis à `null`** |
| `activatedAt`, `activatedBy` | Date, string \| null | dernière activation |
| `deactivatedAt`, `deactivatedBy`, `deactivationReason` | Date, string, string \| null | dernière désactivation |
| `_schemaVersion` | number | `1` |

Aucun document = désactivé, environnement de test.

**Règles.**

- **R1 — Prérequis d'activation**, tous vérifiés côté serveur, sinon
  `409 NORMALIZED_INVOICING_PREREQUISITES` avec la liste `missing` :
  `sales_module` (module Ventes activé), `fiscal_profile` (fiche enregistrée),
  `country_cd` (siège en RDC), `active_point_of_sale` (au moins un point de vente à l'état
  `active` dans l'environnement visé), `production_unavailable` (si l'environnement visé
  est la production et qu'elle n'est pas ouverte, §5), `nif_elsewhere` (une autre
  organisation a déjà activé la facture normalisée avec le même NIF dans le même
  environnement — message générique, sans nommer l'autre organisation ; décision ouverte
  n° 4).
- **R2 — Pendant l'activation** :
  - toute émission de facture des lots suivants passe par
    `NormalizedInvoicingService.emissionModeOf(organizationId)`, qui renvoie
    `'normalized'` si et seulement si `state = 'enabled'`. Ce lot livre la fonction et son
    test ; il n'a aucun appelant ;
  - le NIF est verrouillé (§2) ;
  - le module Ventes ne se désactive pas (bloqueur §1, code
    `NORMALIZED_INVOICING_ENABLED`) ;
  - le dernier point de vente `active` de l'environnement courant ne se retire pas
    (`409 LAST_ACTIVE_POINT_OF_SALE`).
- **R3 — Désactivation : possible, jamais silencieuse.** Elle exige une
  ré-authentification récente (§8), un **motif** de 20 à 500 caractères, et s'écrit dans
  **une transaction MongoDB** avec son événement d'audit **strict** : pas de désactivation
  sans trace. `firstActivatedAt` reste en place ; l'onglet Fiscalité affiche en permanence
  « Facture normalisée désactivée le … — motif : … » à toute personne détenant
  `fiscal.manage`, et le journal de l'organisation garde l'événement.
- **R4 — Aucune bascule automatique.** Aucun code ne désactive la facture normalisée en
  dehors de la route de désactivation : ni l'expiration d'un jeton, ni une panne DGI, ni la
  désactivation d'un point de vente. Un jeton expiré **bloquera l'émission** (lot S25f), il
  ne fera jamais repasser l'organisation en facturation ordinaire. Un test vérifie que
  `NormalizedInvoicingService` est le seul écrivain de la collection.
- **R5 — Environnement.**
  - Passage `test → production` : ré-authentification, production ouverte (§5), au moins un
    point de vente `active` en production ; audit strict
    `normalized_invoicing.environment_changed`.
  - Passage `production → test` **pendant l'activation** : traité comme une
    désactivation (motif obligatoire, audit strict), puisque les factures suivantes
    n'auraient plus de valeur fiscale.
  - Facture normalisée désactivée : changement libre, audit `record`.
- **R6 — Concurrence.** Chaque transition est un `findOneAndUpdate` conditionné par l'état
  précédent. Deux activations simultanées produisent un seul événement. Une demande vers
  l'état déjà en place répond 200 sans événement.

Rappel de portée : tant que Lalanda n'est pas homologué, la production reste fermée et
l'interface affiche « Mode test » partout où l'environnement apparaît (ADR-0019).

### 4. Points de vente e-MCF et coffre de portée organisation

#### 4.1 Points de vente (chantier B)

Le jeton e-MCF est lié à **un** e-MCF (un point de vente), pas au contribuable. Une
organisation à deux points de vente a donc deux jetons.

**Collection `emcf_points_of_sale`** :

| Champ | Type | Règle |
|---|---|---|
| `organizationId` | string | requis |
| `environment` | `'test' \| 'production'` | fixé à la création |
| `label` | string | 1–80, nom donné par l'organisation |
| `expectedNim` | string \| null | ≤ 32 ; si renseigné, le test exige que le NIM renvoyé par la DGI soit identique |
| `enabled` | boolean | `true` à la création |
| `dgi` | objet \| null | dernier relevé DGI validé : `nif`, `nim`, `tokenValidUntil` (Date), `emcfStatus`, `shopName`, `address` (string[]), `contacts` (string[]), `apiVersion`, `checkedAt` |
| `lastTest` | objet \| null | `{ at, ok, code, message }` — `message` assaini |
| `createdBy`, `updatedBy`, `createdAt`, `updatedAt`, `_schemaVersion: 1` | | |

Index `{ organizationId: 1, environment: 1 }` ; index unique `{ environment: 1, 'dgi.nim': 1 }`
partiel (`'dgi.nim'` de type chaîne) : un e-MCF n'appartient qu'à **une** organisation
Lalanda (`409 EMCF_ALREADY_REGISTERED`, message générique).

**Pas de suppression.** Retirer un point de vente le désactive (`enabled: false`) et
**détruit son jeton** ; le document reste, parce que les factures des lots suivants le
référenceront. Le réactiver, c'est lui fournir un nouveau jeton.

**État calculé** à la lecture, dans cet ordre : `disabled` (`enabled = false`) ·
`token_missing` (aucun jeton au coffre) · `nif_mismatch` (`dgi.nif` ≠ NIF de la fiche) ·
`token_expired` (`dgi.tokenValidUntil` dépassé) · `failing` (dernier test en échec) ·
`active`.

**Saisie ou remplacement d'un jeton : test avant écriture** (ADR-0013 §5). Le jeton soumis
sert à un appel `GET /api/info/status` dans l'environnement du point de vente, **avant**
toute écriture. Il n'est enregistré que si : la DGI répond (sinon `502 EDEF_UNREACHABLE`),
accepte le jeton (sinon `422 EMCF_TOKEN_REJECTED`), renvoie `status = true`
(`422 EMCF_STATUS_FALSE`), un `nif` égal au NIF de la fiche (`422 EMCF_NIF_MISMATCH`), un
`nim` égal à `expectedNim` s'il est renseigné (`422 EMCF_NIM_MISMATCH`), un `tokenValid`
futur (`422 EMCF_TOKEN_EXPIRED`), et si l'e-MCF correspondant de `emcfList` n'est pas
désactivé (`422 EMCF_DISABLED_AT_DGI`). En cas d'échec : **rien n'est écrit**, ni document,
ni secret. Pas de dérogation `force` : contrairement au SMTP derrière un pare-feu, un jeton
non vérifié ne peut rien servir.

En cas de succès, **une transaction** écrit le document du point de vente, le secret
(§4.2) et l'événement d'audit strict. Le jeton n'apparaît ensuite **nulle part** en clair :
ni réponse, ni journal, ni message d'erreur, ni `edef_exchanges` — seulement `last4` (les
4 derniers caractères, `null` sous 12 caractères, règle ADR-0013 §4).

Format accepté pour un jeton : 20 à 4 096 caractères, `^[A-Za-z0-9._-]+$`. Il n'est ni
décodé ni interprété.

#### 4.2 Coffre de portée organisation (chantier A)

**Collection `organization_secrets`**, dans `apps/api/src/integrations/` :

| Champ | Type | Règle |
|---|---|---|
| `organizationId` | string | requis |
| `kind` | enum `ORGANIZATION_SECRET_KINDS` = `['dgi_emcf_token']` | requis |
| `ownerId` | string | identifiant de l'objet propriétaire (ici, le point de vente) |
| `value` | `EncryptedValue` | même sous-document qu'ADR-0013 §1 |
| `createdAt`, `updatedAt`, `_schemaVersion: 1` | | |

Index unique `{ organizationId: 1, kind: 1, ownerId: 1 }`.

**Emplacement cryptographique** — `secrets-crypto.ts` n'est **pas** modifié ; on lui passe :

```ts
const location: SecretLocation = {
  documentId: String(doc._id),                       // _id du document organization_secrets
  provider: `org:${kind}`,                           // espace de noms distinct des fournisseurs plateforme
  secretName: `${organizationId}:${ownerId}:value`,
};
```

Effet : la dérivation HKDF et l'AAD lient le chiffré **au document, à l'organisation, au
point de vente et au `keyId`**. Un chiffré recopié vers une autre organisation, un autre
point de vente ou un autre document — ou un document dont on réécrit `organizationId` en
base — ne se déchiffre plus. Le préfixe `org:` rend toute collision avec un fournisseur
plateforme (`openai`, `smtp`…) impossible.

**Règles.**

- **Jamais de secours par l'environnement**, à aucun moment (logique d'ADR-0017 : un
  secret d'organisation n'a pas d'amorçage).
- **Coffre absent** (`SECRETS_MASTER_KEY` non définie) : `VaultUnavailableError`, traduite
  en `503 VAULT_UNAVAILABLE`. Secret indéchiffrable : l'erreur remonte (ADR-0013 §3, panne
  bruyante).
- **Pas de cache** : le déchiffrement coûte quelques microsecondes, et une révocation doit
  valoir immédiatement.
- **Mêmes barrières anti-fuite** qu'ADR-0013 §4 : `toJSON` et `toObject` amputent `value` ;
  le service ne renvoie jamais qu'une description (`configured`, `last4`, `updatedAt`,
  `updatedBy`) ou un `Secret` dont la sérialisation donne `[redacted]`.
- **Rotation** : `RewrapService` parcourt aussi `organization_secrets` (même procédure,
  même idempotence, un `secret.rewrapped` par enregistrement).
- **`/admin` ne voit rien** : aucune route plateforme ne lit cette collection, et
  `fiscal.manage` est interdite aux rôles plateforme (§8).
- `SecretsService.resolve` (portée plateforme) **reste inchangé**. Un service distinct,
  plutôt qu'une méthode `resolveForOrganization` sur la même classe, rend impossible
  d'appeler l'un pour l'autre : la signature exige une organisation.

### 5. Paramètres plateforme DGI (chantier A)

Dans `packages/shared/src/env/index.ts`, schéma de l'API :

| Variable | Défaut | Validation |
|---|---|---|
| `DGI_EDEF_TEST_URL` | `https://developper.dgirdc.cd/edef` | URL https |
| `DGI_EDEF_PRODUCTION_URL` | `https://edef.dgirdc.cd` | URL https |
| `DGI_ISF_TEST` | absent | 1–32 caractères ; format libre en test |
| `DGI_ISF_PRODUCTION` | absent | `^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{2}$` (10 caractères) |
| `DGI_PRODUCTION_ENABLED` | `false` | seule la chaîne `"true"` active ; **refus de démarrer** si `true` sans `DGI_ISF_PRODUCTION` |
| `DGI_HTTP_TIMEOUT_MS` | `15000` | entier, 10 000 à 60 000 (la DGI recommande d'attendre au moins 10 s) |

En développement et en test automatisé, les URL pointent vers le faux serveur (§6). Exposé
au reste de l'API par le fournisseur `DGI_PLATFORM_CONFIG` (§11). Aucune de ces valeurs
n'est un secret ; l'ISF n'est pas encore utilisé dans ce lot (il part avec chaque facture,
S25f) mais il est validé dès maintenant pour que la production ne puisse pas s'ouvrir sans
lui.

### 6. Client e-MCF minimal (chantier B)

Module `apps/api/src/edef/`. **Seulement** : `GET /api/info/status` et les sept listes
`GET /api/info/{taxGroups, invoiceTypes, paymentTypes, clientTypes, referenceTypes,
itemTypes, currencyRates}`. Aucun appel à `/api/invoice` dans ce lot.

**Signatures** (contrat ; les noms de champs DGI sont ceux de la spécification publique) :

```ts
export type EdefReferenceList =
  | 'taxGroups' | 'invoiceTypes' | 'paymentTypes' | 'clientTypes'
  | 'referenceTypes' | 'itemTypes' | 'currencyRates';

export interface EdefCallContext {
  environment: EdefEnvironment;        // importé de platform-config
  token: Secret;                       // jamais une chaîne nue
  organizationId: string | null;       // pour le journal des échanges
  pointOfSaleId: string | null;
}

export type EdefFailureKind =
  | 'production_disabled'  // production fermée : AUCUN appel réseau
  | 'unauthorized'         // HTTP 401
  | 'timeout'              // délai DGI_HTTP_TIMEOUT_MS dépassé
  | 'network'              // DNS, TLS, connexion refusée
  | 'server'               // HTTP 5xx
  | 'business'             // corps avec errorCode, ou autre 4xx
  | 'invalid_response';    // JSON illisible, schéma non conforme, réponse > 1 Mio

export interface EdefFailure {
  kind: EdefFailureKind;
  httpStatus: number | null;
  dgiErrorCode: string | null;
  message: string;                     // français, assaini (redaction.ts), affichable
}

export type EdefOutcome<T> =
  | { ok: true; data: T; durationMs: number }
  | { ok: false; error: EdefFailure; durationMs: number };

export interface EdefInfoStatus {
  status: boolean;
  version: string | null;
  nif: string | null;
  nim: string | null;
  tokenValid: string;                  // ISO 8601
  serverDateTime: string;
  emcfList: Array<{
    nim: string | null; status: string | null; shopName: string | null;
    address1: string | null; address2: string | null; address3: string | null;
    contact1: string | null; contact2: string | null; contact3: string | null;
  }>;
}

export class EdefClient {
  getStatus(ctx: EdefCallContext): Promise<EdefOutcome<EdefInfoStatus>>;
  getReferenceList<L extends EdefReferenceList>(
    list: L, ctx: EdefCallContext,
  ): Promise<EdefOutcome<EdefReferenceData[L]>>;
}
```

`EdefReferenceData` : `taxGroups` → `Record<string, number>` (clés d'une lettre minuscule,
valeurs numériques : la spécification les déclare entières, la documentation PDF
décimales — on accepte les deux) ; `currencyRates` → `{ type, description, date, rate }[]` ;
les cinq autres → `{ type, description }[]`.

**Comportement.**

- Le client **ne lève jamais** pour une défaillance distante ; il renvoie un
  `EdefOutcome`. Il ne lève que pour une erreur de programmation.
- `Authorization: Bearer <jeton>`, `Accept: application/json`. TLS par défaut, aucune
  désactivation de vérification de certificat.
- Délai : `AbortSignal.timeout(DGI_HTTP_TIMEOUT_MS)`. **Aucun réessai automatique** : le
  test de connexion est interactif, l'appelant décide. (Pour S25f : jamais de réessai sur
  `POST` ni sur `confirm` — ADR-0019.)
- Réponses validées par Zod, champs inconnus ignorés ; réponse brute conservée au journal.
- **Journal des échanges `edef_exchanges`**, en ajout seul, écrit à **chaque** appel, y
  compris en échec : `at`, `organizationId`, `pointOfSaleId`, `environment`, `method`,
  `path`, `httpStatus`, `durationMs`, `outcome` (`ok` ou `EdefFailureKind`),
  `dgiErrorCode`, `requestBody` (`null` pour un GET), `responseBody` (texte, tronqué à
  32 Kio, passé par la rédaction), `_schemaVersion`. **Jamais d'en-tête.** Index
  `{ organizationId: 1, at: -1 }`. Aucune route ne l'expose dans ce lot ; aucune purge (la
  DGI exige de conserver chaque échange).

**Listes de référence.** Une route (§10) les lit à la demande avec le jeton d'un point de
vente. Les listes sont des données de référence publiques, identiques pour tous : elles
sont conservées par environnement dans `edef_reference_snapshots` (`environment`, `list`,
`sha256`, `payload`, `fetchedAt`), **un nouveau document seulement quand le contenu
change**. Les factures de S25f figeront l'empreinte de la liste utilisée. Contrôle
croisé : les taux des groupes B, C et O sont comparés aux paramètres `tva_taux_normal`,
`tva_taux_reduit` et `tva_taux_reduit_1pct` du pack `cd-2026` ; un écart produit un
avertissement `TAX_RATE_DIFFERS_FROM_PACK`, non bloquant dans ce lot. La DGI reste la
source des taux de facturation ; le pack sert de garde-fou daté et sourcé.

**Faux serveur** `apps/api/src/edef/testing/fake-edef-server.ts` (serveur `node:http` sur
port éphémère, aucune dépendance ajoutée) :

```ts
export interface FakeEdefTokenProfile {
  nif: string;
  nim: string;
  tokenValid: string;                         // ISO
  emcfStatus?: 'Enregistré' | 'Actif' | 'Désactivé';
  behaviour?: 'ok' | 'unauthorized' | 'server_error' | 'slow' | 'malformed' | 'business_error' | 'status_false';
}
export function startFakeEdefServer(opts: {
  tokens: Record<string, FakeEdefTokenProfile>;   // clé = jeton attendu dans Authorization
  taxGroups?: Record<string, number>;
  slowMs?: number;
}): Promise<{
  baseUrl: string;
  requests: Array<{ method: string; path: string; authorization: string | null }>;
  close(): Promise<void>;
}>;
```

Aucun test automatisé n'appelle la DGI réelle. L'essai sur l'environnement de test DGI se
fait à la main, par l'interface, avec le jeton de développement de la décideuse saisi dans
l'organisation de test de Go Freelance — jamais commité, jamais copié dans un fichier.

### 7. Correction du pack TVA (chantier B)

**Constat.** `tva_taux_reduit: 0.08` est faux depuis 2026 : le taux réduit est passé à 5 %
(groupe C de la facture normalisée) et un taux de 1 % a été créé (groupe O). Source :
loi de finances 2026, communiqué officiel DGI n° 010 du 25 févr. 2026.

**Pourquoi un erratum en place respecte docs/09.** docs/09 rend une version active
immuable pour qu'un plan reste **reproductible**. Ici, aucun plan ne peut changer : aucun
des cinq modèles ne déclare de driver `tva_*`, et l'évaluateur ne résout que les drivers
du modèle ; les évaluations, les empreintes, les PDF et les plans figés sont donc
strictement identiques avant et après. Créer une nouvelle version aurait au contraire des
effets (O5).

**Ce que fait B.**

1. `ParameterPackSchema` gagne un champ facultatif
   `revisions: { numero: entier ≥ 2, date: 'AAAA-MM-JJ', objet: string ≥ 10 }[]` (la
   révision 1 est implicite). `toSummary` et `packVersion` ne changent pas.
2. `cd-2026.yaml` : `tva_taux_reduit` → `0.05`, aide « TVA taux réduit (groupe C) »,
   source « Loi de finances 2026 ; communiqué officiel DGI n° 010 du 25 févr. 2026 »,
   `a_confirmer: true` tant que le texte original n'est pas classé dans
   `docs/sources/dgi-rdc/` ; nouveau paramètre `tva_taux_reduit_1pct: 0.01` (groupe O),
   même source, même marque ; `tva_seuil_assujettissement_cdf` passe en
   `a_confirmer: true` et son aide est corrigée (« seuil d'assujettissement à la TVA » —
   le libellé actuel le confond avec le régime réel) ; entrée `revisions` n° 2 datée du
   jour du commit.
3. **Test verrou** : aucun modèle ne déclare de driver dont l'identifiant figure dans un
   paramètre corrigé par une révision. Le jour où un modèle consommera la TVA, ce test
   tombera, et toute correction ultérieure exigera une vraie version du pack (à concevoir
   alors, hors de ce lot).
4. `ci-2026.yaml` n'est pas touché (autre pays, autre loi). docs/09 reçoit une ligne qui
   décrit la règle de l'erratum.

### 8. RBAC et ré-authentification (chantier A)

**Nouvelle action `fiscal.manage`** — « Gérer l'identité fiscale et la facture
normalisée », seizième action, ajoutée **en fin** de `ACTIONS` et de docs/12.

| Rôle | PRO | ADM | DIR | CPT | ANA | CDP | CON | LEC |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `fiscal.manage` | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

**Plateforme : interdite à tous les rôles**, super-administrateur compris, et ajoutée à
`PLATFORM_FORBIDDEN_ACTIONS` (quatrième interdit absolu) : un acteur Lalanda ne saisit
jamais le jeton d'un contribuable et ne bascule jamais son régime de facturation.

Conséquences vérifiées sur `grantableRoles` : un Administrateur ne pouvait déjà pas
attribuer le rôle Directeur financier (`plan.approve`) ; rien ne change pour les autres
rôles.

**Ré-authentification pour les membres d'organisation.** Les écritures sensibles du
chantier B (jeton, désactivation, retrait d'un point de vente, changement
d'environnement) exigent une ré-authentification de moins de 10 minutes, **par le même
mécanisme** qu'ADR-0013 §5 (fenêtre liée à la session). Aujourd'hui, seul un
super-administrateur peut l'obtenir (`admin/reauth`). A ajoute :

- `GET /me/reauth` → `{ "valid": boolean, "expiresAt": string | null }`
- `POST /me/reauth` `{ "password": string }` → `{ "expiresAt": string }` ; `401
  INVALID_PASSWORD` sinon ; quota `INTEGRATION_WRITE_THROTTLE`.

Toutes deux dans `SANS_PERMISSION` : on ré-authentifie **sa propre** session. Une fenêtre
ouverte par `/me/reauth` vaut aussi pour `/admin` (même session, même mot de passe) ; elle
n'ouvre aucun droit, elle prouve seulement la présence de la personne.

### 9. Journal d'audit

`AuditService.recordStrict` et `record` acceptent un paramètre facultatif
`{ session?: ClientSession }` (ajout, compatible avec tous les appels existants).

| Action | Écriture | Métadonnées (jamais de valeur secrète) |
|---|---|---|
| `erp_module.enabled` / `erp_module.disabled` | `record` | `module` |
| `fiscal_profile.updated` | `record` | `champs` (noms séparés par des virgules), `creation` |
| `emcf_point_of_sale.created` | strict, transaction | `environment`, `nim`, `last4` |
| `emcf_point_of_sale.token_replaced` | strict, transaction | `nim`, `last4Before`, `last4After` |
| `emcf_point_of_sale.disabled` | strict, transaction | `nim`, `reason` (≤ 500) |
| `normalized_invoicing.enabled` | strict, transaction | `environment`, `pointsOfSale` (nombre actifs) |
| `normalized_invoicing.disabled` | strict, transaction | `environment`, `reason` (≤ 500) |
| `normalized_invoicing.environment_changed` | strict si activée, sinon `record` | `from`, `to`, `reason` |

Le test d'un jeton n'est pas un événement d'audit (il est dans `lastTest` et dans
`edef_exchanges`).

### 10. Contrat HTTP — ce contre quoi le chantier C code

Toutes les routes sont sous `@UseGuards(AuthGuard, PermissionsGuard)` et visent
l'organisation active. Erreurs : forme actuelle des contrôleurs (`code`, `message`,
`details` éventuels). Un point de vente d'une autre organisation répond **404**
`POINT_OF_SALE_NOT_FOUND`, jamais 403.

| Méthode et chemin | Permission | Ré-auth | Quota | Chantier |
|---|---|:--:|---|:--:|
| `GET /organizations/current/modules` | `analytics.read` (tout membre : la navigation en a besoin) | | global | A |
| `PUT /organizations/current/modules/:moduleKey` | `organization.manage` | | global | A |
| `GET /me/reauth` · `POST /me/reauth` | aucune (`SANS_PERMISSION`) | | écriture intégration | A |
| `GET /organizations/current/fiscal-profile` | `fiscal.manage` | | global | B |
| `PUT /organizations/current/fiscal-profile` | `fiscal.manage` | | global | B |
| `GET /organizations/current/normalized-invoicing` | `fiscal.manage` | | global | B |
| `POST /organizations/current/normalized-invoicing/activate` | `fiscal.manage` | ✓ | écriture intégration | B |
| `POST /organizations/current/normalized-invoicing/deactivate` | `fiscal.manage` | ✓ | écriture intégration | B |
| `POST /organizations/current/normalized-invoicing/environment` | `fiscal.manage` | ✓ | écriture intégration | B |
| `POST /organizations/current/normalized-invoicing/points-of-sale` | `fiscal.manage` | ✓ | écriture intégration | B |
| `PATCH /organizations/current/normalized-invoicing/points-of-sale/:posId` | `fiscal.manage` | | global | B |
| `PUT /organizations/current/normalized-invoicing/points-of-sale/:posId/token` | `fiscal.manage` | ✓ | écriture intégration | B |
| `POST /organizations/current/normalized-invoicing/points-of-sale/:posId/test` | `fiscal.manage` | | test DGI | B |
| `POST /organizations/current/normalized-invoicing/points-of-sale/:posId/disable` | `fiscal.manage` | ✓ | écriture intégration | B |
| `GET /organizations/current/normalized-invoicing/points-of-sale/:posId/reference-data` | `fiscal.manage` | | test DGI | B |

« Écriture intégration » = `INTEGRATION_WRITE_THROTTLE` existant (10 par heure et par
utilisateur) ; « test DGI » = nouveau `EDEF_TEST_THROTTLE` (30 par heure et par
utilisateur). Sans fenêtre de ré-authentification : `401 REAUTH_REQUIRED` — l'interface
ouvre alors la saisie du mot de passe (`POST /me/reauth`) et **rejoue une fois** la requête.

#### Modules

```jsonc
// GET /organizations/current/modules  →  200
{
  "modules": [
    {
      "key": "sales",
      "label": "Ventes et facturation",
      "description": "Clients, devis, factures et encaissements. Donne accès à la facture normalisée DGI.",
      "enabled": false,
      "changedAt": null,                 // ISO ou null
      "deactivationBlockedBy": null      // ou { "code": "NORMALIZED_INVOICING_ENABLED", "message": "…" }
    }
  ]
}

// PUT /organizations/current/modules/sales   corps : { "enabled": true }   →  200, l'élément ci-dessus
// Erreurs : 400 INVALID_REQUEST · 404 MODULE_UNKNOWN · 409 MODULE_DEACTIVATION_BLOCKED { details: { code } }
```

#### Identité fiscale

```jsonc
// GET /organizations/current/fiscal-profile  →  200
{
  "profile": null,                       // ou l'objet ci-dessous, plus "updatedAt"
  "locks": { "nif": false },             // true pendant l'activation de la facture normalisée
  "options": {
    "legalForms": [ { "value": "sarl", "label": "SARL" }, { "value": "autre", "label": "Autre" } ]
  }
}

// PUT /organizations/current/fiscal-profile  (corps complet, champs inconnus refusés)  →  200, même forme que GET
{
  "legalName": "Exemple SARL",
  "tradeName": null,
  "legalForm": "sarl",
  "legalFormOther": null,
  "nif": "A0000000X",
  "rccm": null,
  "nationalId": null,
  "vatRegistered": true,
  "headOffice": {
    "line1": "1, avenue Exemple", "line2": null, "commune": "Gombe",
    "city": "Kinshasa", "province": "Kinshasa", "country": "CD"
  },
  "phone": "+243 800 000 000",
  "email": "facturation@exemple.cd"
}
// Erreurs : 400 INVALID_REQUEST { details: { issues } } · 409 FISCAL_IDENTITY_LOCKED
```

#### Facture normalisée

```jsonc
// GET /organizations/current/normalized-invoicing  →  200
{
  "state": "disabled",                   // "disabled" | "enabled"
  "environment": "test",                 // "test" | "production"
  "firstActivatedAt": null,
  "activatedAt": null,
  "deactivatedAt": null,
  "deactivationReason": null,
  "prerequisites": {
    "salesModuleEnabled": false,
    "fiscalProfileComplete": false,
    "countryIsCd": false,
    "activePointOfSaleInEnvironment": false,
    "productionAvailable": false
  },
  "canActivate": false,
  "pointsOfSale": [ /* PointOfSaleView */ ]
}

// PointOfSaleView
{
  "id": "6712f0c4e1a2b3c4d5e6f701",
  "label": "Boutique Gombe",
  "environment": "test",
  "expectedNim": null,
  "enabled": true,
  "status": "active",                    // disabled | token_missing | nif_mismatch | token_expired | failing | active
  "token": { "configured": true, "last4": "x9Zq", "updatedAt": "2026-10-20T09:00:00.000Z" },
  "dgi": {                               // null tant qu'aucun test n'a réussi
    "nif": "A0000000X",
    "nim": "XX01000001-1",
    "tokenValidUntil": "2027-01-31T00:00:00.000Z",
    "emcfStatus": "Actif",
    "shopName": "Boutique Gombe",
    "address": ["1, avenue Exemple", "Gombe", "Kinshasa"],
    "contacts": ["+243 800 000 000"],
    "apiVersion": "2.0",
    "checkedAt": "2026-10-20T09:00:00.000Z"
  },
  "lastTest": { "at": "2026-10-20T09:00:00.000Z", "ok": true, "code": null, "message": "Connexion réussie." }
}

// POST …/activate       { "environment": "test" }                        → 200, vue complète
// POST …/deactivate     { "reason": "20 à 500 caractères" }              → 200, vue complète
// POST …/environment    { "environment": "production", "reason"?: "…" }  → 200, vue complète
// POST …/points-of-sale { "label": "…", "environment": "test", "expectedNim": null, "token": "…" } → 201, PointOfSaleView
// PATCH …/points-of-sale/:posId        { "label"?: "…", "expectedNim"?: "…" | null }  → 200, PointOfSaleView
// PUT …/points-of-sale/:posId/token    { "token": "…" }                  → 200, PointOfSaleView (réactive si désactivé)
// POST …/points-of-sale/:posId/test    (sans corps)                      → 200, PointOfSaleView ; le résultat est dans lastTest
// POST …/points-of-sale/:posId/disable { "reason"?: "…" }                → 200, PointOfSaleView

// GET …/points-of-sale/:posId/reference-data  →  200
{
  "environment": "test",
  "fetchedAt": "2026-10-20T09:00:00.000Z",
  "lists": {
    "taxGroups": { "a": 0, "b": 16, "c": 5, "o": 1 },
    "invoiceTypes": [ { "type": "FV", "description": "…" } ],
    "paymentTypes": [], "clientTypes": [], "referenceTypes": [], "itemTypes": [],
    "currencyRates": [ { "type": "USD", "description": "…", "date": "…", "rate": 0 } ]
  },
  "failures": { "itemTypes": { "kind": "timeout", "message": "…" } },   // listes non obtenues
  "warnings": [ { "code": "TAX_RATE_DIFFERS_FROM_PACK", "group": "c", "dgi": 5, "pack": 5 } ]
}
```

**Erreurs de la facture normalisée et des points de vente** (toutes avec `message` en
français) :

| HTTP | Code | Quand |
|---|---|---|
| 400 | `INVALID_REQUEST` | corps invalide ; motif trop court |
| 401 | `REAUTH_REQUIRED` | fenêtre de ré-authentification absente |
| 404 | `POINT_OF_SALE_NOT_FOUND` | inconnu ou d'une autre organisation |
| 409 | `FISCAL_PROFILE_REQUIRED` | création d'un point de vente sans fiche fiscale |
| 409 | `NORMALIZED_INVOICING_PREREQUISITES` | `details.missing: string[]` (R1) |
| 409 | `DGI_PRODUCTION_UNAVAILABLE` | production demandée, non ouverte |
| 409 | `EMCF_ALREADY_REGISTERED` | NIM déjà rattaché à une organisation Lalanda |
| 409 | `LAST_ACTIVE_POINT_OF_SALE` | R2 |
| 422 | `EMCF_TOKEN_REJECTED` · `EMCF_STATUS_FALSE` · `EMCF_NIF_MISMATCH` · `EMCF_NIM_MISMATCH` · `EMCF_TOKEN_EXPIRED` · `EMCF_DISABLED_AT_DGI` · `EDEF_INVALID_RESPONSE` | test du jeton (§4.1) |
| 502 | `EDEF_UNREACHABLE` | `details.kind` : `timeout` \| `network` \| `server` |
| 503 | `VAULT_UNAVAILABLE` | coffre non configuré |

Toute erreur issue d'une réponse DGI porte `details.dgiErrorCode` et `details.dgiMessage`
(assaini) : la DGI exige que le code et le libellé soient montrés à l'utilisateur.

### 11. Interfaces internes A ↔ B

Ces fichiers sont livrés par A dans le **jalon A0** (§12), puis ne changent plus sans
accord du CTO.

```ts
// apps/api/src/erp-modules/erp-modules.types.ts
export const ERP_MODULES = ['sales'] as const;
export type ErpModuleKey = (typeof ERP_MODULES)[number];
export interface DeactivationBlock { code: string; message: string }
export type DeactivationBlocker = (organizationId: string) => Promise<DeactivationBlock | null>;

// apps/api/src/erp-modules/erp-modules.service.ts (exporté par ErpModulesModule)
export class ErpModulesService {
  isEnabled(organizationId: string, module: ErpModuleKey): Promise<boolean>;
  registerDeactivationBlocker(module: ErpModuleKey, blocker: DeactivationBlocker): void;
  // + list / setEnabled, utilisés par le contrôleur de A
}

// apps/api/src/integrations/organization-secrets.port.ts
import type { ClientSession } from 'mongoose';
import type { Secret } from './secret-value.js';
export const ORGANIZATION_SECRET_KINDS = ['dgi_emcf_token'] as const;
export type OrganizationSecretKind = (typeof ORGANIZATION_SECRET_KINDS)[number];
export interface OrganizationSecretRef { organizationId: string; kind: OrganizationSecretKind; ownerId: string }
export interface OrganizationSecretDescription {
  configured: boolean; last4: string | null; updatedAt: Date | null; updatedBy: string | null;
}
export interface OrganizationSecretsPort {
  put(ref: OrganizationSecretRef, value: string, actorUserId: string,
      opts?: { session?: ClientSession }): Promise<OrganizationSecretDescription>;
  resolve(ref: OrganizationSecretRef): Promise<Secret | null>;      // lève VaultUnavailableError si pas de coffre
  describe(ref: OrganizationSecretRef): Promise<OrganizationSecretDescription>;
  describeMany(organizationId: string, kind: OrganizationSecretKind,
               ownerIds: readonly string[]): Promise<Map<string, OrganizationSecretDescription>>;
  destroy(ref: OrganizationSecretRef, opts?: { session?: ClientSession }): Promise<void>;
}
export const ORGANIZATION_SECRETS = Symbol('ORGANIZATION_SECRETS');
export class VaultUnavailableError extends Error { readonly code = 'VAULT_UNAVAILABLE'; }

// apps/api/src/platform-config/dgi-platform.config.ts
export type EdefEnvironment = 'test' | 'production';
export interface DgiPlatformConfig {
  baseUrl: Readonly<Record<EdefEnvironment, string>>;
  isf: Readonly<{ test: string | null; production: string | null }>;
  productionEnabled: boolean;
  httpTimeoutMs: number;
}
export const DGI_PLATFORM_CONFIG = Symbol('DGI_PLATFORM_CONFIG');
```

Et, livrés par B pour les lots suivants :

```ts
// apps/api/src/fiscal/normalized-invoicing.service.ts
emissionModeOf(organizationId: string): Promise<'normalized' | 'standard'>;
// apps/api/src/fiscal/points-of-sale.service.ts
resolveActiveToken(organizationId: string, pointOfSaleId: string): Promise<{ token: Secret; environment: EdefEnvironment } | null>;
```

`IntegrationsModule` exporte en plus `ReauthService` et le fournisseur
`ORGANIZATION_SECRETS`.

### 12. Trois chantiers en parallèle — frontières de fichiers

Règle inchangée depuis ADR-0011 : **un fichier, un seul écrivain**. Toute exception passe
par le CTO.

#### Jalon A0 — contrats (développeur A, fusionné **avant** tout le reste)

Petit, sans comportement visible : il permet à B et C de compiler et de coder contre des
types réels.

- `authz/permissions.ts`, `authz/permissions.test.ts` (matrice littérale 8 × 16 + 6 × 16
  = 224 assertions), texte « 16 actions » de `authz/routes-coverage.test.ts` ;
- `authz/audit.service.ts` (paramètre `session`) ;
- `erp-modules/` : `erp-modules.types.ts`, `erp-module.schema.ts`,
  `erp-modules.service.ts` (complet, sans contrôleur), `erp-modules.module.ts` ;
- `integrations/organization-secrets.port.ts` ; export de `ReauthService` dans
  `integrations.module.ts` (le fournisseur `ORGANIZATION_SECRETS` arrive avec A) ;
- `platform-config/` (`dgi-platform.config.ts`, `platform-config.module.ts`) ;
  `packages/shared/src/env/index.ts` (variables `DGI_*`) ; `.env.example` ;
- `security/throttling.ts` (`EDEF_TEST_THROTTLE`) ;
- `app.module.ts` (`ErpModulesModule`, `PlatformConfigModule`) ;
- `docs/12-ROLES-PERMISSIONS.md` (seizième action) et une note « amendé par ADR-0021 » en
  tête d'ADR-0012.

#### Chantier A — back-end plateforme

| Possède | Ne touche pas |
|---|---|
| `apps/api/src/erp-modules/**` | `apps/api/src/fiscal/**`, `apps/api/src/edef/**` |
| `apps/api/src/integrations/**` : `organization-secret.schema.ts`, `organization-secrets.service.ts` (+ tests), `rewrap.ts`, `no-secret-leak.test.ts`, `session-reauth.controller.ts` (`/me/reauth`), `integrations.module.ts` | `integrations/secrets-crypto.ts` (inchangé), `secrets.service.ts` (inchangé) |
| `apps/api/src/authz/**` | `apps/web/**` |
| `apps/api/src/platform-config/**`, `apps/api/src/security/throttling.ts`, `packages/shared/src/env/**` | `packages/engine/**` |
| docs/12, docs/15, docs/16, docs/17 (fin de lot, **après** la fusion de B, à partir de cet ADR) | docs/04, docs/09 |

#### Chantier B — back-end fiscal et DGI

| Possède | Ne touche pas |
|---|---|
| `apps/api/src/fiscal/**` (nouveau) : fiche fiscale, facture normalisée, points de vente, listes de référence, contrôleurs `fiscal-profile.controller.ts` et `normalized-invoicing.controller.ts`, `fiscal.module.ts`, tests ; un faux coffre en mémoire `fiscal/testing/in-memory-organization-secrets.ts` (implémente `OrganizationSecretsPort`) | `apps/api/src/integrations/**` (consommateur seulement) |
| `apps/api/src/edef/**` (nouveau) : client, types, journal `edef_exchanges`, `testing/fake-edef-server.ts` | `apps/api/src/authz/**`, `apps/api/src/erp-modules/**` (consommateur seulement) |
| `packages/engine/src/parameter-packs/cd-2026.yaml`, `schema.ts`, `parameter-packs.test.ts` | `ci-2026.yaml`, les modèles sectoriels |
| docs/09 (ligne sur l'erratum) | `apps/api/src/mail/**` (décision ouverte n° 5), `apps/web/**` |

#### Chantier C — front-end paramètres

| Possède | Ne touche pas |
|---|---|
| `apps/web/src/lib/api.ts` (types `OrgAction` + `'fiscal.manage'`, vues et méthodes des routes §10) | `apps/api/**`, `packages/**` |
| `organisation/_components/organization-model.ts` (+ test) : onglet `{ segment: 'fiscalite', label: 'Fiscalité', action: 'fiscal.manage' }`, après « Paramètres » | `app-header.tsx`, menu du compte (ADR-0016), `lib/routes.ts` (`/organisation` déjà protégé) |
| `organisation/parametres/page.tsx` + nouveau `_components/modules-panel.tsx` (section « Modules », sous les réglages généraux) | `_components/settings-panel.tsx` (inchangé) |
| nouveau `organisation/fiscalite/page.tsx` ; nouveaux `_components/fiscal-profile-panel.tsx`, `normalized-invoicing-panel.tsx`, `point-of-sale-form.tsx`, `reauth-dialog.tsx`, `fiscal-model.ts` (+ test) | |
| docs/04 (section Fiscalité) | |

Pourquoi un onglet **Fiscalité** et non une section de « Paramètres » : « Paramètres » est
ouvert par `organization.manage`, que le Directeur financier ne détient pas. Ranger la
fiscalité sous cet onglet le lui cacherait alors qu'il en a le droit. La section Modules
reste dans « Paramètres ».

#### Fichiers partagés, en ajout pur

| Fichier | Qui | Règle |
|---|---|---|
| `apps/api/src/app.module.ts` | A0, puis B (`FiscalModule`, `EdefModule`) | une ligne d'import par module, rien d'autre |
| `apps/api/src/authz/routes-coverage.test.ts` | A (nouveaux contrôleurs, entrées `SANS_PERMISSION` de `/me/reauth`), B (deux contrôleurs) | insertion à la place alphabétique dans `CONTROLEURS` et dans les imports ; conflit éventuel résolu par celui qui fusionne en second |
| `apps/api/src/authz/permissions.ts` | **A seul** | B et C ne le modifient jamais |

#### Ordre

1. **A0** fusionné dans `main`.
2. **A, B, C en parallèle**, chacun dans son worktree, rebasés sur A0. B code et teste
   contre le faux coffre en mémoire ; C code contre le contrat §10 avec des réponses
   simulées dans ses tests.
3. Fusion **A**, puis **B** (rebasé sur A ; ses tests e2e passent alors par le vrai coffre
   et le vrai registre de bloqueurs), puis **C** (rebasé, vérifié contre l'API réelle).
4. A met à jour docs/15, docs/16 et docs/17.

### 13. Critères d'acceptation et tests

#### A0 et A

- Matrice : 224 assertions littérales ; `fiscal.manage` accordée à `owner` et
  `finance_director` seulement ; refusée à tout rôle plateforme, y compris sous accès
  délégué ; `PLATFORM_FORBIDDEN_ACTIONS` en contient quatre.
- Modules : organisation neuve → `sales` désactivé ; activer puis désactiver → deux
  événements d'audit ; même état → aucun événement ; bloqueur enregistré → `409
  MODULE_DEACTIVATION_BLOCKED` et `deactivationBlockedBy` renseigné ; Lecteur : `GET` 200,
  `PUT` 403 ; autre organisation → 404.
- Coffre : aller-retour `put`/`resolve` ; `describe` ne renvoie jamais la valeur ;
  réécrire `organizationId` ou `ownerId` d'un document en base, ou recopier un chiffré
  vers un autre document → le déchiffrement échoue ; sans clé maîtresse →
  `VaultUnavailableError`, et **aucune** lecture de variable d'environnement ;
  `JSON.stringify`, `String()` et `util.inspect` d'un document ne contiennent ni la valeur,
  ni `ciphertext`, `iv`, `salt`, `authTag`, `keyId` ; `destroy` retire le chiffré ;
  `secrets:rewrap` k1 → k2 couvre `organization_secrets`, rejouable sans effet.
- `SecretsService` : les tests existants (dont `secrets-interrupteur.test.ts`) passent sans
  modification.
- `/me/reauth` : bon mot de passe → fenêtre ouverte pour **cette** session seulement ;
  mauvais → `401 INVALID_PASSWORD`.
- Environnement : `DGI_PRODUCTION_ENABLED=true` sans `DGI_ISF_PRODUCTION` → refus de
  démarrer, message explicite ; valeurs par défaut correctes.
- `routes-coverage.test.ts` vert avec les nouveaux contrôleurs.

#### B

- Fiche fiscale : champ inconnu → 400 ; `legalForm: 'autre'` sans `legalFormOther` → 400 ;
  NIF normalisé (`"a 000-0000x"` → `"A0000000X"`) ; modification du NIF pendant
  l'activation → 409, les autres champs passent ; audit sans valeur.
- Points de vente, contre le faux serveur : jeton valide → 201, `last4` seul ;
  pour **chaque** cas d'échec (§4.1) → le code attendu **et** aucune écriture (ni document,
  ni secret, vérifiés en base) ; serveur lent → `502 EDEF_UNREACHABLE` en moins de
  `DGI_HTTP_TIMEOUT_MS` + 1 s ; même NIM dans deux organisations → `409
  EMCF_ALREADY_REGISTERED` sans nommer l'autre ; production fermée → 409, **aucune**
  requête reçue par le faux serveur.
- Anti-fuite : pour chaque route du chantier, ni la réponse, ni `audit_events`, ni
  `edef_exchanges`, ni les journaux capturés ne contiennent la chaîne du jeton ; le faux
  serveur, lui, a bien reçu `Authorization: Bearer <jeton>` (preuve que le jeton est
  utilisé).
- Facture normalisée : chaque prérequis manquant apparaît dans `missing` ; activation →
  un événement strict ; panne simulée de l'écriture d'audit → l'état ne change pas ;
  désactivation sans motif → 400, sans ré-authentification → 401, avec → `disabled` et
  `firstActivatedAt` conservé ; deux activations concurrentes → un seul événement ;
  `production → test` pendant l'activation sans motif → 400 ; retrait du dernier point de
  vente actif → 409 ; après fusion de A, désactivation du module Ventes pendant
  l'activation → 409 ; `emissionModeOf` renvoie `'normalized'` si et seulement si l'état
  est `enabled` ; seul `NormalizedInvoicingService` écrit la collection.
- Client : chaque `EdefFailureKind` produit par le faux serveur ; JSON illisible et réponse
  de plus de 1 Mio → `invalid_response` ; un journal `edef_exchanges` par appel, sans
  en-tête ; `taxGroups` à valeurs entières et décimales acceptées.
- Listes de référence : deux lectures identiques → un seul instantané ; contenu changé →
  un second ; taux du groupe C différent du pack → avertissement.
- RBAC e2e : Propriétaire et Directeur financier 200 ; Administrateur, Comptable, Lecteur
  403 ; autre organisation 404 ; super-administrateur sans appartenance → 404.
- Pack : `tva_taux_reduit = 0.05`, `tva_taux_reduit_1pct = 0.01`, révision n° 2 présente ;
  test verrou vert ; tous les tests du moteur et des plans passent **sans modification**.

#### C

- Onglet « Fiscalité » visible si et seulement si `fiscal.manage` figure dans
  `/me/permissions` ; section « Modules » de « Paramètres » en lecture seule sans
  `organization.manage`.
- Modules : bascule de « Ventes » ; motif de refus affiché quand
  `deactivationBlockedBy` est renseigné.
- Fiscalité : formulaire de la fiche (erreurs serveur affichées champ par champ) ; liste des
  points de vente avec leur état en mots (« Jeton expiré », « NIF différent de la fiche »…),
  la date de fin de validité du jeton, un avertissement à moins de 30 jours ; bouton
  « Tester la connexion » ; prérequis manquants listés en clair et bouton d'activation
  désactivé tant que `canActivate` est faux ; badge « Mode test » partout où
  l'environnement est `test` ; production proposée seulement si
  `prerequisites.productionAvailable`, sinon la phrase « La production sera ouverte après
  l'homologation de Lalanda par la DGI » ; bandeau permanent après une désactivation, avec
  date et motif ; pour une erreur DGI, code et libellé DGI affichés tels quels.
- Jeton : champ masqué, `autocomplete="off"`, vidé après envoi, jamais placé dans l'URL,
  `localStorage`, `sessionStorage` ni un journal console ; un test vérifie que les méthodes
  d'API ne l'envoient que dans le corps d'un `POST`/`PUT`.
- Ré-authentification : `401 REAUTH_REQUIRED` → fenêtre de mot de passe → une seule
  nouvelle tentative ; logique testée dans `fiscal-model.test.ts` (vitest en environnement
  node, comme le reste de `apps/web`).
- Essai manuel par la décideuse sur l'environnement de test DGI, avec son jeton de
  développement, consigné dans la PR (capture d'écran sans le jeton).

#### Tous

`pnpm format`, lint, typecheck et tests verts à la racine ; tests existants inchangés
(toute modification justifiée dans la PR) ; `git diff --stat origin/main` sans suppression
hors périmètre ; aucun fichier de `dgi/` ni aucun jeton dans un commit.

## Conséquences

- Sept collections nouvelles : `organization_modules`, `organization_secrets`,
  `organization_fiscal_profiles`, `normalized_invoicing_settings`, `emcf_points_of_sale`,
  `edef_exchanges`, `edef_reference_snapshots`. Leurs
  index sont créés en production par `IndexesService`, sans action manuelle.
- La matrice passe à 16 actions ; docs/12 et ADR-0012 sont amendés ; une quatrième action
  devient interdite à la plateforme.
- La portée « organisation » du coffre, annoncée par ADR-0013 §10 comme « non écrite »,
  existe — dans une collection distincte, pas dans `integrations`. Le champ `scope` de
  `integrations` reste inutilisé ; il n'est pas retiré (aucune migration pour rien).
- Les membres d'organisation peuvent désormais se ré-authentifier. Un compte **sans mot
  de passe** (créé par Google) se ré-authentifie par une **connexion Google récente** :
  `POST /me/reauth` sans mot de passe ouvre la fenêtre si l'utilisateur n'a pas de compte
  `credential` ET que la session courante a été créée il y a moins de 10 minutes ;
  sinon `401 REAUTH_GOOGLE_REQUIRED`, et l'interface propose « Se reconnecter avec
  Google » puis rejoue la requête (chantier A pour l'API, C pour l'interface).
- Le lot S25f trouvera prêts : le jeton par point de vente, le client et son journal,
  l'ISF, les listes de référence datées et `emissionModeOf`.
- Aucun risque de coordination avec d'autres branches : les branches e-mail sont
  fusionnées, la branche MFA est abandonnée.
- Le risque majeur reste hors de notre main : l'homologation définitive pourrait exiger un
  boîtier MCF physique, incompatible avec un logiciel en ligne (ADR-0019). Ce lot reste
  utile dans tous les cas — il est le socle de l'homologation transitoire comme de la
  définitive.

## Plan de validation

Les critères du §13, par chantier ; revue CTO de chaque branche avant fusion (isolation
par organisation, absence de jeton en clair, conformité au contrat §10/§11) ; essai manuel
de la décideuse sur l'environnement de test DGI avant de déclarer le lot livré.

## Décisions ouvertes — elles appartiennent à la décideuse

1. **Qui gère la fiscalité ?** Proposé : Propriétaire et Directeur financier seulement.
   Faut-il l'ouvrir à l'Administrateur, ou au Comptable (souvent celui qui traite avec la
   DGI) ? Changer la matrice est simple ; le choix, lui, engage.
2. **Les modules sont-ils compris dans tous les forfaits** ou vendus à part ? Proposé pour
   ce lot : ouverts à tous, sans contrôle de forfait.
3. **Une organisation non assujettie à la TVA** peut-elle activer la facture normalisée ?
   Proposé : oui, c'est son choix (le champ « assujetti » est informatif), en attendant la
   réponse de la DGI sur le groupe des non-assujettis.
4. **Un même NIF dans deux organisations Lalanda** : proposé de refuser la seconde
   activation, pour garantir une seule série de numérotation par contribuable. À lever si
   un cas réel l'exige.
5. ~~Avertir les propriétaires par e-mail lors d'une désactivation~~ — **TRANCHÉ par le
   coordinateur** : inclus dans ce lot (chantier B). Le module e-mail n'est pas en refonte.
   B ajoute un gabarit `renderNormalizedInvoicingDisabled` dans `mail/mail.templates.ts`
   (mêmes contraintes ADR-0014 § 2 : logo `cid:`, variante texte complète) et l'envoie à
   chaque Propriétaire de l'organisation ; un échec d'envoi est journalisé, il ne bloque
   pas la désactivation.
6. ~~Comptes Google sans mot de passe~~ — **TRANCHÉ par le coordinateur** : ré-authentification
   par connexion Google récente (voir Conséquences).

## Liens

- [ADR-0012](ADR-0012-modele-rbac-complet.md) — RBAC (amendé : seizième action) ;
  [ADR-0013](ADR-0013-stockage-secrets-integration.md) — coffre, test avant écriture,
  ré-authentification ; [ADR-0017](ADR-0017-interrupteur-integrations.md) — un
  interrupteur qui interrompt vraiment.
- [ADR-0018](ADR-0018-trajectoire-erp-trois-modules.md) — trajectoire ERP ;
  [ADR-0019](ADR-0019-facture-normalisee-dgi-rdc.md) — facture normalisée ;
  [ADR-0020](ADR-0020-ordonnanceur-mongodb.md) — ordonnanceur ;
  [ADR-0016](ADR-0016-navigation-applicative.md) — navigation.
- [docs/09](../09-COUNTRY-PACKS.md) — versions de pack ; [docs/12](../12-ROLES-PERMISSIONS.md) ;
  [docs/sources/dgi-rdc](../sources/dgi-rdc/README.md) — spécification e-DEF publique.
- Code : `apps/api/src/integrations/`, `apps/api/src/authz/`,
  `apps/api/src/organization-space/`, `apps/api/src/plans/fingerprint.ts`,
  `packages/engine/src/parameter-packs/`, `apps/web/src/app/(app)/organisation/`.
