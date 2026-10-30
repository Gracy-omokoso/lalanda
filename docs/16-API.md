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

## Autorisations par membre — implémenté derrière l'interrupteur (ADR-0041 A4)

`apps/api/src/organizations/` (`members.*`, `invitations.*`, `member-permissions.ts`). Toutes
les écritures sont gardées par `organization.manage` (invitation : `members.invite`), décidées
par `validateOverrides` sur les droits **effectifs** de l'acteur, journalisées strictement
(`member.permissions_changed`, `before` / `after`) **dans la transaction** de l'écriture, et
incrémentent `permissionsRevision`.

```text
PATCH /organizations/:orgId/members/:userId/permissions  { grants, revokes, expectedRevision, reason? }
PATCH /organizations/:orgId/members/:userId/role         { role, grants?, revokes?, expectedRevision?, reason? }
PATCH /organizations/:orgId/members/:userId/close-right  { value, expectedRevision? }
POST  /organizations/:orgId/transfer-ownership           efface l'écart des deux personnes
POST  /organizations/:orgId/invitations                  { email, role?, grants?, revokes? }
POST  /invitations/accept                                revalide l'écart contre l'invitant du moment
GET   /organizations/:orgId/members                      + grants, revokes, effective, customized, permissionsRevision
GET   /authz/catalog                                     domaines, libellés, dépendances, paires, non délégables,
                                                         ligne de chaque rôle, memberPermissionsEnabled (interrupteur)
```

- `…/permissions` remplace l'écart entier ; pour un Comptable, `period.close` écrit
  `canClosePeriods` (absent des deux listes : inchangé). Le changement de titre efface l'écart
  (`member.role_changed` porte `droppedOverrides`) et peut en écrire un nouveau dans le même appel.
- Erreurs : `403 PERMISSION_ESCALATION`, `403 SELF_PERMISSIONS_FORBIDDEN` (aussi sur
  `close-right`), `400 PERMISSION_NOT_DELEGABLE`, `400 PERMISSION_OVERRIDE_REDUNDANT`,
  `400 PERMISSION_DEPENDENCY_MISSING`, `409 SOD_CONFLICT`, `409 OWNER_PERMISSIONS_FIXED`,
  `409 STALE_REVISION`, `404 MEMBER_NOT_FOUND`, `403 INVITATION_INVITER_NO_LONGER_AUTHORIZED`.
- **Interrupteur `MEMBER_PERMISSIONS_ENABLED` éteint** (défaut) : `…/permissions` répond
  `409 MEMBER_PERMISSIONS_DISABLED` ; un écart non vide est refusé de même sur `…/role`, à
  l'invitation et à l'acceptation d'une invitation qui en porte un. Le titre seul fonctionne
  comme avant.
- Le membre concerné reçoit la notification in-app `organization.permissions_changed`
  (« Vos autorisations ont changé », lien `/compte`), interrupteur allumé.

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
## Espace admin plateforme — implémenté (S21b)

`apps/api/src/admin/` et `apps/api/src/integrations/`. Écrans correspondants : docs/04 § Implémenté (S21b). Modèle de rôles : ADR-0012 §4. Stockage des secrets : ADR-0013.

```text
GET    /me/platform-access                       rôles plateforme de l'appelant — toute session
GET    /admin/overview                           compteurs de la plateforme — rôle plateforme
GET    /admin/organizations?q=&limit=            organisations clientes — rôle plateforme
GET    /admin/organizations/:organizationId      détail d'une organisation — rôle plateforme
PATCH  /admin/organizations/:organizationId/plan changement de plan — super_admin | admin
POST   /admin/organizations/:organizationId/suspend   suspension motivée — super_admin | admin
DELETE /admin/organizations/:organizationId/suspend   levée de suspension — super_admin | admin
GET    /admin/users?q=                           comptes — rôle plateforme
POST   /admin/users/:userId/platform-roles       attribution de rôle — super_admin
DELETE /admin/users/:userId/platform-roles/:role retrait de rôle — super_admin
PATCH  /admin/users/:userId/disabled             désactivation — super_admin | admin
GET    /admin/audit-events?action=&actorUserId=  journal PLATEFORME — rôle plateforme
GET    /admin/integrations                       état des 5 fournisseurs — super_admin
GET    /admin/integrations/:provider             état d'un fournisseur — super_admin
PUT    /admin/integrations/:provider[?force]     écriture de secrets et config — super_admin
POST   /admin/integrations/:provider/test        test de connexion — super_admin
DELETE /admin/integrations/:provider/secrets/:name  suppression d'un secret — super_admin
GET    /admin/reauth                             état de la fenêtre de 10 min — super_admin
POST   /admin/reauth                             ouverture de la fenêtre — super_admin
```

**`:organizationId` et non `:orgId`.** Le nom du paramètre est porteur : `PermissionsGuard` traite un `:orgId` de route comme « l’organisation dont il faut résoudre le rôle de l’appelant », et un opérateur de plateforme n’est membre d’aucune organisation cliente. Nommée `:orgId`, la route de changement de plan répondrait `404 ORG_NOT_FOUND` à un super-administrateur parfaitement légitime.

**Trois actions restent refusées à tous les rôles plateforme** — `plan.approve`, `period.close`, `report.export` (ADR-0012 §4). Aucune route d’administration ne les déclare, et `routes-coverage.test.ts` échoue si l’une venait à le faire : une route qui les porterait serait morte (le contrôle la refuserait de toute façon) mais **trompeuse**, car elle promettrait dans `/admin` un pouvoir que la plateforme n’a pas. `GET /me/platform-access` renvoie ces trois actions dans `forbiddenActions[]` pour qu’elles soient **affichées** et non seulement absentes.

**Écriture seule sur les secrets.** Aucun endpoint ne rend une valeur de secret, et il n’en existe pas de désactivé ou de réservé : le contrat n’a pas de forme de lecture. Ce qui circule d’un secret tient en cinq champs — `configured`, `last4`, `updatedAt`, `updatedBy`, `source`. `last4` est un **suffixe** : un préfixe révélerait le type et le mode de la clé (`sk_live_`, `rk_test_`), et vaut `null` sous douze caractères. `configFields[]` et `requiredConfig[]` servent des **noms** de champs, jamais des valeurs, pour que l’interface puisse proposer un champ de configuration encore vide sans recopier le catalogue de `providers.ts`.

**Sémantique de remplacement du `PUT`.** Une clé absente de `secrets` laisse la valeur inchangée, `null` la supprime, une chaîne la remplace. Il n’existe pas de modification partielle d’un secret : la valeur enregistrée n’étant jamais rendue, il n’y a rien à modifier partiellement.

