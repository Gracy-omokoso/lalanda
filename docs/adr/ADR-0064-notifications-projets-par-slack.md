# ADR-0064 — Notifications des Projets par Slack

Statut : **Proposé** (besoin exprimé par la dirigeante le 5 nov. 2026 ; à valider sur les captures
`docs/refonte-ui/v6/`)
Date : 2026-11-05
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> S'appuie sur [ADR-0013](ADR-0013-stockage-secrets-integration.md) (secrets chiffrés, écriture
> seule), [ADR-0017](ADR-0017-interrupteur-integrations.md) (interrupteur),
> [ADR-0021](ADR-0021-modules-erp-et-identite-fiscale.md) § 4.2 (coffre de portée organisation),
> [ADR-0060](ADR-0060-equipes-membres-projet-visibilite.md) (visibilité) et
> [ADR-0061](ADR-0061-parametres-projets-notifications-couleurs.md) (préférences). **Aucune action
> ajoutée** à `authz/permissions.ts`. Cible : v1.17.0.

## Contexte

Les équipes vivent dans Slack. Les notifications des Projets (cloche, e-mail) ne les y suivent pas.
La dirigeante veut qu'elles y arrivent, sans qu'une organisation puisse jamais voir ou utiliser
l'espace Slack d'une autre.

## Options considérées

### O1 — Une application ou une par organisation

1. Chaque organisation crée sa propre application Slack et colle ses identifiants. Écarté : une
   démarche de développeur pour chaque client.
2. **Une application « Lalanda » distribuée**, installée par chaque organisation dans **son** espace
   par OAuth (« Ajouter à Slack »). **Retenu.** Les identifiants de l'application sont ceux de la
   plateforme (`/admin`) ; le **jeton du bot** est propre à chaque organisation.

### O2 — Où ranger le jeton du bot

1. Dans `integrations` (portée plateforme). Écarté : ADR-0021 O3 sépare les deux coffres par
   construction.
