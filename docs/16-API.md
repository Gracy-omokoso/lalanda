# API

**Statut :** Draft  
**Version :** 0.1

## Principes

- API versionnée;
- contrats typés et documentés;
- validation stricte;
- erreurs stables;
- pagination par curseur;
- idempotence pour calculs, imports, paiements et exports;
- autorisation côté serveur;
- identifiant de corrélation.

## Ressources principales

```text
/v1/organizations
/v1/organizations/{id}/members
/v1/projects
/v1/projects/{id}/canvas
/v1/projects/{id}/objectives
/v1/projects/{id}/scenarios
/v1/scenarios/{id}/inputs
/v1/scenarios/{id}/calculations
/v1/plans/{id}
/v1/projects/{id}/actual-periods
/v1/projects/{id}/analytics
/v1/projects/{id}/reports
/v1/country-packs
/v1/admin/country-packs
/v1/subscriptions
/v1/audit-events
```

## Calcul

`POST /v1/scenarios/{id}/calculations`

Entrée : version d’entrées, granularité, clé d’idempotence.  
Sortie : tâche ou résultat, version moteur, avertissements et identifiant.

Le serveur refuse une version obsolète ou incohérente.

## Validation du plan

`POST /v1/calculations/{id}/approve`

Exige la permission, une confirmation des avertissements autorisés et crée un plan immuable.

## Imports

1. créer un lot;
2. envoyer le fichier;
3. prévisualiser le mapping;
4. valider;
5. traiter;
6. consulter erreurs et résultats;
7. annuler le lot si possible.

## Erreurs

```json
{
  "error": {
    "code": "INPUT_VALIDATION_FAILED",
    "message": "Certaines données sont invalides.",
    "details": [],
    "correlationId": "..."
  }
}
```

Les messages ne divulguent ni secrets ni ressources d’une autre organisation.

## Copilote IA — actions correctives (S14a)

`POST /ai/corrective-actions`

Entrée :

```json
{
  "templateSlug": "prestation-services",
  "drivers": { "prix_jour": 500 },
  "devise": "USD",
  "lines": [
    {
      "sheetId": "ratios",
      "lineId": "dscr",
      "label": "DSCR (couverture du service de la dette)",
      "value": 0.9,
      "format": "number",
      "seuil": { "valeur": 1.25, "direction": "min", "statut": "rouge" }
    }
  ]
}
```

Sortie :

```json
{
  "source": "fallback",
  "actions": [
    {
      "ratio": "dscr",
      "severity": "rouge",
      "suggestion": "Réduire le service de la dette ou renforcer l'EBE …",
      "expected_impact": "Amener le DSCR à au moins 1,25 (actuellement 0,90)."
    }
  ]
}
```

Contraintes :

- l’IA ne recalcule rien et ne modifie aucune feuille officielle;
- 0 à 4 actions retournées, priorisées rouge → orange;
- fallback déterministe automatique si `OPENAI_API_KEY` est absente ou si la
  réponse du LLM est invalide;
- le champ `source` vaut `"llm"` ou `"fallback"` pour tracer l’origine.

## Espace compte — implémenté (S20b)

`apps/api/src/account/`. Écrans correspondants : docs/04 § Implémenté (S20b).

```text
GET    /account/profile                 identité + langue + fuseau + demande d'email en attente
PUT    /account/profile                 nom affiché, langue, fuseau
GET    /account/preferences             thème, devise par défaut, notifications, valeurs acceptées
PUT    /account/preferences             écriture des mêmes (remplacement total)
GET    /account/sessions                sessions actives, la courante marquée
DELETE /account/sessions/{id}           révocation d'une session
POST   /account/sessions/revoke-others  révocation de toutes les autres
GET    /account/email/change            demande de changement en attente
POST   /account/email/change            ouvre une demande — 202, changement NON appliqué
DELETE /account/email/change            annule la demande
GET    /account/deletion                éligibilité à la suppression
POST   /account/delete                  suppression définitive
POST   /account-email/verify            applique un changement depuis son token
```

**Portée par la session, sans organisation.** Le propriétaire des données est toujours l’utilisateur de la session : aucune route n’accepte d’identifiant d’utilisateur, ni en URL, ni en query, ni dans le corps. Les schémas zod sont `.strict()`, si bien qu’un `userId` glissé dans un corps produit `400 INVALID_REQUEST` au lieu d’être ignoré en silence — un champ ignoré donnerait un `200` trompeur.