**Test avant enregistrement.** `PUT` exécute le test de connexion du fournisseur **avant** d’écrire. En échec : `422 INTEGRATION_TEST_FAILED` et **rien n’est enregistré**. `?force=true` passe outre — la dérogation est inscrite au journal avec l’identité de son auteur et `lastTest.status` reste `failed`.

**Ré-authentification.** Toute écriture d’intégration exige une confirmation du mot de passe datant de moins de dix minutes, sinon `401 REAUTH_REQUIRED`. Une session volée ne suffit donc pas à remplacer une clé de paiement. Quota dédié : dix écritures par heure et par utilisateur (`429`).

**Codes d’erreur propres à cet espace** : `400 UNKNOWN_FIELD`, `400 UNKNOWN_PROVIDER`, `400 UNKNOWN_ROLE`, `400 UNKNOWN_PLAN`, `400 SELF_DEMOTION_FORBIDDEN`, `400 SELF_DISABLE_FORBIDDEN`, `401 REAUTH_REQUIRED`, `422 INTEGRATION_TEST_FAILED`, `503 VAULT_UNAVAILABLE`, `503 SECRET_KEY_UNAVAILABLE`.

## Ventes — documents de vente et journal — implémenté (S25e, ADR-0023)

Contrat complet : ADR-0023 § S25e.14 et `apps/api/src/sales/invoices/invoice.contract.ts`. Toutes les routes exigent l'organisation active ; un document d'une autre organisation répond `404`.

| Méthode et chemin | Permission |
|---|---|
| `GET /sales/invoices` · `GET /sales/invoices/:id` | `sales.read` |
| `POST /sales/invoices` · `PUT` · `DELETE /sales/invoices/:id` (brouillon) | `sales.manage` |
| `POST /sales/invoices/:id/credit-notes` · `POST …/back-to-draft` | `sales.manage` |
| `POST /sales/invoices/:id/issue` (ordinaire) · `POST …/normalize` (normalisé) | `sales.invoice` |
| `GET /sales/journal` · `GET /sales/exchange-rate-reference` | `sales.read` |

**Pro forma d'abord.** Un brouillon porte une référence `PF{AA}{MM}-NNNNNN` (`PF-AAAA-NNNNNN` avant ADR-0027), jamais un numéro de facture ; `documentKind` vaut `invoice` seulement pour `issued` et `normalized`. Dans une organisation en facture normalisée, « Normaliser » convertit en CDF (taux officiel DGI du dernier instantané, ±1 % si un autre taux est saisi) et laisse le document `pending_normalization` jusqu'à S25f.

**Numérotation (ADR-0027).** `IN{AA}{MM}-NNNNNN` pour les factures et `AV{AA}{MM}-NNNNNN` pour les avoirs, sur une seule série par organisation et par année civile (Kinshasa), remise à 1 le 1ᵉʳ janvier ; le mois imprimé est celui de l'attribution, un repère qui ne remet pas le compteur à zéro. Série `TEST-IN…`/`TEST-AV…` pour l'environnement de test DGI ; compteur incrémenté dans la transaction du gel, sans trou ni doublon sous concurrence. Les numéros attribués avant ADR-0027 (`AAAA-NNNNNN`, `TEST-AAAA-NNNNNN`) restent valides et se cherchent par `q`.

**Modèles de facture sur mesure (ADR-0029).** `GET /sales/invoice-template-packages` (`sales.read`) liste les paquets installés et leurs versions ; `POST /sales/invoice-template-packages` (`organization.manage`, corps ZIP binaire, 20/h) valide entièrement l'archive avant toute écriture — `422 TEMPLATE_PACKAGE_INVALID` avec `details.report` (codes stables, fichier, ligne, colonne, cas), `201` installé, `200` déjà installé à l'identique, `409 TEMPLATE_VERSION_EXISTS` si la même version arrive avec un autre contenu ; `GET /sales/invoice-template-packages/:packageId/preview[?palette&accent&font&format=png]` (`sales.read`, 120/h) rend l'aperçu EXEMPLE ; `PUT /sales/invoice-template/custom` (`organization.manage`, `{ packageId, options, expectedRevision }`) active un paquet. Le gel fige `presentation.package` (identifiant, version, empreinte) ; une archive altérée bloque la réimpression (`409 TEMPLATE_PACKAGE_INTEGRITY`).

**Calculs.** Totaux, paiements, conversion, contre-valeur USD et contrôles d'avoir viennent du moteur `invoice-totals` ; l'API n'en refait aucun.

**Écarts au contrat signalés** : un article dont la devise diffère du document, sans prix saisi, est refusé à l'enregistrement (`400`, problème `CATALOG_CURRENCY_MISMATCH`) au lieu de devenir un bloquant ; `showUsdCounterValue` est renvoyé dans la vue (ajout).

## Ventes — encaissements, règlement et pont vers le réalisé — implémenté (ADR-0031)

Contrat : [ADR-0031](adr/ADR-0031-encaissements-et-realise.md). Organisation active ; une ressource d'une autre organisation répond `404`. Montants en chaînes décimales ; corps `.strict()`.

| Méthode et chemin | Permission |
|---|---|
| `GET /sales/receipts` (`status`, `invoiceId`, `from`, `to`, `limit`) · `GET /sales/receipts/:id` · `GET /sales/receipts/summary` (`from`, `to`) | `sales.read` |
| `POST /sales/receipts` · `PUT /sales/receipts/:id` `{ receipt, expectedRevision }` · `POST /sales/receipts/:id/cancel` `{ reason, expectedRevision }` | `sales.receipt` |
| `GET /sales/settlements?invoiceIds=a,b` ou `?open=true&currency=USD` · `GET /sales/settlements/:invoiceId` | `sales.read` |
| `PUT /sales/settlements/:invoiceId/due-date` `{ dueDate: "AAAA-MM-JJ" \| null }` | `sales.manage` |
| `GET /sales/actuals-bridge` | `sales.read` |
| `GET /sales/actuals-bridge/candidates` · `PUT /sales/actuals-bridge` · `POST /sales/actuals-bridge/sync` `{ dryRun }` | `actuals.import` + `sales.read` |

