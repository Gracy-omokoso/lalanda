# ADR-0065 — Notifications des Projets par WhatsApp

Statut : **Proposé** (besoin exprimé par la dirigeante le 5 nov. 2026 ; à valider sur les captures
`docs/refonte-ui/v7/`)
Date : 2026-11-06
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> S'appuie sur [ADR-0013](ADR-0013-stockage-secrets-integration.md) (secrets chiffrés, écriture
> seule), [ADR-0017](ADR-0017-interrupteur-integrations.md) (interrupteur),
> [ADR-0060](ADR-0060-equipes-membres-projet-visibilite.md) (visibilité),
> [ADR-0061](ADR-0061-parametres-projets-notifications-couleurs.md) (préférences) et reprend le modèle
> de [ADR-0064](ADR-0064-notifications-projets-par-slack.md) (Slack). **Aucune action ajoutée** à
> `authz/permissions.ts`. Cible : v1.18.0.

## Contexte

En RDC, le téléphone et WhatsApp sont le canal de travail réel de la plupart des équipes ; beaucoup
n'ouvrent ni leur boîte e-mail ni Slack dans la journée. La dirigeante veut que les notifications
importantes des Projets y arrivent. WhatsApp impose deux contraintes que Slack n'avait pas : l'envoi
est **payant** (Meta facture chaque conversation) et le destinataire est un **numéro de téléphone**,
donnée personnelle dont il faut prouver qu'elle appartient à la personne qui la saisit.

## Options considérées

### O1 — Quelle API

1. Passerelles non officielles (automatisation de WhatsApp Web). Écarté : contraire aux conditions de
   Meta, numéro bloqué sans préavis.
2. Fournisseur tiers (Twilio, 360dialog…). Écarté en R1 : un contrat et une facture de plus, et la
   même API Meta derrière.
3. **API officielle WhatsApp Business Cloud de Meta** (Graph API,
   `POST /<version>/<phone_number_id>/messages`). **Retenu.**

### O2 — Un numéro commun ou un numéro par organisation

1. Chaque organisation branche son propre compte WhatsApp Business. Écarté en R1 : peu de PME
   congolaises ont un compte Meta Business **vérifié** ; la démarche (vérification de l'entreprise,
   numéro dédié, modèles à faire approuver) est un frein majeur.
2. **Un numéro WhatsApp « Lalanda » commun** à toutes les organisations, identifiants de la
   **plateforme** dans `/admin`. **Retenu.** Chaque message nomme l'organisation et le projet.
   Un numéro propre à l'organisation reste une décision ouverte (n° 1).

### O3 — Comment s'assurer du consentement

1. Le gestionnaire saisit le numéro de ses membres. Écarté : aucune preuve que la personne y consent
   ni que le numéro est le sien ; donnée personnelle exposée au gestionnaire.