Ces routes passent par `AccountAuthGuard` et non `AuthGuard` : elles résolvent la session sans exiger d’organisation active (ADR-0012 §9). C’est ce qui rend l’espace compte joignable pour un utilisateur sans organisation.

**Sessions.** Le `token` d’une session vaut le cookie de connexion : il ne sort jamais de l’API. La liste n’expose qu’un `id` opaque et la révocation résout `id → token` côté serveur. Un `id` appartenant à un autre utilisateur est simplement introuvable dans la liste de l’appelant → `404 SESSION_NOT_FOUND`.

**Codes d’erreur propres à cet espace** : `400 INVALID_PASSWORD`, `400 EMAIL_MISMATCH`, `400 EMAIL_UNCHANGED`, `400 INVALID_TOKEN`, `404 SESSION_NOT_FOUND`, `409 EMAIL_TAKEN`, `409 LAST_OWNER`.

**Livraison du lien de vérification (mis à jour en S22a).** `POST /account/email/change` répond toujours `202` : la demande est *acceptée*, le changement n’est **pas** appliqué — l’adresse ne bouge qu’à la présentation du jeton. Depuis S22a (ADR-0014), le lien part réellement par email **si un SMTP est configuré**, vers la nouvelle adresse, et atterrit sur la page publique `/verification-email` qui appelle `POST /account-email/verify`.

`pending.verificationDelivered` ne vaut `true` que si l’envoi a **réellement** abouti ; sinon il reste `false` avec un `reason` lisible (`EMAIL_NON_DELIVRE`) — sans SMTP, ou sur échec d’envoi. Marquer l’envoi comme fait dès qu’on a appelé la fonction d’envoi reviendrait à afficher « consultez votre boîte » à quelqu’un qui ne recevra jamais rien. L’alternative — appliquer le changement sans vérification — ouvrirait un chemin de prise de compte (docs/17 § Menaces prioritaires) : elle reste refusée.

## Authentification — moyens de connexion (S22a)

`apps/api/src/auth/`. Détail et arbitrages : ADR-0014.

```text
GET  /auth-providers                 { "google": true|false } — public, aucun secret
POST /auth/sign-in/social            better-auth — { provider: "google", callbackURL }
GET  /auth/callback/google           better-auth — URI de redirection à déclarer chez Google
POST /auth/request-password-reset    better-auth — { email } → 200 TOUJOURS
POST /auth/reset-password            better-auth — { newPassword, token }
POST /auth/verify-email              better-auth — vérification d'adresse à l'inscription
```

**`GET /auth-providers` est la source de vérité unique du bouton Google.** La page de connexion l’interroge et n’affiche le bouton que si `google` vaut `true`. Une variable `NEXT_PUBLIC_*` côté web serait une seconde source de vérité, et la panne qui en découle est toujours la même : un bouton affiché vers un fournisseur non configuré. La route ne renvoie qu’un booléen — ni `clientId`, ni secret.

**`POST /auth/request-password-reset` répond `200` et le MÊME corps que l’adresse existe ou non.** C’est la règle de non-énumération : un formulaire qui répond « adresse inconnue » devient un annuaire des comptes. better-auth simule la génération du jeton et la lecture en base pour ne pas se trahir non plus par son temps de réponse. L’interface ne rattrape pas cette uniformité : elle passe à l’écran de confirmation dès que la requête aboutit.

**Le jeton de réinitialisation est à usage unique et expire en 30 minutes** ; la réinitialisation révoque toutes les sessions de l’utilisateur. Sans SMTP configuré, la route répond quand même `200` — le service d’envoi existe toujours, c’est son transport qui se replie sur un log serveur.

**Sans `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`**, `GET /auth-providers` renvoie `{ "google": false }` et `POST /auth/sign-in/social` répond `404 PROVIDER_NOT_FOUND` — une erreur métier lisible, pas une exception.

## Espace organisation — implémenté (S21a)

`apps/api/src/organization-space/`. Écrans correspondants : docs/04 § Implémenté (S21a).

```text
GET  /organizations/current/dashboard   tableau de bord différencié — analytics.read
GET  /organizations/current/settings    identité + devise d'affichage + logo — organization.manage
PUT  /organizations/current/settings    écriture des mêmes — organization.manage
GET  /organizations/current/billing     offre, consommation, dépassements — billing.manage
GET  /audit-events?action=&limit=       journal filtrable + vocabulaire servi — audit.read
```