2. **Coffre d'organisation** (`organization_secrets`), nouvelle nature `slack_bot_token`. **Retenu.**
   L'AAD lie le chiffré à l'organisation : recopié vers une autre, il ne se déchiffre pas. Ajout pur à
   la liste fermée `ORGANIZATION_SECRET_KINDS` (le port était « figé sans accord du CTO » : ce
   paragraphe vaut demande d'accord ; aucune signature ne change).

### O3 — Qui reçoit

1. Un canal par organisation. Écarté : publie à tous ce qui ne concerne qu'une personne, et ignore la
   visibilité des projets privés.
2. **Message privé du bot à chaque destinataire** déjà retenu par `WorkNotifier` (mêmes filtres que
   l'e-mail), plus un **canal facultatif par projet**. **Retenu.**

### O4 — Dépendance

`@slack/web-api` écarté : six méthodes suffisent, `fetch` natif, aucun paquet dans le processus qui
détient `SECRETS_MASTER_KEY` (ADR-0013 § 10).

## Décision

### 1. Application de la plateforme (fournisseur `slack`)

Catalogue `apps/api/src/integrations/providers.ts` : `config` = `clientId` (public, il figure dans
l'adresse d'autorisation) ; `secrets` = `clientSecret`, `signingSecret` (chiffrés, écriture seule,
jamais renvoyés) ; aucun secours par l'environnement. Test de connexion : `oauth.v2.access` avec un
code inventé (`invalid_code` = identifiants acceptés ; rien n'est installé) et forme du secret de
signature (32 hexadécimaux). Manifeste : `docs/integrations/slack-app-manifest.yml` ; guide :
`docs/integrations/slack.md`.

### 2. Connexion d'une organisation

Collection `slack_connections` (une par organisation, **sans jeton**) : espace (`teamId`,
`teamName`), `appId`, `botUserId`, portées, `status` (`active` · `reconnect_required` ·
`uninstalled`), auteur et date de connexion, compteurs (`sent`, `unmatched`, `failed`), dernier code
d'erreur.

| Route | Droit | Effet |
|---|---|---|
| `GET /work/slack` | `work.read` | état (`available`, `connected`, `status`, `teamName`, `connectedBy`, `connectedAt`, `stats`, `canManage`) |
| `POST /work/slack/connect` | `organization.manage` | `{ authorizeUrl }` ; `503 SLACK_NOT_AVAILABLE` si l'application n'est pas configurée |
| `DELETE /work/slack` | `organization.manage` | `auth.revoke`, jeton détruit, connexion supprimée ; `404 SLACK_NOT_CONNECTED` |
| `GET /work/slack/channels` | `work.manage` | canaux publics (`conversations.list`, 1 000 au plus) |
| `GET /slack/oauth/callback` | public (voir § 6) | échange du code, puis **redirection** vers `/projets/parametres?onglet=slack&slack=<résultat>` |
| `POST /slack/events` | public, signé | `url_verification`, `app_uninstalled`, `tokens_revoked` |

- **`state`** : `{ organisation, utilisateur, échéance 10 min, aléa }` signé HMAC-SHA256, clé dérivée
  (HKDF) d'`AUTH_SECRET`. Au retour : signature, échéance, **session courante = utilisateur du
  state**, compte non bloqué, `organization.manage` **dans cette organisation** relu. Tout échec
  redirige avec un motif (`erreur-etat`, `erreur-session`, `erreur-droit`, `annule`,
  `erreur-echange`…) ; jamais d'erreur brute dans le navigateur.
- Échange `oauth.v2.access` (`redirect_uri` = `<API_URL>/slack/oauth/callback`) ; `token_type` doit
  valoir `bot`. Jeton au coffre d'organisation ; correspondances en cache vidées ; audit
  `slack.connected` (ou `slack.reconnected`) avec l'espace, jamais le jeton.
- **Espace partagé** : deux organisations peuvent installer l'application dans le même espace ; Slack
  leur remet le même jeton. Déconnecter A ne révoque le jeton chez Slack que si **aucune autre**
  organisation n'a de connexion active sur cet espace — sinon A détruit sa seule copie. A ne casse
  jamais B.

### 3. Destinataires

- **Message privé** (`conversations.open` puis `chat.postMessage`) aux destinataires que
  `WorkNotifier` a déjà retenus : ceux qui **voient** le projet (ADR-0060), jamais l'auteur du geste,
  selon leur préférence Slack.
- Correspondance **par adresse e-mail** (`users.lookupByEmail`), cache `slack_user_links` par
  organisation (24 h trouvé, 6 h introuvable, expiration TTL ; empreinte de l'adresse pour invalider
  au changement, l'adresse n'est pas recopiée). Introuvable : rien ne part, rien n'est montré à
  l'utilisateur, `stats.unmatched` augmente.
- **Canal d'un projet** (`slack_project_channels`) : `GET|PUT /work/projects/:projectId/slack-channel`
  (`work.read` | `work.manage`, sous `WorkVisibilityGuard`). Canal **public** seulement (`C…`), choisi
  dans la liste ou saisi ; `null` retire. Publie : assignation (y compris à soi-même), déplacement de
  tâche (« Tâche déplacée » / « Tâche terminée »), projet à risque ou en retard — une fois par geste.
- **Projet privé** : `400 SLACK_PRIVATE_PROJECT_CONFIRMATION_REQUIRED` sans `confirmPrivate: true`
  (« tout le canal verra »). La confirmation est **relue à chaque envoi** : un projet passé en privé
  après coup cesse de publier (`publishing: false`) jusqu'à reconfirmation.

### 4. Préférences

Troisième canal `slack` par événement dans `work_notification_preferences`, affiché dans « Mes
notifications » **seulement si l'organisation est connectée**. Défaut : activé pour « tâche
assignée » et « mentionné », désactivé ailleurs. Le champ est **facultatif** dans le `PUT` : un ancien
client garde la valeur enregistrée. Le résumé quotidien ne part pas sur Slack dans cette version.

### 5. Envoi

- Branché dans `WorkNotifier.deliver` (même point que l'e-mail) et `WorkNotifier.channelEvent`, par
  le jeton facultatif `SLACK_NOTIFIER` : sans module Slack, rien ne part.
- **Non bloquant** : le geste rend la main avant l'envoi ; aucune exception ne remonte. `flush()`
  attend les envois (tests, arrêt).
- Block Kit court en français : libellé de l'événement, titre (tâche), « Projet : … · organisation »,
  bouton **Ouvrir dans Lalanda** (lien = `WEB_URL` + chemin **relatif** ; une URL absolue n'est
  jamais suivie). Aucune donnée financière (aucun titre de notification `work` n'en porte).
- Erreurs : `429` → attente `Retry-After` (30 s au plus, 2 nouvelles tentatives) puis échec
  `ratelimited` compté ; `token_revoked`, `account_inactive`, `invalid_auth`, `not_authed`,
  `token_expired` → connexion **`reconnect_required`**, plus aucun envoi, bandeau « À reconnecter »
  et bouton **Reconnecter Slack** ; tout le reste → `stats.failed` + code (jamais le jeton ni le
  corps) dans le journal.

### 6. Événements Slack

`POST /slack/events` : signature `X-Slack-Signature` = `v0=` + HMAC-SHA256(`signingSecret`,
`v0:<horodatage>:<corps brut>`), horodatage à moins de 5 min, comparaison à temps constant ; sinon
`401 SLACK_SIGNATURE_INVALID`. `url_verification` → `{ challenge }`. `app_uninstalled` → toutes les
connexions de l'espace passent à `uninstalled`, jetons détruits ; `tokens_revoked` (jeton de bot) →
`reconnect_required`, jetons détruits. Audit `slack.app_uninstalled` / `slack.tokens_revoked`.

### 7. Interrupteur (ADR-0017)

Slack est **disponible** quand `clientId`, `clientSecret` et `signingSecret` sont résolus, ce qui
exige l'intégration **activée** dans `/admin` (`enabled: false` → rien, sans secours), et que
`SLACK_ENABLED` ne vaut pas `false` (défaut : allumé). Indisponible : `available: false`, bouton
« Connecter Slack » expliqué, **aucun envoi**, y compris pour les organisations déjà connectées ; les
connexions enregistrées restent intactes. Effet en moins d'une minute (cache de `SecretsService`).

### 8. Fonction d'offre

Routes sous `/work/slack` et `/work/projects/:id/slack-channel` : `@RequireFeature('run_work')`
(préfixe `/work` du catalogue). Les deux routes publiques (`/slack/…`) n'ont pas de fonction d'offre :
Slack doit pouvoir annoncer une désinstallation quelle que soit l'offre.

### 9. Développement

`SLACK_API_BASE_URL` pointe vers un faux Slack **local** (boucle `127.0.0.1` / `localhost`
seulement) ; **ignorée en production**. Sous vitest, le `fetch` réel refuse de partir : un test qui
oublierait de simuler Slack échoue.

## Conséquences

- Trois collections (`slack_connections`, `slack_user_links`, `slack_project_channels`), une nature
  de secret d'organisation, un fournisseur de plateforme, six routes.
- Tests : `slack.unit.test.ts` (state, signature, Block Kit, client simulé, 429, jetons morts,
  interrupteur, faux Slack local), `slack.e2e.test.ts` (19 cas : application absente, OAuth et refus,
  isolation A/B, messages privés, introuvables et cache, préférences, `ratelimited`, canal et projets
  privés, `SLACK_ENABLED`, `token_revoked`, Events API, déconnexion et espace partagé),
  `providers.test.ts`, `connection-tests.test.ts`, `no-secret-leak.test.ts` (jeton du bot),
  `routes-coverage.test.ts`.
- Coût : un appel `users.lookupByEmail` par destinataire et par 24 h ; deux appels par message privé.

## Décisions ouvertes

1. **Fonction d'offre dédiée** (`slack`, réservée à une offre payante) plutôt que `run_work` : non en
   R1 (grille entièrement ouverte, docs/13).
2. **Résumé quotidien** sur Slack : non en R1.
3. **Événements du canal** : commentaires et nouvelles tâches non assignées ne sont pas publiés ;
   à rouvrir sur retour d'usage.
4. **Canaux privés** (`groups:read`, invitation du bot) : non en R1 (portées minimales).
5. **Correspondance manuelle** (membre dont l'adresse Slack diffère) : non en R1 ; les introuvables
   sont seulement comptés.
6. **Accord du CTO** sur l'ajout de `slack_bot_token` au port du coffre d'organisation (§ O2).
