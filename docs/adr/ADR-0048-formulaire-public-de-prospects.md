# ADR-0048 — Formulaire public de prospects (web-to-lead) : un formulaire par organisation, désactivé par défaut, consentement explicite, anti-abus sans CAPTCHA tiers

Statut : Proposed

> **3 nov. 2026 — décisions ouvertes tranchées par [ADR-0054](ADR-0054-decisions-du-3-novembre.md)** (valeurs par défaut gardées sauf mention contraire, à revoir avec le juriste et l'expert-comptable).

Date : 2026-11-01
Décideurs : Gracy Omokoso (dirigeante) — consigne du 1er nov. 2026 : « continue tous les
chantiers » ; CTO Lalanda (contrat technique). Le cadrage est **proposé** : chaque choix qui
appartient à la dirigeante porte une valeur par défaut **prudente**, appliquée tant qu'elle ne
tranche pas autrement (§ Décisions ouvertes). Le formulaire est **désactivé par défaut** pour
chaque organisation : rien n'est exposé tant qu'un détenteur de `crm.manage` ne l'a pas créé,
réglé puis activé.

> **Réalise le lot futur C-F d'[ADR-0040](ADR-0040-crm-complet.md)** (§ Hors périmètre,
> décision ouverte n° 15 : « Formulaire public de capture de prospects… à cadrer par un ADR »).
> **N'amende ni ADR-0012 ni docs/12** : aucune action ni aucun rôle nouveau ; les réglages
> relèvent de `crm.read` / `crm.manage`. **Ajoute une surface publique** (sans session) à
> l'API et au web : docs/17 et docs/28 sont mis à jour.

## Contexte

Le CRM (ADR-0035, ADR-0040) ne reçoit des prospects que par saisie ou import CSV. Une
organisation qui a un site, une page Facebook ou une carte de visite n'a aucun moyen de recueillir
une demande de contact directement dans Lalanda : elle recopie des e-mails à la main, et perd ce
qui arrive pendant qu'elle est occupée.

Faits du dépôt qui commandent les décisions :