`current` = l’organisation active résolue par `AuthGuard` (cookie `active_org_id` ou organisation primaire), convention déjà posée par `GET /organizations/current/subscription` (S16b). **Aucune route n’accepte d’identifiant d’organisation** : un cookie forgé désignant une autre organisation retombe sur celle de l’appelant, il ne l’ouvre pas.

**Un endpoint, un contenu par rôle.** `GET /dashboard` est gardé par `analytics.read`, que les huit rôles détiennent : l’espace doit être utile à un Lecteur, pas lui renvoyer un 403 à la porte. Le filtrage se fait **bloc par bloc** dans le service, à partir de la même matrice (`can()`, ADR-0012 §8) :

| `sections.*` | Action qui l’ouvre | Contenu |
|---|---|---|
| `gouvernance` | `organization.manage` | projets, plans validés du mois, membres actifs, consommation |
| `validation` | `plan.approve` | ratios au rouge, plans en attente, écarts défavorables |
| `comptabilite` | `actuals.import` | périodes à saisir, à clôturer, anomalies |
| `projets` | `project.read` | projets et dernières validations |

Un bloc fermé vaut `null` et **n’est jamais chargé** — pas de requête, donc pas de fuite par temps de réponse ni par taille de payload. `masque[]` le déclare en clair : section, action, raison, **aucune donnée**. Le service n’écrit aucun `if (role === …)` ; il n’ajoute donc aucune règle à la matrice.

**Agrégation, jamais calcul.** Les feux tricolores viennent des snapshots de plans validés, les écarts de `computeVariances`, les limites du catalogue d’entitlements. Le moteur reste l’unique source de vérité (CLAUDE.md). Les agrégations coûteuses sont bornées aux 20 projets les plus récemment modifiés : un tableau de bord répond vite et donne l’essentiel, l’exhaustivité est du ressort de la page projet.

**Paramètres.** Deux collections, deux responsabilités : `organizations` porte l’identité (nom, pays), `organization_settings` la présentation (devise d’affichage, logo par URL). Le `slug` n’est **pas** régénéré au renommage — il est unique, indexé, et sert d’identifiant stable ; le changer casserait tout lien déjà partagé. `PUT` est total et `.strict()` ; l’écriture est journalisée en mode non bloquant (`record`), avec un métadonnées pauvre : noms avant/après, pays, devise, présence d’un logo — jamais l’URL ni de donnée personnelle (docs/17 § Journalisation).

**Facturation réservée au Propriétaire.** `billing.manage` n’est détenu que par le Propriétaire (ADR-0012 §3, docs/12) : un **Administrateur reçoit un 403**, et c’est la règle, pas un incident. Aucune intégration de paiement (docs/13 § hors périmètre S16b) — la réponse porte `paiement.integre: false` et un message lisible plutôt qu’un chemin de paiement fictif.

**Journal d’audit.** `?action=` filtre sur une action exacte, **appliqué en base** : filtrer les 100 derniers événements côté client ferait disparaître une action rare dès que le journal grossit, ce qui est le contraire d’un journal d’audit. La réponse porte `actions[]`, le vocabulaire réellement présent pour cette organisation — l’interface n’invente pas la liste des filtres. La collection reste append-only (S20a) : aucune route ne modifie ni ne supprime un événement, et les rôles de saisie n’ont pas accès au journal qui les surveille.

**Codes d’erreur propres à cet espace** : `400 INVALID_REQUEST`, `403 FORBIDDEN`, `403 NO_ORGANIZATION`, `404 ORG_NOT_FOUND`.

## Abonnements et paiements — implémenté (S22b)

`apps/api/src/billing/` et `apps/api/src/payments/`. Règles métier : docs/13 § Implémenté (S22b).

```text
GET  /organizations/current/subscription        état complet du cycle de vie — analytics.read
POST /organizations/current/subscription/trial  essai 14 jours, sans carte — billing.manage
GET  /organizations/current/subscription/quote  chiffrage d'un changement — billing.manage
POST /organizations/current/subscription/plan   baisse de gamme programmée — billing.manage
POST /organizations/current/subscription/cancel résiliation — billing.manage
POST /payments/checkout                         ouvre un encaissement — billing.manage
GET  /payments/methods                          moyens réellement disponibles — PUBLIC
POST /payments/webhooks/:provider               rappel fournisseur — SIGNATURE
GET  /payments/manual/pending                   dépôts à confirmer — rôle plateforme
POST /payments/manual/:reference/confirm        confirme un dépôt reçu — rôle plateforme
POST /payments/manual/:reference/reject         refuse, motif obligatoire — rôle plateforme
POST /payments/maintenance/sweep                balayage des échéances — rôle plateforme
```

