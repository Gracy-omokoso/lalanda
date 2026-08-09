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

## Webhooks

Paiements et intégrations utilisent signatures, tolérance temporelle, anti-rejeu, journal et traitement idempotent.

## API publique

Réservée aux offres compatibles. Clés à portée limitée, rotation, quotas, journal d’utilisation et documentation séparée. Aucune API publique avant stabilisation des contrats internes.