Codes : `422 RECEIPT_INVALID` (`details.issues` du moteur : `RECEIPT_ALLOCATIONS_MISMATCH`, `RECEIPT_ALLOCATION_EXCEEDS_BALANCE`…), `422 RECEIPT_BEFORE_INVOICE`, `400 RECEIPT_DATE_IN_FUTURE`, `409 RECEIPT_CURRENCY_MISMATCH`, `409 INVOICE_NOT_SETTLEABLE` (`details.reason` : `NOT_FINAL`, `CREDIT_NOTE`, `TEST_SERIES`, `NO_PAYMENTS_DECLARED`), `409 RECEIPT_CANCELLED`, `409 STALE_REVISION`, `400 DUE_DATE_BEFORE_ISSUE`, `409 BRIDGE_NOT_CONFIGURED`, `409 NO_APPROVED_PLAN`, `409 UNKNOWN_LINE`, `409 PERIOD_CONFLICT`. Saisie manuelle d'une ligne alimentée par le pont actif : `409 LINE_FED_BY_RUN` sur `PUT /projects/:id/actual-periods/:year/:month`, dont la vue porte désormais `sources` (origine de chaque valeur).

Intégration avec la trésorerie (26 oct. 2026, amendements d'ADR-0031 et ADR-0034) : `accountId` d'un encaissement est un compte de trésorerie de l'organisation (`404 TREASURY_ACCOUNT_NOT_FOUND`), actif (`400 ACCOUNT_INACTIVE`), de la même devise (`400 RECEIPT_ACCOUNT_CURRENCY_MISMATCH`) et ouvert à la date de réception (`400 RECEIPT_BEFORE_ACCOUNT_OPENING`). `projectId` et `exerciseStart` du pont sont le rattachement commun aux deux ponts : `409 RUN_LINK_IN_USE` (`details.otherBridge`) s'ils changent sous le report des dépenses actif ; `409 LINE_FED_BY_OTHER_BRIDGE` si la ligne est visée par ce report. La synchronisation rend `OTHER_SOURCE_PRESENT` sur une case déjà alimentée par les dépenses. `LINE_FED_BY_RUN` porte `details.sources[ligne]` (`run.sales` ou `run.expenses`).

## Ventes — normalisation DGI — implémenté (S25f, ADR-0024 chantier F2)

Contrat : ADR-0024 § 9. `POST …/normalize` envoie, compare et confirme d'un seul tenant ; un refus de la DGI n'est pas une erreur HTTP (200 avec l'état). La route est idempotente : une requête renvoyée (double clic, navigateur) trouve la prise en main et rend l'état courant sans rien envoyer.

| Méthode et chemin | Permission | Ré-auth | Quota |
|---|---|:--:|---|
| `POST /sales/invoices/:id/normalization/retry` | `sales.invoice` | | 60/h/utilisateur |
| `POST /sales/invoices/:id/normalization/check` | `sales.invoice` | | 60/h/utilisateur |
| `POST /sales/invoices/:id/normalization/declare-not-normalized` `{ reason }` (20 à 500 caractères) | `fiscal.manage` | ✓ | 10/h/utilisateur |
| `GET /sales/invoices/:id/dgi-exchanges` | `sales.read` | | global |

Codes : `409 NORMALIZATION_NOT_RETRYABLE` (`details.phase`), `409 NORMALIZATION_NOT_UNDER_REVIEW`, `401 REAUTH_REQUIRED`. Les prérequis manquants avant envoi (`POINT_OF_SALE_NOT_ACTIVE`, `SELLER_NIF_MISMATCH`, `ISF_NOT_CONFIGURED`, `REFERENCE_LISTS_UNAVAILABLE`, `DGI_PRODUCTION_UNAVAILABLE`) sont rendus dans `normalization.lastError`. `normalization.actions` est calculé par l'API selon la phase et les permissions de la personne, sur toute vue de document. Désactiver un point de vente qui porte une normalisation non soldée : `409 POINT_OF_SALE_HAS_PENDING_NORMALIZATIONS`.

Tâches planifiées : `sales.normalization.reconcile` (30 s, lecture et annulation seulement), `edef.reference.refresh` (6 h) et `edef.reference.refresh.daily` (00 h 15, Kinshasa), `sales.normalization.consistency` (quotidienne).

**Écarts au contrat signalés** : `POST …/normalize` ne porte pas encore le quota de normalisation (60/h, fichier `invoices.controller.ts` hors périmètre F2) ; les e-mails d'alerte (décision ouverte n° 3) ne sont pas envoyés ; `lastError.dgiMessage` est le libellé DGI tel que reçu (`dgiErrorDesc` du client e-MCF).

## Dépenses et trésorerie — implémenté (ADR-0034)

Contrat : ADR-0034. Organisation active seulement ; une ressource d'une autre organisation répond `404`. Montants en chaînes décimales ; soldes, agrégats, rapprochement et prévision calculés par le moteur (`packages/engine/src/treasury/`).

| Méthode et chemin | Permission |
|---|---|
| `GET /treasury/categories` · `/expenses` · `/expenses/:id` · `/expenses/summary` · `/suppliers` | `treasury.read` |
| `POST /treasury/expenses` · `PUT /treasury/expenses/:id` · `POST …/:id/cancel` | `treasury.manage` |
| `POST /treasury/expenses/:id/attachment` (corps binaire, image 2 Mio, 20/h/utilisateur) · `DELETE …/attachment` | `treasury.manage` |
| `GET /treasury/expenses/:id/attachment` (octets assainis, en-têtes inertes) | `treasury.read` |
| `GET /treasury/recurring-expenses` · `/recurring-expenses/due` | `treasury.read` |
| `POST /treasury/recurring-expenses` · `PUT …/:id` · `POST …/:id/occurrences/:date/confirm` (idempotent) | `treasury.manage` |
| `GET /treasury/accounts` · `/accounts/:id` · `/movements` · `/forecast?currency=` · `/settings` · `/actuals-bridge` | `treasury.read` |
| `POST /treasury/accounts` · `PUT …/:id` · `POST /treasury/transfers` · `POST /treasury/movements` · `POST …/:id/cancel` · `PUT /treasury/settings` | `treasury.manage` |
| `PUT /treasury/actuals-bridge` · `POST /treasury/actuals-bridge/sync` `{ dryRun }` | `actuals.import` + `treasury.read` |
| `GET /treasury/reconciliation?year=` | `treasury.read` + `analytics.read` |

Codes : `400 EXPENSE_IN_FUTURE`, `EXPENSE_ACCOUNT_CURRENCY_MISMATCH`, `EXPENSE_BEFORE_ACCOUNT_OPENING`, `ACCOUNT_INACTIVE`, `TRANSFER_AMOUNTS_DIFFER`, `NOT_AN_OCCURRENCE`, `OCCURRENCE_IN_FUTURE`, `UNKNOWN_LINE`, `LINE_NOT_A_CHARGE`, `CATEGORY_NOT_OPERATING` ; `409 STALE_REVISION`, `EXPENSE_CANCELLED`, `NO_APPROVED_PLAN`, `BRIDGE_NOT_CONFIGURED`, `BRIDGE_DISABLED`, `PERIOD_CONFLICT`. Côté réalisé : `PUT /projects/:id/actual-periods/…` répond `409 LINE_FED_BY_RUN` sur une ligne alimentée par le report actif, et chaque période expose `sources` (origine de chaque valeur).

Depuis le 26 oct. 2026 (amendement d'ADR-0034) : `projectId` et `firstMonth` de `PUT /treasury/actuals-bridge` écrivent le rattachement commun aux deux ponts (`409 RUN_LINK_IN_USE` sous le pont des ventes actif ; `409 LINE_FED_BY_OTHER_BRIDGE` pour la ligne de chiffre d'affaires des ventes), et `GET` le rend même réglé côté ventes. Les encaissements rattachés à un compte entrent dans ses soldes et ses mouvements (`source: receipt`, `receiptsIntegrated: true`) ; la prévision attend le reste réellement à encaisser de chaque facture (avoirs et encaissements imputés, échéance de la facture) et signale `RECEIPTS_WITHOUT_ACCOUNT`.

## Ventes — devis — implémenté (ADR-0035)

Un devis est un document **distinct** du pro forma : `DV{AA}{MM}-NNNNNN` (hors série fiscale), versions, validité. Client, lignes et montants ont les formes du brouillon de facture et sont calculés par le même code (moteur). Lecture `sales.read`, tout le reste `sales.manage`.

| Méthode et chemin | Effet |
|---|---|
| `GET /sales/quotes?status=&customerId=&opportunityId=&q=&cursor=` | liste ; `status` : `draft`, `sent`, `accepted`, `refused`, `expired` (dérivé : envoyé, validité passée) |
| `POST /sales/quotes` · `PUT /sales/quotes/:id` (brouillon, `expectedRevision`) | `{ opportunityId?, title?, notes?, validUntil?, currency, priceMode, customer, lines }` |
| `DELETE /sales/quotes/:id` | brouillon v1 jamais envoyé ; sinon `409 QUOTE_NOT_DELETABLE` |
| `POST /sales/quotes/:id/send` · `/accept` · `/refuse` (`reason?`) · `/new-version` | `{ expectedRevision }` ; `409 QUOTE_STATUS_CONFLICT`, `409 QUOTE_NOT_READY` (`details.blockers`) |
| `POST /sales/quotes/:id/convert` | devis accepté → brouillon de facture `FV` à prix fixés ; `{ quote, invoiceId, amountsDiffer }` ; `409 QUOTE_ALREADY_CONVERTED` |
| `GET /sales/quotes/:id/pdf` | « DEVIS — non valable comme facture », modèle de l'organisation, aucune mention DGI de facture ; audit strict |

L'acceptation applique la règle de gain du CRM (`opportunityOutcome` : `won`, `disabled`, `not_open`, `none`).

## CRM minimal — implémenté (ADR-0035)

Lecture `crm.read` ; écriture, réglages, import et export `crm.manage`.

| Méthode et chemin | Effet |
|---|---|
| `GET /crm/settings` · `PUT /crm/settings` | étapes `{ key, label, kind: open\|won\|lost }`, `autoWinOnQuoteAccepted`, `staleAfterDays` ; `409 CRM_STAGE_IN_USE`, `409 CRM_STAGE_KIND_CHANGED` |
| `GET /crm/pipeline` | colonnes, totaux estimés par devise et probabilité par étape (moteur, `available` ou `unavailable`), inactives, relances en retard, prochaines actions |
| `GET/POST /crm/contacts`, `GET/PUT/DELETE /crm/contacts/:id` | contact client (`customerId`) ou prospect (`companyName`) ; `409 CRM_CONTACT_IN_USE` |
| `GET/POST /crm/opportunities`, `GET/PUT/DELETE /crm/opportunities/:id`, `POST …/:id/move` | client ou prospect nommé, montant estimé en chaîne ; `409 CRM_OPPORTUNITY_HAS_QUOTES` |
| `GET/POST /crm/activities`, `PUT/DELETE /crm/activities/:id`, `POST …/:id/complete` | `call`, `meeting`, `note` (sans échéance), `follow_up` (échéance obligatoire) |
| `GET /crm/contacts/export` · `GET /crm/opportunities/export` | CSV `;`, UTF-8 avec BOM, formules neutralisées ; audit strict |
| `POST /crm/contacts/import` · `POST /crm/opportunities/import` `{ csv, dryRun }` | tout ou rien, 500 lignes ; `400 CSV_IMPORT_INVALID` (`details.errors[].line`), `400 CSV_UNREADABLE` |

## CRM complet — proposé, ADR-0040 (non implémenté)

Contrat **proposé** par [ADR-0040](adr/ADR-0040-crm-complet.md) § 3 ; les routes du pipeline v2
(lot C2) et des rapports (lot C3) sont implémentées, voir les sections suivantes.
Nouvelle action `sales.quote` (devis) ; nouveau rôle Commercial (`sales_rep`).

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /crm/accounts` · `GET /crm/accounts/:id` | `crm.read` | comptes prospect ou client (lié 1-1 à `customers`) |
| `POST /crm/accounts` · `PUT` · `DELETE /crm/accounts/:id` · `POST …/archive` · `…/restore` · `…/merge` | `crm.manage` | prospect ; identité d'un compte client : `409 CRM_ACCOUNT_IDENTITY_FROM_CUSTOMER` |
| `POST /crm/accounts/:id/convert` `{ mode: 'create', customer } \| { mode: 'link', customerId }` | `crm.manage` + `sales.manage` | fiche client créée par les règles de Ventes (NIF) ; `409 CUSTOMER_NIF_EXISTS` |
| `GET /crm/accounts/:id/overview` · `GET /crm/accounts/:id/timeline?cursor=&types=` | `crm.read` (sections `hidden` sans `sales.read` / `work.read`) | **implémenté (lot C8, `CrmOverviewModule`)** : fiche 360°, sections `{ status: 'known' \| 'hidden' \| 'empty' }` (identité, contacts, opportunités avec totaux estimés par devise, prochaines actions, devis, factures et avoirs avec règlement, encaissements sans compte de trésorerie, solde dû par devise — moteur `sumOutstandingByCurrency` —, projets RUN) ; fil agrégé à la lecture, 50 par page, curseur `(at, type, id)`, `types=` parmi `activity, opportunity, account, quote, invoice, receipt, project` (`400 INVALID_REQUEST`), `hiddenSources` signale les sources masquées ; `400 INVALID_CURSOR` ; `404 CRM_ACCOUNT_NOT_FOUND` hors organisation |
| `POST /crm/opportunities/reassign` | `crm.manage` | réassignation en masse des responsables |
| `POST /crm/opportunities` · `PUT …/:id` · `POST …/:id/move` | `crm.manage` | + `accountId`, `ownerId`, `lines`, `amountSource`, `lostReasonKey` ; `400 CRM_LOST_REASON_REQUIRED` |
| `POST /sales/quotes/from-opportunity` | `sales.quote` + `crm.read` | devis brouillon prérempli par les lignes |
| écritures des devis (`POST`, `PUT`, `DELETE`, `send`, `accept`, `refuse`, `new-version`) | `sales.quote` (au lieu de `sales.manage`) | — |
| `POST /sales/quotes/:id/convert` | `sales.quote` + `sales.manage` | — |
| `GET /crm/reports?from=&to=&ownerId=` | `crm.read` | **implémenté (lot C3)**, voir « Rapports du CRM » ci-dessous |
| `POST /crm/activities/:id/reopen` | `crm.manage` | décocher une activité |
| `GET /work/my-tasks` | `work.read` | éléments `source: 'crm'` (relances assignées, avec échéance) si `crm.read` |
| `POST /work/projects/from-opportunity` | `work.manage` + `crm.read` | opportunité gagnée → projet, jamais automatique ; `409 WORK_PROJECT_EXISTS_FOR_OPPORTUNITY` |

Notifications ajoutées : `crm.activity_assigned`, `crm.activity_due_soon`, `crm.activity_overdue`,
`crm.opportunity_assigned`, `crm.opportunity_won`. Brief : faits `mes_relances.*`,
`relances.en_retard`, `pipeline` connu, règle R10 `relances_en_retard`.

### Pipeline v2 — implémenté (ADR-0040 C2)

Lot C2 d'[ADR-0040](adr/ADR-0040-crm-complet.md) (§ 2.3, § 2.5, § 2.6, § 3.2 à § 3.4, § 7.1).
Montants **estimés**, jamais convertis entre devises ; rien n'alimente le réalisé.

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `POST /crm/opportunities` · `PUT /crm/opportunities/:id` | `crm.manage` | + `accountId` (compte de l'organisation, sinon `404 CRM_ACCOUNT_NOT_FOUND` ; `customerId`/`prospectName` sans `accountId` encore acceptés, résolus en compte), `ownerId` (défaut : l'auteur ; membre détenant `crm.manage`, sinon `400 CRM_OWNER_NOT_ELIGIBLE` ou `404 CRM_MEMBER_NOT_FOUND`), `lines` (0 à 50 ; libellé, unité et prix **HT** copiés de l'article ; `400 CRM_LINE_CURRENCY_MISMATCH` ; `404 CATALOG_ITEM_NOT_FOUND`), `amountSource` (`manual` \| `lines` : total HT des lignes calculé par le moteur). Réponse : la vue, plus `warnings: [{ code: 'CRM_LINE_WITHOUT_PRICE', lineIndex }]`. Champ non envoyé au `PUT` : inchangé |
| `POST /crm/opportunities/:id/move` | `crm.manage` | + `lostReasonKey`, `lostReasonDetail` (`lostReason` accepté comme détail) ; perdu sans motif : `400 CRM_LOST_REASON_REQUIRED` ; motif inconnu ou désactivé : `400 CRM_LOST_REASON_UNKNOWN` ; `wonAt` posé au gain |
| `POST /crm/opportunities/reassign` `{ fromOwnerId, toOwnerId, onlyOpen = true }` | `crm.manage` | réassignation en masse, journalisée ; rend `{ reassigned }` ; notifie `crm.opportunity_assigned` au nouveau responsable |
| `GET /crm/opportunities?ownerId=me\|<id>&accountId=` | `crm.read` | filtres ajoutés (confort : tout `crm.read` voit tout le pipeline) |
| `GET /crm/pipeline?ownerId=me\|<id>` | `crm.read` | + `forecast` (`weightedForecast` : par devise `weighted`, `unweighted`, `count`, `notWeightable`), `orphaned { count, ownerIds }`, `calculationVersion` 1.1.0 ; cartes : `ownerId`, `orphaned`, `accountId`, `accountName`, `amountSource`, `lostReasonKey`, `wonAt` |
| `GET /crm/settings` · `PUT /crm/settings` | `crm.read` · `crm.manage` | + `lostReasons` (six par défaut), `lostReasonRequired` (défaut `true`), `forecastProbability` (toujours `historical` : saisie désactivée) ; retirer un motif utilisé : `409 CRM_LOST_REASON_IN_USE` |
| `POST /sales/quotes/from-opportunity` `{ opportunityId, validUntil? }` | `sales.quote` + `crm.read` | devis brouillon : devise de l'opportunité, prix HT, client = fiche du compte client sinon client de passage ; montants recalculés par la composition des devis ; `409 CRM_OPPORTUNITY_HAS_NO_LINES`, `409 CRM_LINE_NOT_QUOTABLE` (ligne sans article) |

### Rapports du CRM — implémenté (ADR-0040 C3)

Lot C3 d'[ADR-0040](adr/ADR-0040-crm-complet.md) (§ 3.4, § 7.2 ; critère 14). Lecture seule ;
calculs du moteur (`crmReports`, `CRM_INDICATORS_VERSION` 1.1.0), montants **estimés** par devise,
jamais convertis ; rien n'alimente le réalisé, un plan ni un scénario.

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /crm/reports?from=&to=&ownerId=me\|<id>` | `crm.read` | `from`/`to` : jours `AAAA-MM-JJ` de Kinshasa, bornes incluses ; défaut : 12 mois glissants jusqu'à aujourd'hui ; 24 mois au plus (`400 CRM_REPORT_PERIOD_TOO_LONG`) ; début après fin ou jour inexistant : `400 CRM_REPORT_PERIOD_INVALID` ; format illisible ou paramètre inconnu : `400 INVALID_REQUEST`. `ownerId` restreint **tous** les blocs (confort : tout `crm.read` voit toute l'organisation) |

Réponse (`CrmReportsView`, `@lalanda/shared/crm`) : `basis: 'estimated'`, `label` (« Montants
estimés — … ni réalisé, ni plan »), `period`, `asOf`, `minSample` (10) et :

- `funnel` : opportunités **créées** dans la période ; par étape ouverte (ordre des réglages), nombre
  passé par l'étape (`stageHistory`) et montants par devise ;
- `conversion` : par étape, part des opportunités passées par l'étape qui ont atteint une étape
  ultérieure (ouverte ou gagnée) ; `overall` = gagnées / clôturées dans la période ;
- `cycle` : jours civils de Kinshasa entre création et gain (`won`), ou perte (`lost`) ; moyenne et
  médiane arrondies au jour, demi vers le haut ;
- `byOwner` : par responsable, ouvertes (aujourd'hui), gagnées et perdues de la période (nombre,
  montants par devise), taux de gain, prévision pondérée, trois motifs de perte les plus fréquents ;
  `ownerName` joint pour un membre actuel, `isMember: false` pour un ancien ;
- `forecastByMonth` : ouvertes groupées en `overdue` (date prévue passée), `month` (`AAAA-MM`) et
  `no_date` ; `weighted`, `unweighted`, `notWeightable` par devise (probabilité historique en
  fraction exacte, comme `GET /crm/pipeline`) ;
- `lostReasons` : perdues de la période par `lostReasonKey` avec le libellé du réglage.

Tout taux et toute durée sous 10 cas : `{ status: 'unavailable', sample, requiredSample }`.
`truncated: true` si plus de 20 000 opportunités sont en jeu.

## Achats et fournisseurs — proposé, ADR-0044 (non implémenté)

Contrat **proposé** par [ADR-0044](adr/ADR-0044-achats-et-fournisseurs.md) § 3 (R3 du RUN). Module
`apps/api/src/purchases/`, web `/achats`. Cinq actions nouvelles (`purchase.read`,
`purchase.request`, `purchase.manage`, `purchase.approve`, `payables.pay`) ; aucun rôle nouveau.

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /purchases/suppliers` · `GET …/:id` · `GET …/:id/overview` | `purchase.read` | fiches (coordonnées de paiement masquées) ; fiche 360° par sections `known \| hidden \| empty` (commandes, réceptions, factures, solde dû et ancienneté par devise ; paiements et dépenses avec `treasury.read`) |
| `POST /purchases/suppliers` · `PUT …/:id` · `…/archive` · `…/restore` · `…/merge` · `DELETE` | `purchase.manage` | `409 SUPPLIER_NIF_EXISTS`, `SUPPLIER_IN_USE`, `SUPPLIER_HAS_OPEN_PAYABLES` |
| `POST …/:id/payment-methods` · `PUT`/`DELETE …/:methodId` | `purchase.manage` | chiffrées ; audit strict ; notification aux payeurs |
| `POST …/:id/payment-methods/:methodId/reveal` | `payables.pay` | clair, audit strict, 30 par heure |
| `GET /purchases/orders` · `GET …/:id` · `GET …/:id/pdf` | `purchase.read` | demandes et bons de commande ; PDF « n'est pas une facture » |
| `POST /purchases/orders` · `PUT` · `DELETE` · `…/submit` · `…/duplicate` | `purchase.request` (ses demandes) ou `purchase.manage` | `DA…` à la soumission ; modifier efface les approbations |
| `POST …/:id/approve` · `…/reject` · `GET /purchases/approvals/pending` | `purchase.approve` | paliers par devise ; `409 SELF_APPROVAL_FORBIDDEN`, `APPROVER_ALREADY_APPROVED` ; approbateur unique marqué ; `BC…` à l'approbation complète |
| `POST …/:id/mark-sent` · `…/cancel` · `…/close` · `GET`/`POST …/:id/email` | `purchase.manage` | envoi au fournisseur selon ADR-0042 (audit strict, seau commun) ; l'envoi passe la commande à `sent` |
| `GET /purchases/receptions` · `POST` · `…/:id/cancel` · pièce | `purchase.read` · `purchase.manage` | réceptions totales ou partielles, sans stock |
| `GET /purchases/invoices` · `GET …/:id` | `purchase.read` | rapprochement `none \| two_way \| three_way`, reste à payer |
| `POST /purchases/invoices` · `…/from-order` · `PUT` · `…/validate` · `…/dispute` · `…/cancel` · pièce | `purchase.manage` | `409 SUPPLIER_INVOICE_DUPLICATE`, `SUPPLIER_INVOICE_VARIANCE`, `SUPPLIER_INVOICE_TOTAL_MISMATCH` |
| `POST …/:id/force-validate` | `purchase.approve` | validation malgré l'écart, motif obligatoire |
| `GET /purchases/payables` · `GET /purchases/summary` | `purchase.read` | échéancier et ancienneté par devise ; engagé, facturé, payé |
| `GET /purchases/payments` · `GET /purchases/duplicates` | `purchase.read` + `treasury.read` | paiements ; doublons probables avec les dépenses directes |
| `POST /purchases/payments` · `…/:id/cancel` | `payables.pay` | crée (ou annule) les dépenses `treasury_expenses` correspondantes, ventilées par imputation |
| `POST /purchases/payments/from-expense` | `payables.pay` + `treasury.manage` | une dépense directe existante devient le paiement (pas de double comptage) |
| `GET /purchases/settings` · `PUT` | `purchase.read` · `purchase.manage` + `purchase.approve` | paliers, tolérances, échéances |

Effets sur l'existant : `PUT`, `cancel` et pièce d'une dépense créée par un paiement →
`409 EXPENSE_OWNED_BY_PURCHASES` ; `GET /treasury/suppliers` rend les fiches et les textes libres ;
la prévision (`GET /treasury/forecast`) gagne la composante « Échéances fournisseurs » ; la marge
d'un projet gagne `committed` et `ordered` (informatifs) ; « Mes tâches » gagne les éléments
`source: 'purchases'` (approbations à faire) ; brief : R11 `factures_fournisseurs_en_retard`, R12
`approbations_achat_en_attente`. Notifications : `purchases.approval_requested`,
`purchases.request_approved`, `purchases.request_rejected`, `purchases.invoice_variance`,
`purchases.invoice_due_soon`, `purchases.invoice_overdue`,
`purchases.supplier_payment_details_changed`.

### Lot P6 — liens : brief, marge, rappels, fiche 360° — implémenté (ADR-0044 § 3.1.1, § 6.1, § 6.4, § 6.5)

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /purchases/suppliers/:id/overview` | `purchase.read` | fiche 360° : `supplier` (coordonnées masquées) et sections `{ status: known \| hidden \| empty, data }` — `orders` (`totalsByCurrency` des commandes engagées, `byStatus`, `recent`), `receptions` (`toReceive` par commande, reste par ligne, moteur `orderReceptionStatus`), `invoices` (`recent`, reste à payer du moteur), `balance` (ancienneté par devise, `payablesAging`, litiges à part) ; `payments` et `directExpenses` (doublons probables signalés) exigent aussi `treasury.read`, sinon `hidden` et rien n'est lu. Autre organisation : `404` |
| `GET /purchases/summary?from=&to=` | `purchase.read` | moteur `purchasesSummary`, par devise, fournisseur (`supplierName`) et catégorie : `committed` (reste à facturer HT des commandes approuvées non closes, **à date**, hors période), `invoiced`, `credited`, `paid`, `remaining` (factures validées dont la date de facture est dans la période) ; `400 INVALID_REQUEST` pour une période inversée |
| `GET /work/projects/:id/margin` (étendu) | inchangée | `WORK_MARGIN_VERSION` 1.1.0 ; `purchases: [{ currency, committed, ordered, invoiceCount, orderCount }]` — INFORMATIF, jamais soustrait de `margin` ; `null` sans `purchase.read` (port `WORK_PURCHASES_SOURCE`, rien n'est lu) |
| `GET /morning-brief` (étendu) | inchangée | `MORNING_BRIEF_VERSION` 1.3.0 ; faits `fournisseurs.factures_en_retard`, `fournisseurs.a_payer_bientot` (montants `.CDF`/`.USD` avec `treasury.read`), `mes_approbations.en_attente` (avec `purchase.approve`) ; R11 `factures_fournisseurs_en_retard` (`attention`, `/achats/a-payer`), R12 `approbations_achat_en_attente` (`info`) ; sans `purchase.read` : faits `hidden`, R11 et R12 non évaluées (port `PURCHASES_SOURCE`) ; l'e-mail quotidien n'affiche aucun fait d'achat masqué |

Tâche planifiée `purchases.due-reminders` (15 min, à partir de 7 h à Kinshasa, 500 factures par
passage) : `purchases.invoice_due_soon` et `purchases.invoice_overdue` aux détenteurs effectifs de
`payables.pay`, une fois par facture, type et échéance (réclamation `purchase_due_reminders`, index
unique ; `dedupeKey`), refiltrées à la lecture par `purchase.read` ; litiges exclus. Une
modification, une approbation complète, un envoi, une annulation ou une clôture de commande
recalculent le rapprochement des brouillons de facture liés (`refreshDrafts`). `GET
/purchases/payables` : livré par P5.

## Ressources humaines — proposé, ADR-0045 (non implémenté)

Contrat **proposé** par [ADR-0045](adr/ADR-0045-ressources-humaines.md) § 3 (R4 du RUN, **paie
exclue**). Module `apps/api/src/hr/`, web `/rh`. Cinq actions nouvelles (`hr.read`, `hr.manage`,
`hr.sensitive.read`, `leave.request`, `leave.approve`) et un rôle nouveau, Responsable RH
(`hr_manager`). Les routes « soi » et « équipe » portent `analytics.read` au guard et la portée
dans le service (`hrViewerScope`) ; un collaborateur hors portée rend `404`.

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /hr/employees` · `GET …/:id` | `hr.read` (fiche : aussi manager ou soi) | dossiers, jamais de donnée sensible |
| `POST /hr/employees` · `PUT …/:id` · `POST /hr/employees/from-members` · `…/exit` · `…/reinstate` | `hr.manage` | `409 EMPLOYEE_USER_ALREADY_LINKED`, `EMPLOYEE_NUMBER_EXISTS`, `MANAGER_CYCLE` ; la sortie annule les absences futures et propose la liste de départ |
| `POST …/:id/anonymize` | `hr.manage` + `hr.sensitive.read` | collaborateur sorti seulement ; irréversible ; audit strict |
| `GET …/:id/private` · `PUT …/:id/private/:section` | `hr.sensitive.read` (écriture : + `hr.manage`) | sections chiffrées, formes masquées ; changement bancaire notifié |
| `POST …/:id/private/reveal` | `hr.sensitive.read`, ou soi | clair, audit strict avant réponse, 30 par heure |
| `GET /hr/departments` · `POST` · `PUT` · `…/archive` · `GET /hr/org-chart` | `hr.read` · `hr.manage` · `hr.read` ou membre relié | services, organigramme (nom, poste, service, manager) |
| `GET /hr/me` · `GET /hr/team` · `GET /hr/leave-approvals/pending` · `GET /hr/calendar` | `analytics.read` | ma fiche et mes soldes ; mon équipe ; mes validations ; absences de ma portée (« Absent » pour un type confidentiel) |
| `GET /hr/leave-types` · `GET /hr/holidays` · `POST`/`PUT` | `analytics.read` · `hr.manage` | types paramétrables, jours fériés saisis par l'organisation |
| `POST /hr/leave-requests` · `…/:id/cancel` | `leave.request` (soi) ou `hr.manage` (autrui) | jours calculés par le moteur ; `409 LEAVE_OVERLAP`, `LEAVE_BALANCE_INSUFFICIENT`, `EMPLOYEE_NOT_LINKED` |
| `POST /hr/leave-requests/:id/approve` · `…/reject` | manager désigné, ou `leave.approve` | `409 SELF_APPROVAL_FORBIDDEN`, `APPROVER_ALREADY_APPROVED`, `403 LEAVE_NOT_YOUR_STEP` ; approbateur unique marqué |
| `GET /hr/leave-balances` · `GET /hr/leave-ledger` · `POST /hr/leave-ledger` | soi, manager, `hr.read` · `hr.manage` | soldes (moteur) ; attributions et ajustements journalisés |
| `GET`/`POST /hr/employees/:id/documents` · `GET /hr/documents/:id/file` · `DELETE` | `hr.read` / `hr.sensitive.read` / soi · `hr.manage` | PDF inerte ; pièces sensibles chiffrées, téléchargement audité |
| `GET`/`POST /hr/checklist-templates` · `POST /hr/employees/:id/checklists` · `…/items/:itemId/done` | `hr.read` · `hr.manage` · l'assigné | listes d'accueil et de départ (hors projets RUN) |
| `GET /hr/deadlines` · `GET /hr/reports` · `GET /hr/reports/export.csv` | `hr.read` (CSV : + `report.export`) | échéances ; effectif, entrées et sorties, absentéisme, ancienneté ; jamais de salaire |
| `GET /hr/settings` · `PUT` | `hr.read` · `hr.manage` (+ `leave.approve` pour le circuit) | semaine de travail, circuit, types de contrat, rappels, conservation |
| `GET /work/timesheets` | `work.read` (soi) ; `work.manage` ou manager (autrui) | feuille de temps hebdomadaire **en lecture** des saisies existantes, absences et fériés |

Effets sur l'existant : « Mes tâches » gagne les éléments `source: 'hr'` (validations d'absence,
éléments de liste) ; le calendrier des tâches affiche les absences ; un assigné absent porte un badge
et le constat `ASSIGNEE_ABSENT_ON_DUE_DATE` ; la marge d'un projet gagne le constat
`PERSONNEL_EXPENSES_AND_TIME_COST` (montant inchangé) ; brief : R13 `absences_du_jour`, R14
`validations_absence_en_attente`, R15 `echeances_rh_proches`. Notifications : `hr.leave_requested`,
`hr.leave_approved`, `hr.leave_rejected`, `hr.leave_cancelled`, `hr.probation_ending`,
`hr.contract_ending`, `hr.document_expiring`, `hr.checklist_item_assigned`,
`hr.bank_details_changed`. Tâches : `hr.leave-accruals`, `hr.reminders`, `hr.retention` (éteinte).

## Brief du matin — implémenté (ADR-0033)

L'organisation est toujours celle de la session ; aucun corps ni paramètre ne la désigne.

| Méthode et chemin | Permission | Quota |
|---|---|---|
| `GET /morning-brief` | `analytics.read` (faits de ventes : `sales.read`, sinon `hidden`) | global |
| `POST /morning-brief/explanation` `{ intent: "explain" \| "this_week" }` | `analytics.read` | IA (`AI_THROTTLE`) + quota mensuel `ai.morning_brief` |
| `GET /morning-brief/preferences` · `PUT /morning-brief/preferences` `{ emailDaily }` | `analytics.read` | global |
| `PUT /morning-brief/settings` `{ aiEnabled }` | `organization.manage` | global |

Codes : `400 INVALID_REQUEST` (corps `.strict()`), `403 PLAN_LIMIT_AI_MESSAGES` avant tout appel au modèle. L'explication rend `source: "llm" | "fallback"`, `cached`, `reason` et ses sources ; un nombre ou une source absents des faits font servir le texte déterministe. Tâche planifiée : `morning-brief.daily-email` (15 min, envoi à partir de 7 h à Kinshasa, au plus une fois par jour).

## Business plan narratif — implémenté (ADR-0037)

Le projet est résolu par `findScoped` (404 hors organisation). Le client n'envoie jamais un chiffre : les tableaux sont relus dans le plan figé rattaché.

| Méthode et chemin | Permission | Quota |
|---|---|---|
| `GET /projects/:id/business-plan` | `project.read` | global |
| `PUT /projects/:id/business-plan/plan` `{ planVersion: number \| null }` | `canvas.update` | global |
| `PUT /projects/:id/business-plan/sections/:sectionId` `{ text }` | `canvas.update` | global |
| `POST /projects/:id/business-plan/sections/:sectionId/draft` `{ notes? }` | `canvas.update` | IA (`AI_THROTTLE`) + quota mensuel `ai.business_plan` |
| `POST …/sections/:sectionId/proposal/accept` · `…/proposal/discard` | `canvas.update` | global |
| `GET /projects/:id/business-plan/versions` · `…/versions/:version` | `project.read` | global |
| `POST /projects/:id/business-plan/versions` | `plan.approve` (séparation des tâches) | global |
| `GET /projects/:id/business-plan/pdf[?version=N]` | `report.export` | exports PDF du mois |
| `GET /business-plan` · `GET /business-plan/settings` | `project.read` | global |
| `PUT /business-plan/settings` `{ aiEnabled }` | `organization.manage` | global |

Codes : `400 BUSINESS_PLAN_UNKNOWN_SECTION`, `404 PLAN_NOT_FOUND`, `409 BUSINESS_PLAN_NO_FROZEN_PLAN`, `409 BUSINESS_PLAN_PENDING_AI`, `409 BUSINESS_PLAN_UNCHANGED`, `409 BUSINESS_PLAN_NO_PROPOSAL`, `409 SELF_APPROVAL_FORBIDDEN`, `409 BUSINESS_PLAN_PLAN_MISMATCH`, `403 PLAN_LIMIT_AI_MESSAGES` avant tout appel au modèle. Le brouillon rend `proposal` (ou `null`), `source`, `reason` (`rejetee`, `indisponible`, `desactivee_*`) et `detail` (motif d'un rejet, jamais le texte rejeté).
## Idea Lab et validation d'idée — implémenté (ADR-0036)

Organisation de la session ; une idée d'une autre organisation répond `404`. Aucune action RBAC nouvelle.

| Méthode et chemin | Permission | Quota |
|---|---|---|
| `GET /idea-lab/ideas` (idées, comparaison du moteur, grille, état de l'IA) · `GET /idea-lab/ideas/:id` (fiche, score, expériences) | `project.read` | global |
| `POST /idea-lab/ideas` · `PUT /idea-lab/ideas/:id` (fiche complète) · `PUT …/:id/archived` `{ archived }` | `canvas.update` | global |
| `PUT /idea-lab/ideas/:id/ratings/:criterionId` `{ note, proof, experimentIds }` · `DELETE` | `canvas.update` | global |
| `POST /idea-lab/ideas/:id/experiments` · `PUT` · `DELETE …/experiments/:experimentId` | `canvas.update` | global |
| `POST /idea-lab/ideas/:id/promote` `{ projectId }` | `canvas.update` | global |
| `POST /idea-lab/ideas/:id/assist` `{ intent: "reformuler" \| "questions_entretien" \| "hypotheses" }` | `canvas.update` | IA (`AI_THROTTLE`) + quota mensuel `ai.idea_lab` |
| `PUT /idea-lab/settings` `{ aiEnabled }` | `organization.manage` | global |

Codes : `400 INVALID_REQUEST` (corps `.strict()` ; taille de marché sans source ; note sans preuve ; expérience terminée sans conclusion), `400 EXPERIMENT_NOT_FOUND` (preuve citant une expérience inconnue), `404 IDEA_NOT_FOUND` · `CRITERION_NOT_FOUND` · `PROJECT_NOT_FOUND`, `403 IDEA_LIMIT_REACHED` (50 idées) · `EXPERIMENT_LIMIT_REACHED` (30), `409 IDEA_CONFLICT` (écriture concurrente), `403 PLAN_LIMIT_AI_MESSAGES` avant tout appel au modèle. L'assistance rend `source: "llm" | "fallback"` et `reason` ; un nombre absent de la fiche fait servir le texte déterministe. La promotion n'ajoute que des cartes de texte au Canvas (`added`, `present`, `ignored`, `empty`) ; un nouveau projet se crée par `POST /projects`.

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