**`plan` répond le plan EFFECTIF, pas le plan souscrit.** C'est un changement de
sémantique par rapport à S16b, pas de forme : une organisation Business suspendue
pour impayé doit être vue comme `free` par tout ce qui applique une limite.
`subscribedPlan` porte l'autre valeur, pour l'affichage. Les champs S16b
(`plan`, `entitlements`, `usage`) restent à leur place — rompre le contrat de la
route qui décide de l'accès payant n'aurait aucune justification.

**Le montant n'est jamais lu depuis la requête.** `POST /payments/checkout` ne
reçoit que l'intention (offre, périodicité, moyen) ; le montant est recalculé à
partir du catalogue et du prorata. L'accepter depuis le corps permettrait de
souscrire Business à un centime.

**Une montée en gamme ne passe pas par `/subscription/plan`.** Cette route ne
programme que des baisses ; une montée y est refusée
(`409 UPGRADE_REQUIRES_PAYMENT`). L'autoriser donnerait Business à qui sait
envoyer un POST.

**Trois régimes d'accès dans un même contrôleur**, et c'est pourquoi
`PaymentsController` n'a pas de garde de classe : les rappels sont authentifiés
par **signature**, `GET /payments/methods` est public, et l'administration
manuelle exige un **rôle plateforme** — jamais `billing.manage`, qui appartient
au Propriétaire de l'organisation et lui permettrait de confirmer ses propres
paiements.

**Codes d'erreur propres à cet espace** : `409 TRIAL_ALREADY_USED`,
`409 SUBSCRIPTION_ACTIVE`, `409 PLAN_NOT_SELLABLE`, `409 UPGRADE_REQUIRES_PAYMENT`,
`409 ALREADY_CANCELED`, `400 DOWNGRADE_NOT_PAYABLE`, `400 WEBHOOK_RAW_BODY_MISSING`,
`400 WEBHOOK_SIGNATURE_INVALID`, `404 UNKNOWN_WEBHOOK_PROVIDER`,
`404 MANUAL_REQUEST_NOT_FOUND`, `400 MANUAL_REQUEST_CLOSED`,
`400 MANUAL_REQUEST_EXPIRED`, `400 REJECTION_NOTE_REQUIRED`,
`503 PAYMENT_PROVIDER_UNAVAILABLE`.

## Webhooks

Paiements et intégrations utilisent signatures, tolérance temporelle, anti-rejeu, journal et traitement idempotent.

**Implémenté (S22b)** — `POST /payments/webhooks/:provider`, `manual` exclu (il
n'a pas de rappel : une route de rappel manuel serait un point d'entrée non
authentifié capable d'accorder un abonnement).

1. **Signature d'abord.** Vérifiée avant toute lecture du corps, sur le corps
   **brut** (`rawBody: true` au bootstrap ; sans lui, la route répond
   `400 WEBHOOK_RAW_BODY_MISSING` plutôt que d'accepter à l'aveugle). Comparaison
   en temps constant, tolérance d'horodatage de 5 minutes dans les deux sens.
   Sans secret configuré : **503**, jamais une acceptation.
2. **Idempotence ensuite.** Index unique `{provider, eventId}` sur
   `payment_events`, l'insertion faisant office de verrou. L'ordre compte :
   dédupliquer avant de vérifier laisserait un inconnu écrire en base et
   **pré-empter** l'identifiant d'un vrai événement, qui serait ensuite ignoré
   comme doublon — un déni de service silencieux sur l'encaissement.
3. **Rattachement.** Métadonnées, puis jointure exacte
   `subscriptions.{provider, providerSubscriptionId}`. Aucun rapprochement par
   email ni par proximité : un rappel non rattachable reste orphelin
   (`status: 'unmatched'`, trace `failed`) et n'accorde rien.
4. **Réponses.** `200 { received: true, status }` avec `status` ∈
   `processed | duplicate | ignored | unmatched`. Seule une signature invalide
   produit un **400** : tout fournisseur retente ce qui n'est pas 2xx, et
   répondre 500 sur un événement inconnu déclenche trois jours de réémissions
   avant désactivation du point d'entrée.
5. **Journal.** Chaque événement traité est écrit dans `audit_events` avec
   `actorUserId: 'system'`.

## API publique

Réservée aux offres compatibles. Clés à portée limitée, rotation, quotas, journal d’utilisation et documentation séparée. Aucune API publique avant stabilisation des contrats internes.