2. **Chacun saisit son propre numéro et le prouve par un code à 6 chiffres** reçu sur WhatsApp
   (modèle d'authentification). **Retenu.** « STOP » ou « ARRET » retire le consentement à tout
   moment.

### O4 — Dépendance

SDK écarté : un seul appel d'envoi suffit, `fetch` natif et `node:crypto`, rien de plus dans le
processus qui détient `SECRETS_MASTER_KEY` (ADR-0013 § 10).

## Décision

### 1. Fournisseur de la plateforme (`whatsapp`)

Catalogue `apps/api/src/integrations/providers.ts` :

- `config` (en clair) : `phoneNumberId`, `businessAccountId` (obligatoires), `apiVersion`
  (facultatif, défaut `v24.0`), `monthlyLimitPerOrganization` (facultatif, défaut 1 000) ;
- `secrets` (chiffrés, écriture seule, jamais renvoyés) : `accessToken` (jeton **permanent** d'un
  utilisateur système Meta, permissions `whatsapp_business_messaging` et
  `whatsapp_business_management`), `appSecret` (vérifie `X-Hub-Signature-256`), `verifyToken`
  (poignée de main du webhook) ;
- aucun secours par l'environnement.

Test de connexion : `GET /<version>/<phoneNumberId>?fields=display_phone_number,verified_name` avec
le jeton — une **lecture**, aucun message, aucune conversation facturée ; forme de `appSecret`
(32 hexadécimaux) et de `verifyToken` (16 caractères au moins). Guide :
`docs/integrations/whatsapp.md`.

**Disponible** = `phoneNumberId`, `businessAccountId`, les trois secrets résolus (intégration
**activée**, ADR-0017), `WHATSAPP_ENABLED` ≠ `false`, et **dernier test non en échec** (§ 5).
Indisponible : la vue le dit avec une raison (`not_configured`, `switched_off`, `provider_error`),
rien ne casse, cloche et e-mail continuent.

### 2. Numéro de chaque personne

Collection `whatsapp_recipients`, **un document par (organisation, personne)** : `phone` (E.164),
`status` (`pending` · `verified` · `to_verify` · `opted_out`), `verifiedAt`, `optedOutAt`, code en
attente (`codeHash`, `codeSentAt`, `codeExpiresAt`, `codeAttempts`) et `codeRequests` (heure
glissante).

| Route | Droit | Effet |
|---|---|---|
| `GET /work/whatsapp` | `work.read` | `WhatsAppView` de l'**appelant** : `available`, `unavailableReason`, `number` (`phone`, `phoneMasked`, `status`, `verifiedAt`, `code`), `codesLeftThisHour`, `quota` |
| `POST /work/whatsapp/number` | `work.read` | `{ phone }` → code envoyé, numéro `pending` |
| `POST /work/whatsapp/number/verify` | `work.read` | `{ code }` → numéro `verified` |
| `DELETE /work/whatsapp/number` | `work.read` | numéro et code effacés |
| `GET /whatsapp/webhook` | public | poignée de main Meta |
| `POST /whatsapp/webhook` | public, signé | statuts, « STOP » |

- **Normalisation** : espaces, points, tirets, parenthèses ignorés ; `00` = `+` ; un numéro national
  (`0812…`, ou neuf chiffres) reçoit `+243` ; E.164 strict, et neuf chiffres exactement après `+243`.
- **Code** : 6 chiffres (`randomInt`), seule l'**empreinte** HMAC-SHA256 est gardée (clé dérivée
  HKDF d'`AUTH_SECRET`, liée à l'organisation, la personne et le numéro) ; **10 minutes** ; **5 essais**
  (compteur atomique ; au 5e échec le code est effacé) ; **3 demandes par heure glissante** et par
  personne — l'historique survit au retrait du numéro, qui ne contourne donc pas la limite.
- **Donnée personnelle** : chaque route agit sur la session (organisation active et utilisateur) ;
  aucun identifiant de personne n'est accepté ; un collègue, le Propriétaire ou une autre
  organisation ne lisent jamais le numéro. Journaux : forme masquée `+243 81 *** **12` seulement ;
  audit (`whatsapp.code_sent`, `whatsapp.number_verified`, `whatsapp.number_removed`,
  `whatsapp.opted_out`) **sans** numéro, même masqué.
- **Changer de numéro** met l'ancien hors service jusqu'à la vérification du nouveau.

### 3. Préférences

Quatrième canal `whatsapp` par événement dans `work_notification_preferences` (Cloche, E-mail,
Slack, WhatsApp). Défaut : **activé pour « tâche assignée », « mentionné » et « échéance dépassée »**,
désactivé ailleurs — effectif seulement une fois le numéro vérifié. Champ **facultatif** dans le
`PUT` (un ancien écran garde la valeur enregistrée). **Allumer** WhatsApp sur un événement sans
numéro vérifié : `409 WHATSAPP_NUMBER_NOT_VERIFIED` (renvoyer une valeur déjà enregistrée reste
permis). La colonne n'apparaît que si le fournisseur est disponible ; ses interrupteurs ne
s'activent qu'avec un numéro vérifié. Le résumé quotidien ne part pas sur WhatsApp.