- L'API n'a qu'une poignée de routes sans session, toutes justifiées une à une dans
  `apps/api/src/authz/routes-coverage.test.ts` (`SANS_PERMISSION`) : sonde, jetons signés
  (avatar, logo), vérification d'e-mail, rappels de paiement. Le patron « le jeton fait
  autorité » existe déjà (invitations, vérification d'e-mail).
- La limitation de débit est en mémoire du processus (`ThrottlerModule`, une instance d'API) ;
  le garde global compte 100 requêtes par minute et par IP **cliente réelle** (`trust proxy = 1`,
  S22f). Des gardes dédiés existent pour la normalisation DGI et l'envoi d'e-mails (ADR-0024,
  ADR-0042) : même patron ici.
- Les jetons signés dérivent leur clé d'`AUTH_SECRET` par HKDF avec une étiquette propre
  (`branding/brand-asset-url.ts`) : même patron pour le ticket de remplissage et l'empreinte d'IP.
- Les comptes prospects (`crm_accounts`, `origin` libre ≤ 80), les contacts (`crm_contacts`,
  `email` en minuscules, index `{ organizationId, email }`), les activités assignées
  (`crm_activities.assigneeUserId`, membre détenant `crm.manage` sur ses droits **effectifs**,
  ADR-0041) et la notification `crm.activity_assigned` existent (ADR-0040 C1, C4).
- La CSP du web interdit d'être affiché dans un cadre (`frame-ancestors 'none'`, S16a).

## Options considérées

### O1 — Où vit la page publique ?

- **A. Page hébergée par Lalanda, `/f/<jeton>`** — **retenu**. Même origine que l'application
  (CORS inchangé), CSP et en-têtes de sécurité appliqués, mise en page maîtrisée et accessible.
- B. Un script à coller dans le site de l'organisation, qui poste vers l'API depuis une autre
  origine : il faudrait ouvrir le CORS de l'API à toute origine pour cette route, et l'apparence
  dépendrait du site hôte. Refusé à ce stade.
- C. Un `<iframe>` : impossible sans assouplir `frame-ancestors 'none'` (protection contre le
  détournement de clic). Refusé à ce stade (décision ouverte n° 6).

L'« extrait à copier » est donc un **lien** HTML (bouton) vers la page hébergée.

### O2 — Un ou plusieurs formulaires par organisation ?

Un seul en R2-N1 : il couvre le besoin (« Contactez-nous ») et garde l'écran simple. Le modèle
(`crm_lead_forms`, index unique `organizationId`) permet d'en ouvrir plusieurs plus tard sans
migration des soumissions, qui portent déjà `formId` (décision ouverte n° 1).

### O3 — Jeton : secret haché ou valeur en clair ?

Le jeton est **publié** (il figure dans un lien affiché sur un site public) : ce n'est pas un
secret d'authentification, c'est un identifiant non devinable et révocable. Le hacher obligerait
à ne le montrer qu'une fois, alors que l'organisation doit pouvoir recopier son lien à tout
moment. **Retenu : en clair**, 24 octets aléatoires en base64url (32 caractères, 192 bits),
index unique, **remplaçable** (« Générer un nouveau lien ») : l'ancien lien répond 404 à
l'instant.

### O4 — Anti-abus sans CAPTCHA tiers

Un CAPTCHA tiers (Google, hCaptcha, Cloudflare) envoie l'adresse IP et des signaux du navigateur
du visiteur à un tiers, exige un bandeau de consentement supplémentaire et gêne les connexions
lentes. **Refusé.** Cinq défenses cumulées, toutes côté serveur :

1. **Champ piège** invisible (`website`), hors de la vue et du parcours clavier
   (`aria-hidden`, `tabindex=-1`, `autocomplete=off`) : rempli ⇒ réponse **identique** à un
   succès, rien n'est créé (le robot n'apprend rien).
2. **Délai minimal de remplissage** : la lecture de la configuration rend un **ticket** signé
   (HMAC, clé dérivée d'`AUTH_SECRET`) qui scelle l'identifiant du formulaire et l'instant
   d'émission ; une soumission moins de **3 secondes** après, ou plus de **2 heures** après, ou
   sans ticket valide, est refusée (`400 LEAD_FORM_TOO_FAST`, `400 LEAD_FORM_TICKET_INVALID`).
3. **Limite de débit** par IP (toutes les pages réunies) **et** par formulaire (§ 6).
4. **Tailles maximales** de chaque champ, corps JSON `.strict()` (toute clé inconnue : 400),
   corps borné par l'API (100 Ko).
5. **Aucune pièce jointe** : la route n'accepte que du JSON ; aucun champ fichier n'existe.

## Décision

### 1. Vocabulaire

| Interface (français) | Code | Collection |
|---|---|---|
| Formulaire public, formulaire de prospects | `CrmLeadForm` | `crm_lead_forms` (nouvelle) |
| Lien public, jeton | `token` | dans `crm_lead_forms` |
| Soumission, demande reçue | `CrmLeadSubmission` | `crm_lead_submissions` (nouvelle) |
| Ticket de remplissage | `ticket` | jamais stocké |
| Empreinte d'IP | `ipHash` | dans `crm_lead_submissions`, journaux |
| Responsable des demandes | `assigneeUserId` | dans `crm_lead_forms` |

### 2. Modèle de données

#### 2.1 `crm_lead_forms` (une par organisation)

| Champ | Règle |
|---|---|
| `organizationId` | index **unique** (O2) |
| `token` | 32 caractères `[A-Za-z0-9_-]`, aléatoire, index **unique** ; remplacé par `rotate-token` |
| `tokenRotatedAt` | `null` ou l'instant du dernier remplacement |
| `enabled` | **`false` à la création** ; passer à `true` exige les conditions du § 2.3 |
| `title` | 1 à 120 ; défaut « Contactez-nous » |
| `intro` | 0 à 500, texte brut |
| `fields` | exactement six entrées, une par clé de la **liste fermée** `name`, `company`, `email`, `phone`, `message`, `source` : `{ key, enabled, required, label (null = libellé par défaut, ≤ 80) }` ; `name` toujours affiché et obligatoire ; au moins un moyen de recontacter (`email` ou `phone`) affiché **et** obligatoire ; un champ non affiché n'est jamais obligatoire |
| `consentText` | 20 à 1 000 ; défaut proposé (§ 4) |
| `privacyPolicyUrl` | `null` ou une URL `https://` ≤ 500 ; **obligatoire pour activer** |
| `successMessage` | 1 à 300 ; défaut « Merci, votre demande a bien été reçue. Nous vous recontactons rapidement. » |
| `assigneeUserId` | `null` ou un membre détenant `crm.manage` (droits effectifs) ; **obligatoire pour activer** |
| `createOpportunity` | **`false`** par défaut (§ 3) |
| `opportunityCurrency` | `USD` (défaut) ou `CDF` ; lu seulement si `createOpportunity` |
| `showBranding` | `true` par défaut : logo et couleur principale de l'identité visuelle (ADR-0028) sur la page, s'il y a un logo |
| `revision`, `createdBy`, `updatedBy`, horodatages, `_schemaVersion` | motif commun ; `expectedRevision` → `409 STALE_REVISION` |

#### 2.2 `crm_lead_submissions` (preuve du consentement)

Une ligne par soumission **acceptée** : `organizationId`, `formId`, `contactId`, `accountId`,
`activityId`, `opportunityId` (ou `null`), `duplicate` (e-mail déjà connu), `consent { text,
policyUrl, acceptedAt }` (copie du texte **affiché**), `ipHash`, `createdAt`. Aucune IP en clair,
aucun en-tête du navigateur, aucune copie du message (il est dans l'activité). Index
`{ organizationId, createdAt }`, `{ organizationId, formId, createdAt }`.

#### 2.3 Activer

`PUT /crm/lead-form` avec `enabled: true` est refusé (`400 INVALID_REQUEST`, le code du champ
fautif dans `details.issues`) tant que : `privacyPolicyUrl` est absente
(`LEAD_FORM_POLICY_REQUIRED`), `assigneeUserId` est absent (`LEAD_FORM_ASSIGNEE_REQUIRED`) ou
n'est pas éligible (`CRM_ASSIGNEE_NOT_ELIGIBLE` ; membre d'une autre organisation :
`404 CRM_MEMBER_NOT_FOUND`), ou les règles des champs du § 2.1 ne tiennent pas
(`LEAD_FORM_NAME_REQUIRED`, `LEAD_FORM_CONTACT_REQUIRED`, `LEAD_FORM_FIELD_NOT_ENABLED`). Le texte
de consentement (20 à 1 000 caractères) est exigé à tout enregistrement.

### 3. Ce que crée une soumission

Dans l'organisation du jeton, et seulement là :

1. **Doublon par e-mail** : si l'e-mail saisi (minuscules) est celui d'un contact de
   l'organisation, ce contact et son compte sont **réutilisés** ; **rien n'est réécrit** (un
   visiteur anonyme ne modifie jamais une fiche existante). La réponse publique est la même
   qu'une première demande (aucune énumération possible).
2. Sinon : un **compte prospect** (`crm_accounts`, `kind: 'prospect'`) nommé d'après
   l'entreprise saisie, à défaut d'après la personne, `origin: 'formulaire'`, responsable = le
   responsable des demandes ; puis un **contact** rattaché (nom, e-mail, téléphone), note
   « Arrivé par le formulaire public le AAAA-MM-JJ ».
3. Une **activité « à traiter »** : `follow_up`, sujet « Demande reçue par le formulaire :
   <nom> », notes = message et source, échéance = l'instant de réception (elle figure
   **aujourd'hui** dans « Mes tâches », la cloche et le brief du responsable), assignée au
   responsable des demandes.
4. **Jamais d'opportunité automatique**, sauf si `createOpportunity` est vrai : alors une
   opportunité ouverte (première étape `open`), sans montant, dans `opportunityCurrency`,
   responsable = le responsable des demandes, titre « Demande de <entreprise ou nom> ».
5. La ligne de preuve `crm_lead_submissions` et une entrée d'audit
   `crm.lead_form.submission_accepted` (métadonnées : `formId`, `submissionId`, `duplicate`,
   `ipHash` ; aucune donnée saisie).

Auteur technique des écritures : `system:crm-lead-form`. Si le responsable n'est plus éligible au
moment de la soumission (rôle changé depuis l'activation), le compte est créé sans responsable et
l'activité **sans échéance ni assigné** (elle reste dans la liste des activités du CRM), sans
opportunité automatique ; le formulaire n'est pas coupé — la demande ne doit pas être perdue.

### 4. Consentement

- Case à cocher **non cochée** par défaut, obligatoire (`consent: true`, sinon
  `400 INVALID_REQUEST` avec l'issue `LEAD_FORM_CONSENT_REQUIRED`), libellé = `consentText` de l'organisation, suivi du lien
  « Politique de confidentialité » vers `privacyPolicyUrl` (nouvel onglet,
  `rel="noopener noreferrer"`).
- Texte par défaut proposé : « J'accepte que les informations saisies soient utilisées pour me
  recontacter au sujet de ma demande. Elles ne sont ni vendues ni cédées à des tiers. »
- Mention fixe sous le bouton : « Formulaire hébergé par Lalanda pour le compte de
  l'organisation destinataire. »
- Le texte effectivement affiché est **copié** dans la preuve (§ 2.2) : changer le texte plus
  tard ne réécrit pas le passé.
- **L'organisation est responsable du traitement** de ces données ; Lalanda les héberge et les
  traite pour son compte (docs/28 § 2.7).

### 5. Contrat HTTP

#### 5.1 Réglages (authentifiés) — `CrmLeadFormsController`

`@UseGuards(AuthGuard, PermissionsGuard)` ; organisation active seulement.

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /crm/lead-form` | `crm.read` | `{ form: CrmLeadFormView \| null }` (lien, réglages, nombre de demandes reçues et dernière date) |
| `POST /crm/lead-form` | `crm.manage` | crée le formulaire, **désactivé** ; `409 LEAD_FORM_EXISTS` |
| `PUT /crm/lead-form` | `crm.manage` | réglages complets + `enabled`, `expectedRevision` ; § 2.3 |
| `POST /crm/lead-form/rotate-token` `{ expectedRevision }` | `crm.manage` | nouveau lien, l'ancien répond 404 |

Audit : `crm.lead_form.created`, `crm.lead_form.updated` (avec `enabled`), `crm.lead_form.token_rotated`.

#### 5.2 Routes publiques — `PublicLeadFormsController`

**Sans session, sans cookie, sans permission** ; isolées par le jeton ; inscrites, avec leur
justification, dans `SANS_PERMISSION` de `routes-coverage.test.ts`.

| Méthode et chemin | Effet |
|---|---|
| `GET /public/lead-forms/:token` | `{ title, intro, fields: [{ key, label, required, maxLength }], consent: { text, policyUrl }, successMessage, branding: { logoUrl, color } \| null, ticket }` |
| `POST /public/lead-forms/:token/submissions` | corps `{ ticket, consent, name?, company?, email?, phone?, message?, source?, website? }` → `201 { status: 'received', message }` |

- Jeton inconnu, formulaire **désactivé** ou jeton **remplacé** : **`404 LEAD_FORM_NOT_FOUND`**,
  même corps dans les trois cas.
- **Rien d'autre n'est exposé** que le titre, l'introduction, les libellés, le texte de
  consentement, le lien de politique, le message de remerciement et, si `showBranding`, l'URL
  signée du logo (24 h) et la couleur principale. Ni nom d'organisation, ni identifiant interne,
  ni responsable.
- Champ obligatoire manquant, e-mail ou téléphone invalide, texte trop long, clé inconnue :
  `400 INVALID_REQUEST` (détails par champ). Champ non affiché mais envoyé : ignoré s'il est
  vide, sinon `400`.

### 6. Anti-abus

| Défense | Valeur par défaut |
|---|---|
| Champ piège `website` | rempli ⇒ `201` identique, rien créé, journal `honeypot` |
| Délai minimal | 3 s entre la lecture de la configuration et l'envoi ; ticket valable 2 h |
| Débit par IP (tous formulaires) | **5 envois par 10 minutes** ⇒ `429 LEAD_FORM_RATE_LIMITED` |
| Débit par formulaire | **60 envois par heure** ⇒ `429 LEAD_FORM_RATE_LIMITED` |
| Débit global | 100 requêtes par minute et par IP (existant) |
| Tailles | nom 120, entreprise 200, e-mail 254, téléphone 30, message 2 000, source 120 |
| Pièces jointes | aucune (JSON seulement) |

Le débit est compté **avant** toute lecture de la base, sur l'**empreinte** de l'IP, jamais sur
l'IP en clair (même en mémoire, la clé du seau est l'empreinte). Stockage du `ThrottlerModule`,
en mémoire du processus (une instance d'API).

### 7. Journalisation sans IP en clair

- **Empreinte salée** : `HMAC-SHA256(clé dérivée d'AUTH_SECRET par HKDF, étiquette
  « lalanda/lead-form-ip »)`, 32 caractères hexadécimaux. Elle permet de relier deux envois
  d'une même source pendant la vie de la clé, jamais de retrouver l'adresse.
- La journalisation HTTP automatique (pino-http, qui écrit l'adresse distante) est **coupée**
  pour les routes `/public/lead-forms/*` ; le service écrit lui-même une ligne par refus (`honeypot`,
  `too_fast`, `ticket_invalid`) avec l'empreinte et l'identifiant du formulaire, sans donnée saisie.
- La base ne reçoit que l'empreinte (`crm_lead_submissions.ipHash`, audit).

### 8. Notifications

Aucun type nouveau : l'activité créée émet **`crm.activity_assigned`** au responsable des demandes
(motif d'ADR-0040 § 5.4 ; l'auteur technique n'étant pas un membre, le responsable est toujours
notifié), titre « Relance à faire : Demande reçue par le formulaire : <nom> », lien vers
l'activité. Les rappels `crm.activity_due_soon` / `crm.activity_overdue` et le brief (R10)
s'appliquent ensuite comme à toute relance.

### 9. Interface (web)

- **`/f/[token]`** : hors de l'application (aucune coquille, aucune session), `noindex`, une
  colonne lisible sur téléphone, libellés visibles, erreurs par champ reliées (`aria-describedby`),
  message d'état annoncé (`role="status"`), bouton désactivé pendant l'envoi ; logo et couleur de
  l'organisation si `branding` est rendu, sinon la charte Lalanda sobre. `lib/routes.ts` déclare le
  préfixe `/f` **public** : ni protégé, ni marketing (un membre connecté qui l'ouvre n'est pas
  renvoyé vers `/accueil`).
- **`/crm/reglages`** : panneau « Formulaire public ». Sans formulaire : bouton « Créer le
  formulaire » qui ouvre une **fenêtre modale** (titre, responsable, texte de consentement, lien
  de politique) ; le formulaire naît désactivé. Ensuite : lien à copier, extrait HTML à copier,
  champs (affiché, obligatoire, libellé), consentement, responsable, opportunité automatique,
  identité visuelle, interrupteur « Activé », « Générer un nouveau lien » (confirmation). Lecture
  seule sans `crm.manage`.

## Hors périmètre, dit explicitement

- Plusieurs formulaires par organisation ; champs libres hors de la liste fermée ; choix
  multiples ; pièces jointes.
- Intégration par `<iframe>` ou script tiers (CORS et CSP inchangés).
- E-mail d'accusé de réception au visiteur (le domaine d'envoi est celui des documents de vente,
  ADR-0042 ; un envoi déclenché par un anonyme serait un vecteur de pourriel).
- Score, qualification ou routage automatique ; l'IA ne lit pas les demandes.
- CAPTCHA tiers.

## Conséquences

- Deux collections nouvelles (`crm_lead_forms`, `crm_lead_submissions`), portant
  `organizationId`. Aucune migration.
- Module nouveau `CrmLeadFormsModule` (`apps/api/src/crm/lead-forms/`), une ligne dans
  `app.module.ts` ; `CrmModule` exporte en plus `ContactsService` et `ActivitiesService`.
- Deux routes publiques dans `SANS_PERMISSION`, quatre routes authentifiées dans le bloc
  `attendu` de `routes-coverage.test.ts`.
- `@lalanda/shared/crm` gagne `lead-forms.ts` (contrat, bornes, validation partagée).
- Web : page publique `/f/[token]`, préfixe public dans `lib/routes.ts`, panneau de réglages.
- Surface publique nouvelle : docs/17 ; traitement « prospects entrants » : docs/28.

## Critères d'acceptation (testables)

1. Un jeton inconnu, ou un formulaire désactivé : `GET` et `POST` publics
   rendent `404 LEAD_FORM_NOT_FOUND`.
2. Après « Générer un nouveau lien », l'ancien jeton rend 404 et le nouveau répond.
3. Champ piège rempli : `201` identique, aucun compte, contact, activité ni preuve créés.
4. Envoi moins de 3 s après la lecture : `400 LEAD_FORM_TOO_FAST` ; ticket forgé ou d'un autre
   formulaire : `400 LEAD_FORM_TICKET_INVALID`.
5. Sixième envoi d'une même IP en 10 minutes : `429 LEAD_FORM_RATE_LIMITED` ; une autre IP passe.
6. Première demande : un prospect `origin: 'formulaire'`, un contact, une activité `follow_up`
   assignée au responsable (notifié), une preuve avec `ipHash` et sans IP en clair ; **aucune
   opportunité**. Deuxième demande au même e-mail (casse différente) : aucun compte ni contact
   nouveau, une activité de plus, `duplicate: true`. Avec `createOpportunity` : une opportunité
   ouverte sans montant.
7. Isolation : la demande arrive dans l'organisation du jeton seulement ; un contact de même
   e-mail dans une autre organisation n'est pas réutilisé ; l'autre organisation ne voit pas le
   formulaire.
8. Droits : `crm.read` lit les réglages ; sans `crm.manage`, créer, modifier, activer, remplacer
   le lien rendent `403`.
9. Activation refusée sans politique de confidentialité, sans responsable, ou avec un responsable
   sans `crm.manage`.
10. Aucune adresse IP en clair dans `crm_lead_submissions` ni `audit_events`.

## Plan de validation

- **Shared (vitest)** : schémas, règles des champs, validation d'une soumission.
- **API unitaires** : ticket (signature, délai, expiration), empreinte d'IP.
- **API e2e** (`crm-lead-forms.e2e.test.ts`) : critères 1 à 10.
- **Couverture des routes** : exceptions publiques justifiées, permissions des quatre routes.
- **Web (vitest)** : modèle du formulaire public et des réglages ; `routes.test.ts` (`/f/*`
  public).
- **Essai de la dirigeante** : créer le formulaire, l'activer, ouvrir le lien sur un téléphone
  non connecté, envoyer une demande, la retrouver dans « Mes tâches » et la cloche du responsable.

## Décisions ouvertes — elles appartiennent à la dirigeante

Chacune a une **valeur par défaut**, appliquée si rien n'est tranché.

1. **Nombre de formulaires** par organisation. *Défaut : un.*
2. **Seuils anti-abus** : 3 s, 5 envois par IP et par 10 minutes, 60 par formulaire et par heure.
   *Défaut : ces valeurs ; un stand de salon sur un seul Wi-Fi peut demander d'élever la limite
   par IP.*
3. **Opportunité automatique**. *Défaut : non ; activable par organisation.*
4. **Conservation des preuves de consentement** (`crm_lead_submissions`). *Défaut : tant que
   l'organisation existe ; une durée (par exemple trois ans) est à fixer avec le juriste
   (docs/28 § 3.1).*
5. **Rotation de la clé d'empreinte d'IP**. *Défaut : stable (dérivée d'`AUTH_SECRET`) ; une
   rotation quotidienne rendrait les empreintes non reliables d'un jour à l'autre, au prix du
   suivi des abus sur plusieurs jours.*
6. **Intégration par `<iframe>`**. *Défaut : non (`frame-ancestors 'none'` conservé) ; l'extrait
   à copier est un lien.*
7. **Identité visuelle sur la page**. *Défaut : affichée si un logo existe (`showBranding: true`),
   désactivable par organisation.*
8. **Accusé de réception par e-mail au visiteur**. *Défaut : non (§ Hors périmètre).*
9. **Offres** (docs/13). *Défaut : ouvert à toutes les offres, comme le CRM.*

Aucune règle fiscale, comptable ou financière n'est introduite par cet ADR.

## Liens

- [ADR-0040](ADR-0040-crm-complet.md) (lot C-F réalisé) ; [ADR-0041](ADR-0041-autorisations-par-membre.md)
  (droits effectifs) ; [ADR-0028](ADR-0028-modeles-de-facture-et-identite.md) (identité
  visuelle) ; [ADR-0042](ADR-0042-envoi-des-documents-par-email.md) (patron des gardes de débit).
- [docs/16](../16-API.md) ; [docs/17](../17-SECURITE.md) ; [docs/28](../28-CONFORMITE-LEGALE.md).
- Code : `apps/api/src/crm/lead-forms/`, `packages/shared/src/crm/lead-forms.ts`,
  `apps/web/src/app/f/[token]/`, `apps/web/src/app/(app)/crm/_components/formulaire-public*.tsx`.