### 4. Envoi par modèles

- Branché dans `WorkNotifier.deliver`, au même point que l'e-mail et Slack, par le jeton facultatif
  `WHATSAPP_NOTIFIER` : mêmes destinataires (ceux qui **voient** le projet, ADR-0060 ; jamais
  l'auteur du geste ; préférence WhatsApp), plus le filtre propre : numéro `verified`.
- **Non bloquant** : le geste rend la main avant l'envoi ; aucune exception ne remonte ; `flush()`
  attend les envois (tests, arrêt).
- **Modèles uniquement** (hors fenêtre de 24 h, Meta refuse le texte libre). Liste fermée
  (`whatsapp-templates.ts`), langue `fr` :

  | Modèle | Catégorie | Événement |
  |---|---|---|
  | `lalanda_tache_assignee` | Utilitaire | tâche assignée |
  | `lalanda_mention` | Utilitaire | mentionné |
  | `lalanda_echeance_depassee` | Utilitaire | échéance dépassée |
  | `lalanda_notification_projet` | Utilitaire | les cinq autres événements |
  | `lalanda_code_verification` | Authentification | code de vérification |

  Texte exact à soumettre : `docs/integrations/whatsapp.md` (vérifié par le test unitaire). Bouton
  **Ouvrir dans Lalanda** = `https://app.lalanda.co/{{1}}`, suffixe = chemin **relatif** (une URL
  absolue n'est jamais suivie). Variables assainies (une ligne, 200 caractères au plus, jamais
  vides). **Aucune donnée financière.**
- **Erreurs Meta** : limite de débit (HTTP 429, codes 4, 80007, 130429, 131048, 131056) → deux
  nouvelles tentatives (1 s puis 4 s) puis échec journalisé ; destinataire injoignable (131026,
  131021, 131030), à l'envoi ou annoncé par le webhook → numéro **`to_verify`**, plus aucun envoi ;
  jeton ou droits refusés (190, 10, 200, 131005, HTTP 401) → § 5 ; tout le reste → journal (code
  seul, jamais le jeton, le numéro ni le message libre de Meta).

### 5. Jeton refusé : fournisseur signalé dans `/admin`

Un refus du jeton pendant un envoi inscrit le **dernier test** du fournisseur en échec
(`SecretsService.reportRuntimeFailure`, détail sans valeur secrète). `/admin` l'affiche ; WhatsApp
devient indisponible (`provider_error`) pour toutes les organisations, ce qui évite de solliciter
Meta en boucle ; le prochain test réussi (nouvelle saisie du jeton, ou bouton **Tester**) rétablit les
envois.

### 6. Webhook Meta

- `GET /whatsapp/webhook` : `hub.mode=subscribe` et `hub.verify_token` égal au jeton de vérification
  (temps constant) → `hub.challenge` en texte brut (caractères `[A-Za-z0-9_-]` seulement) ; sinon 403.
- `POST /whatsapp/webhook` : `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256 du **corps brut**
  (`rawBody: true` dans `main.ts`) avec `appSecret`, comparaison à temps constant ; sinon
  `401 WHATSAPP_SIGNATURE_INVALID`. Seuls les changements `messages` du `phone_number_id`
  configuré sont lus.
- **Statuts** (`sent`, `delivered`, `read`, `failed`) → `whatsapp_messages` (identifiant Meta, modèle,
  personne, état ; **ni numéro, ni contenu** ; expiration 90 jours). Les statuts arrivent dans le
  désordre : l'état ne recule jamais.
- **Opt-out** : un message entrant « STOP », « ARRET » ou « ARRETER » (casse, accents et ponctuation
  ignorés) passe **tous** les documents de ce numéro à `opted_out`. Pour reprendre : un nouveau code.
- Le webhook n'a **pas** de fonction d'offre et ignore `WHATSAPP_ENABLED` : un retrait de
  consentement ne doit jamais être perdu. Il respecte l'interrupteur de `/admin` (désactivé : secrets
  non résolus, 401).

### 7. Coût et quotas

Compteur `whatsapp_usage` par organisation et par mois **de Kinshasa** ; chaque message accepté par
Meta compte, **codes compris** (ils sont facturés). Réservation atomique avant l'envoi, rendue si
Meta refuse. Plafond `monthlyLimitPerOrganization` (défaut prudent **1 000**, de 0 à 1 000 000) ;
au-delà : plus d'envoi, la vue renvoie `quota.reached` et l'écran l'annonce ; la demande de code
répond `409 WHATSAPP_QUOTA_REACHED`.

**Offres** (docs/13) : routes `/work/whatsapp` sous `@RequireFeature('run_work')` (préfixe `/work`
du catalogue), ouvertes à toutes les offres. Une fonction d'offre `whatsapp` dédiée est une décision
ouverte (n° 2).

### 8. Interrupteur (ADR-0017)

`WHATSAPP_ENABLED=false` (casse ignorée ; défaut : allumé) coupe **tout envoi** — codes et
notifications — sans toucher aux numéros enregistrés ; la vue répond `switched_off`. Désactiver
l'intégration dans `/admin` produit le même arrêt (effet en moins d'une minute, cache de
`SecretsService`).

### 9. Développement

`WHATSAPP_API_BASE_URL` pointe vers un faux Meta **local** (boucle `127.0.0.1` / `localhost`
seulement), **ignorée en production**. Sous vitest, le `fetch` réel refuse de partir : un test qui
oublierait de simuler Meta échoue.

## Conséquences

- Trois collections (`whatsapp_recipients`, `whatsapp_messages`, `whatsapp_usage`), un fournisseur
  de plateforme, six routes, deux méthodes de `SecretsService` (`lastTestStatus`,
  `reportRuntimeFailure`).
- Tests : `whatsapp.unit.test.ts` (signature, code, modèles et règles Meta, client simulé, 429,
  classement des erreurs, faux Meta local), `whatsapp.e2e.test.ts` (23 cas : non configuré, code et
  limites, donnée personnelle, préférences, envois et visibilité, débit, injoignable, plafond, jeton
  refusé, interrupteur, isolation A/B, webhook, STOP, retrait), `providers.test.ts`,
  `connection-tests.test.ts`, `no-secret-leak.test.ts`, `routes-coverage.test.ts`.
- Coût : un message (une conversation « utilitaire ») par notification ; un message
  « authentification » par code. Tarifs Meta par pays, à suivre dans le gestionnaire WhatsApp.
- Les liens des modèles pointent vers `https://app.lalanda.co` (fixé à la soumission) : un
  environnement de recette enverrait des liens vers la production.

## Décisions ouvertes

1. **Numéro propre à l'organisation** (compte WhatsApp Business de la cliente) : non en R1.
2. **Fonction d'offre dédiée** (`whatsapp`, réservée à une offre payante, ou plafond par offre) :
   non en R1 (grille entièrement ouverte, docs/13) ; le plafond est aujourd'hui le même pour toutes.
3. **Plafond par organisation** (dérogation depuis `/admin`) : non en R1.
4. **Facturation du coût** WhatsApp aux organisations : non en R1 — à arbitrer par la direction
   (aucune règle commerciale inventée ici).
5. **Résumé quotidien** sur WhatsApp, et **réponses** (marquer une tâche terminée depuis WhatsApp) :
   non en R1.
6. **Suffixe de lien avec `?tache=`** : à confirmer au premier envoi réel (Meta peut réencoder le
   suffixe) ; repli possible sur le lien du projet.
