# ADR-0013 — Stockage des secrets d'intégration : chiffrés en base, écriture seule

Statut : Accepted
Date : 2026-08-08
Décideurs : CTO Lalanda (délégation Gracy Omokoso), décideur produit

## Contexte

Lalanda consomme ou consommera cinq intégrations à secret : **OpenAI** (ADR-0008),
**Stripe** et **PayPal** (paiements, docs/13), **SMTP** (vérification d'email et
invitations — aujourd'hui simulées par des logs serveur, `invitations.controller.ts:88`),
**S3/Spaces** (exports et snapshots, ADR-0009).

Aujourd'hui tout passe par l'environnement : `packages/shared/src/env/index.ts` déclare
`OPENAI_API_KEY` (requis), `S3_ACCESS_KEY`/`S3_SECRET_KEY` (optionnels), et rien pour
Stripe, PayPal ou SMTP. Conséquences opérationnelles constatées :

- changer une clé impose un redéploiement (DigitalOcean App Platform, ADR-0009) ;
- la valeur est lisible en clair par quiconque a accès à la console de déploiement ;
- aucune trace de qui a changé quoi, ni quand ;
- l'opératrice non-développeuse ne peut rien changer sans un développeur.

Le décideur produit a arbitré : les secrets d'intégration deviennent **éditables par le
super-administrateur depuis `/admin`**, chiffrés en base, en **écriture seule**. Cet ADR
formalise le schéma cryptographique, le modèle de données, le contrat d'API et — surtout —
la frontière entre ce que ce dispositif protège et ce qu'il ne protège pas.

## Options considérées

### A. Environnement seul (statu quo) — rejeté

Le plus simple et le plus éprouvé, mais il ne répond à aucun des quatre problèmes ci-dessus.
Le point bloquant n'est pas cryptographique, il est organisationnel : une équipe d'une à
deux personnes ne peut pas faire dépendre chaque rotation de clé d'un cycle de
déploiement. **Conservé pour le socle de démarrage** (§Ce qui reste en environnement).

### B. Chiffré en base + clé maîtresse en environnement — **retenu**

Sépare les deux moitiés du secret : le coffre (base) et la clé (environnement). Une fuite
de l'un seul ne donne rien. Permet la rotation à chaud, l'audit, et l'édition par un
non-développeur. C'est la décision.

### C. Hybride permanent (env prioritaire, base en secours, ou l'inverse) — rejeté

Rejeté **en tant qu'architecture cible** : deux sources de vérité pour le même secret
rendent la question « quelle clé le processus utilise-t-il réellement ? » sans réponse
fiable au pire moment, pendant un incident de paiement. Le cas classique : une variable
d'environnement oubliée masque silencieusement une clé pourtant rotée en base.

Accepté **comme chemin de migration borné**, et uniquement ainsi : `OPENAI_API_KEY` et les
`S3_*` sont déjà consommés depuis l'environnement. Pendant la transition, la résolution
est *base d'abord, environnement en secours*, avec deux garde-fous non négociables :
la source effective (`'db' | 'env'`) est **affichée dans `/admin`** et **journalisée au
démarrage** pour chaque intégration ; et un sprint de sortie est fixé, au terme duquel
les variables correspondantes deviennent optionnelles puis sont retirées du schéma. Sans
date de sortie, une transition devient un hybride permanent — c'est précisément ce qu'on
refuse.

### D. Gestionnaire de secrets managé (Vault, KMS, DO Secrets) — rejeté pour la v1

Techniquement supérieur (la clé maîtresse ne réside jamais dans le processus applicatif).
Rejeté sur le coût et la complexité opérationnelle pour une équipe de cette taille, et
parce que l'offre managée DigitalOcean au palier visé n'expose pas de KMS. Le schéma
retenu est conçu pour rendre ce basculement bon marché : le champ `keyId` et la
dérivation par enregistrement permettent de remplacer *uniquement* la couche « clé
maîtresse » par du chiffrement d'enveloppe KMS, sans toucher aux documents ni au contrat
d'API. À réévaluer dès que des paiements réels transitent.

### E. Chiffrement de champ côté client MongoDB (CSFLE) — rejeté

Exige des fonctionnalités de palier supérieur et un composant supplémentaire, et laisserait
de toute façon une clé maîtresse dans l'environnement. Complexité sans gain net ici.

## Décision

### 1. Modèle de données — collection `integrations`

Un document par intégration. `_schemaVersion: 1` (ADR-0004 §8), `strict: true`.

| Champ | Chiffré ? | Contenu |
|---|---|---|
| `provider` | non | `'openai' \| 'stripe' \| 'paypal' \| 'smtp' \| 's3'` |
| `scope` | non | `'platform'` en v1 (champ présent pour un futur `'organization'`) |
| `organizationId` | non | `null` en v1 |
| `enabled` | non | drapeau d'activation |
| `config` | non | configuration **non secrète**, liste blanche par fournisseur |
| `secrets` | **oui** (valeurs) | table `nom → EncryptedValue` |
| `lastTest` | non | `{ at, status: 'ok'\|'failed', detail }` — `detail` assaini |
| `createdAt`, `updatedAt` | non | horodatage Mongoose |
| `_schemaVersion` | non | `1` |

Index unique : `{ provider: 1, scope: 1, organizationId: 1 }`.

`EncryptedValue` :

| Champ | Secret ? | Contenu |
|---|---|---|
| `alg` | non | `'aes-256-gcm'` (littéral, vérifié au déchiffrement) |
| `keyId` | non | identifiant de la clé maîtresse ayant servi (rotation) |
| `salt` | non | 16 octets aléatoires, par enregistrement (dérivation HKDF) |
| `iv` | non | 12 octets aléatoires, **régénérés à chaque écriture** |
| `ciphertext` | — | la valeur chiffrée |
| `authTag` | non | 16 octets, authentification GCM |
| `last4` | non | 4 derniers caractères en clair, ou `null` si la valeur fait < 12 caractères |
| `updatedAt`, `updatedBy` | non | audit |

`iv`, `salt`, `authTag` et `keyId` ne sont pas des secrets — c'est une propriété du schéma,
pas une négligence : GCM les suppose publics. Ils ne sortent néanmoins **jamais** de l'API
(§4), par principe de surface minimale.

**Ce qui n'est pas chiffré, et pourquoi.** `config` contient ce qui doit rester requêtable
et affichable : hôte/port/expéditeur SMTP, endpoint/région/buckets S3, clé *publiable*
Stripe, environnement PayPal (`sandbox`/`live`), noms de modèles OpenAI. La liste blanche
est déclarée par fournisseur et **toute clé hors liste blanche est refusée en 400** —
c'est ce qui empêche qu'un secret soit glissé par erreur dans `config` et stocké en clair.

Aucune valeur dérivée du secret n'est stockée au-delà de `last4` : pas d'empreinte, pas de
HMAC de vérification. Utile pour détecter une re-saisie identique, mais c'est du matériel
supplémentaire exploitable pour rien — `updatedAt` suffit au besoin réel.

### 2. Schéma cryptographique

- **Clé maîtresse** : `SECRETS_MASTER_KEY`, 32 octets encodés base64 (44 caractères),
  générée par `openssl rand -base64 32`, validée au démarrage par le schéma Zod
  (longueur décodée = 32 octets exactement, sinon refus de démarrer, brief §9-4).
  Accompagnée de `SECRETS_MASTER_KEY_ID` (identifiant court, ex. `k1`).
- **Dérivation par enregistrement** : `dataKey = HKDF-SHA256(masterKey, salt, info)` avec
  `salt` = 16 octets aléatoires stockés dans l'enregistrement et
  `info = "lalanda:integration:<provider>:<secretName>"`.
  Deux raisons : ne jamais réutiliser une même clé AES sur l'ensemble du parc, et lier
  cryptographiquement le chiffré à son emplacement logique — un `ciphertext` déplacé de
  `smtp.password` vers `stripe.secretKey` ne se déchiffre pas.
- **Chiffrement** : AES-256-GCM. `iv` de 12 octets tiré par `crypto.randomBytes` à
  **chaque** écriture (la réutilisation d'un IV en GCM est catastrophique — c'est le seul
  vrai piège d'implémentation de ce schéma). `authTag` de 16 octets.
- **AAD** (données authentifiées additionnelles) :
  `"<documentId>|<provider>|<secretName>|<keyId>"`. Elle scelle le chiffré à son document.
  Un attaquant disposant d'un accès en **écriture** à la base ne peut pas recopier le
  chiffré d'un environnement de test vers la production, ni permuter deux champs : le
  déchiffrement échoue à la vérification du tag.
- **Déchiffrement** : uniquement dans `SecretsService.resolve(provider, name)`, appelé par
  les fabriques de clients (client OpenAI, transport SMTP, client S3, client Stripe).
  Aucune route HTTP n'appelle jamais cette méthode.
- **Type de transport en mémoire** : la valeur déchiffrée est enveloppée dans un type
  `Secret<string>` dont `toString()`, `toJSON()` et `util.inspect.custom` renvoient
  `'[redacted]'`. Un `console.log` accidentel, une sérialisation d'erreur ou un envoi vers
  un agrégateur de logs n'exposent rien (docs/17 §Journalisation).
- **Aucune mise en cache sur disque.** Cache mémoire de 60 s maximum, invalidé à toute
  écriture sur l'intégration.

### 3. Rotation de la clé maîtresse

L'environnement peut porter deux clés :
`SECRETS_MASTER_KEY` / `SECRETS_MASTER_KEY_ID` (courante) et, temporairement,
`SECRETS_MASTER_KEY_PREVIOUS` / `SECRETS_MASTER_KEY_PREVIOUS_ID`.

Au déchiffrement, la clé est choisie **par `keyId`**. Si aucun `keyId` correspondant n'est
disponible : erreur `SECRET_KEY_UNAVAILABLE`, l'intégration est marquée indisponible à
l'exécution, une alerte est levée. **Jamais** de repli silencieux sur une autre clé ni sur
une valeur par défaut : un secret qu'on ne sait plus déchiffrer doit provoquer une panne
bruyante, pas une dégradation invisible.

Procédure de rotation (`SECRETS_MASTER_KEY` change) :

1. déployer avec l'ancienne clé en `_PREVIOUS` et la nouvelle en courante ;
2. exécuter la migration `secrets:rewrap` — pour chaque `EncryptedValue` dont le `keyId`
   n'est pas le courant : déchiffrer avec l'ancienne, re-chiffrer avec la nouvelle
   (**nouveau `salt`, nouvel `iv`, nouvelle AAD**), écrire dans une transaction Mongoose
   par document (ADR-0004 §3). Idempotente : les enregistrements déjà au `keyId` courant
   sont ignorés, la migration est rejouable ;
3. vérifier qu'aucun document ne porte l'ancien `keyId`, puis retirer `_PREVIOUS` de
   l'environnement et redéployer ;
4. un `audit_events` `secret.rewrapped` par enregistrement.

**Perte de la clé maîtresse** (et non rotation) : les chiffrés sont définitivement
irrécupérables. C'est le comportement voulu. Ce n'est pas une perte de données au sens
propre — la copie faisant autorité de chaque clé vit chez le fournisseur (console Stripe,
OpenAI, etc.) ; la reprise consiste à re-saisir les cinq secrets. La clé maîtresse doit
malgré tout être sauvegardée hors ligne, séparément des sauvegardes de base, sans quoi la
séparation coffre/clé disparaît (§Menaces non couvertes).

### 4. Contrat d'API — écriture seule, strict

Routes sous `/admin/integrations`. Pas de préfixe `/v1` (ADR-0011 Contrat 4, cohérence
avec le code existant). Toutes exigent : session valide, `platform_super_admin`
(ADR-0012 §4), et ré-authentification récente (§5).

| Route | Effet | Réponse |
|---|---|---|
| `GET /admin/integrations` | liste | vue de lecture (ci-dessous), pour chaque fournisseur |
| `GET /admin/integrations/:provider` | détail | vue de lecture |
| `PUT /admin/integrations/:provider` | crée/met à jour `config` et/ou des secrets | vue de lecture |
| `POST /admin/integrations/:provider/test` | test de connexion | `{ ok, latencyMs, detail }` |
| `DELETE /admin/integrations/:provider/secrets/:name` | supprime un secret | vue de lecture |

**Vue de lecture** — la seule forme jamais renvoyée :

```jsonc
{
  "provider": "stripe",
  "enabled": true,
  "config": { "publishableKey": "pk_live_…", "webhookEndpoint": "https://…" },
  "secrets": {
    "restrictedKey":  { "configured": true,  "last4": "a1b2", "updatedAt": "…", "updatedBy": "…", "source": "db" },
    "webhookSecret":  { "configured": false, "last4": null,   "updatedAt": null, "updatedBy": null, "source": null }
  },
  "lastTest": { "at": "…", "status": "ok", "detail": "compte accessible" }
}
```

Règles non négociables :

- **Aucune route ne déchiffre vers l'extérieur.** Il n'existe pas de `GET …/reveal`, ni de
  paramètre `?includeValues`, ni de mode debug. En ajouter un est un changement d'ADR.
- **Ne sortent jamais** : `ciphertext`, `iv`, `salt`, `authTag`, `keyId`, ni aucune valeur
  déchiffrée — y compris dans les messages d'erreur, les traces de pile et les logs.
- **Le seul fragment autorisé est `last4`**, les 4 **derniers** caractères. Jamais un
  préfixe : les clés Stripe commencent par `sk_live_` / `rk_test_`, un préfixe révélerait
  le mode et le type ; le suffixe est arbitraire. Si la valeur fait moins de 12 caractères,
  `last4` vaut `null` — révéler 4 caractères d'un secret de 10 en divulgue 40 %.
- **Écriture par remplacement seulement.** Dans `PUT`, un secret absent du corps est
  laissé inchangé ; `null` le supprime ; une chaîne le remplace. Il n'y a pas de
  modification partielle d'un secret.
- **Trois barrières indépendantes** contre la fuite, parce qu'une seule finit toujours par
  être contournée : (1) une fonction de sérialisation unique `toIntegrationView()`, seul
  point de sortie ; (2) une transformation `toJSON` sur le schéma Mongoose qui supprime
  les champs chiffrés ; (3) un test qui sérialise un document complet et échoue si la
  chaîne produite contient l'une des valeurs en clair ou l'un des noms de champ interdits.
- **Assainissement des messages fournisseur** : avant journalisation ou renvoi, tout
  message d'erreur externe passe par une passe de rédaction qui remplace toute occurrence
  d'un secret connu par `[redacted]` (les API renvoient parfois la clé dans le message).

### 5. Test de connexion et ré-authentification

**Test avant enregistrement.** Quand un `PUT` soumet une nouvelle valeur de secret, le
test de connexion est exécuté **avec la valeur soumise, avant toute écriture**. En cas
d'échec : `422 INTEGRATION_TEST_FAILED`, rien n'est persisté. Une clé invalide n'entre
jamais en base — c'est ce qui évite de découvrir la panne au premier paiement client.

| Fournisseur | Test | Coût |
|---|---|---|
| OpenAI | `GET /v1/models` | nul, non facturé |
| Stripe | `GET /v1/account` | nul |
| PayPal | demande de jeton OAuth | nul |
| SMTP | `verify()` sur le transport | nul, aucun email envoyé |
| S3 | `HeadBucket` | nul |

Dérogation `?force=true` pour les cas où le test ne peut pas aboutir depuis
l'environnement courant (SMTP derrière un pare-feu, par exemple) : l'écriture a lieu,
l'audit porte `forced: true`, et `lastTest.status` reste `failed`. Une dérogation tracée
vaut mieux qu'un contrôle qu'on finit par retirer parce qu'il bloque.

**Ré-authentification.** Toute écriture sur `/admin/integrations/*` exige une
ré-authentification datant de moins de 10 minutes (saisie du mot de passe ; MFA dès qu'il
existe — docs/17 §Identité le prévoit pour les rôles sensibles). Sinon `401
REAUTH_REQUIRED`. Ceci limite l'exploitation d'une session volée ou d'un poste laissé
ouvert. Quota dédié dans `apps/api/src/security/` : 10 écritures par heure et par
utilisateur, plus strict que le global 100 req/min.

### 6. Audit

Chaque opération écrit dans `audit_events` (collection introduite par ADR-0012) :

```
{ actorUserId, actorPlatformRole, action, provider, secretName,
  last4Before, last4After, result, forced, ip, userAgent, correlationId, at, _schemaVersion }
```

`action` ∈ `integration.secret.updated` · `integration.secret.deleted` ·
`integration.tested` · `integration.config.updated` · `integration.enabled` ·
`integration.disabled` · `secret.rewrapped`.

**Jamais la valeur.** `last4Before`/`last4After` sont conservés : ils n'exposent rien de
plus que ce que `/admin` affiche déjà et ils répondent à la seule question utile en
investigation — « quelle clé a été remplacée par quelle autre ? ».

L'audit est **en ajout seul** : aucune route de modification ou de suppression. En
production, l'utilisateur MongoDB de l'application ne devrait détenir que `insert` et
`find` sur cette collection ; c'est une recommandation d'exploitation, pas un contrôle
applicatif — l'application ne peut pas se protéger d'elle-même.

L'écriture de l'audit est dans la **même transaction** que la modification du secret : pas
de secret modifié sans trace.

### 7. Recommandation opérationnelle Stripe

**Utiliser une clé restreinte (`rk_…`) et non la clé secrète complète (`sk_…`).**
Stripe permet de créer des clés dont les permissions sont définies ressource par
ressource. Périmètre recommandé pour Lalanda :

| Ressource | Droit |
|---|---|
| Customers, Subscriptions, Invoices, Prices, Products | lecture |
| Checkout Sessions, Billing Portal Sessions | écriture |
| Events (webhooks) | lecture |
| Payouts, Balance, Transfers | **aucun** |
| Connect, paramètres de compte, clés d'API | **aucun** |

Ce que cela change en cas de fuite : un attaquant lit des données clients et des
abonnements — c'est déjà une violation à déclarer — mais il **ne peut ni déplacer de
fonds, ni modifier la destination des virements, ni créer d'autres clés**. La différence
entre un incident de confidentialité et un détournement de trésorerie tient à ce seul
choix.

Règles associées :

- une clé distincte par environnement (`test` / `live`), jamais partagée ;
- le secret de signature des webhooks (`webhookSecret`) est stocké comme un secret à part
  entière et **vérifié à chaque webhook** (menace « falsification de webhook », docs/17) ;
- la clé publiable (`pk_…`) va dans `config`, en clair — elle est publique par conception ;
- même logique côté PayPal : identifiants d'application dédiés par environnement.

### 8. Ce qui reste en variable d'environnement, et pourquoi

**On n'élimine jamais l'environnement ; on ajoute une couche par-dessus.**
L'environnement conserve le strict nécessaire pour *atteindre et ouvrir* le coffre :

| Variable | Raison |
|---|---|
| `SECRETS_MASTER_KEY` (+ `_ID`, `_PREVIOUS`, `_PREVIOUS_ID`) | paradoxe d'amorçage : la clé qui protège le coffre ne peut pas être rangée dans le coffre |
| `MONGODB_URI`, `MONGODB_DB` | il faut joindre la base avant de pouvoir y lire quoi que ce soit |
| `AUTH_SECRET` | consommé par better-auth à l'amorçage, avant toute configuration en base ; sa rotation invalide toutes les sessions — c'est un acte de déploiement |
| `NODE_ENV`, `API_URL`, `WEB_URL`, ports, `LOG_LEVEL` | ce ne sont pas des secrets |
| `OPENAI_API_KEY`, `S3_*` | **transitoire** : secours pendant la migration (option C), à rendre optionnelles puis à retirer |

Critère de partage, à appliquer à tout secret futur : *si le processus en a besoin avant
d'avoir lu la base, il va dans l'environnement ; sinon il va dans `integrations`.*

### 9. Menaces couvertes

- **Fuite de la base en lecture seule** — vidage `mongodump`, instantané Atlas dérobé,
  sauvegarde mal protégée, compte d'analyse avec accès lecture, fichier `.bson` égaré.
  Les chiffrés sont inexploitables sans la clé d'environnement. **C'est le gain principal
  et il est réel** : c'est de loin le scénario de fuite le plus fréquent.
- **Accès légitime d'un développeur ou d'un exploitant à la base** : il ne voit plus les
  clés de production.
- **Exposition accidentelle par l'API ou les logs** : contrat d'écriture seule, trois
  barrières de sérialisation, type `Secret<string>`, passe de rédaction.
- **Altération en base** : l'AAD et la dérivation liée à l'emplacement empêchent le
  déplacement ou la permutation de chiffrés par un attaquant disposant de l'écriture.
- **Rotation à l'aveugle** : `keyId`, `rewrap` idempotent, audit.
- **Modification non autorisée** : super-administrateur uniquement, ré-authentification,
  quota, audit transactionnel.
- **Mise en service d'une clé invalide** : test de connexion préalable.
- **Détournement de fonds via une clé Stripe fuitée** : réduit par les clés restreintes
  (réduction du rayon d'explosion, pas suppression du risque).

### 10. Menaces NON couvertes — à lire avant de se croire protégé

- **Compromission simultanée de la base et de l'environnement = compromission de toutes
  les clés.** Exécution de code arbitraire dans le conteneur API, `.env` exfiltré, compte
  DigitalOcean compromis avec accès à l'application *et* à la base : le chiffrement
  n'apporte alors rien. Ce dispositif fait passer l'attaquant de *une* fuite à *deux*
  fuites nécessaires. Il ne rend rien impossible.
- **Compromission du processus en cours d'exécution.** L'API déchiffre en mémoire. Un
  vidage mémoire, un débogueur attaché, ou une dépendance npm malveillante dans le
  processus lisent les clés en clair — et lisent aussi `SECRETS_MASTER_KEY` dans
  `process.env`. La chaîne d'approvisionnement npm reste le maillon faible ; seule la
  surveillance des dépendances (docs/17) l'atténue.
- **Absence de HSM/KMS.** La clé maîtresse est en clair dans l'environnement du
  processus : `/proc/self/environ`, un rapport de plantage, un `console.log(process.env)`
  dans une dépendance suffisent. C'est le prix assumé de l'option D rejetée.
- **Super-administrateur malveillant ou compromis.** Il ne peut pas relire les clés
  stockées (écriture seule), mais il peut les **remplacer** par les siennes — détourner le
  SMTP, rediriger les exports S3, substituer un compte Stripe. L'audit constate, il
  n'empêche pas. Atténuation prévue : notification hors bande aux autres
  super-administrateurs à chaque `integration.secret.updated`.
- **Fuite du côté du fournisseur ou de l'opérateur.** Clé compromise chez Stripe/OpenAI,
  extension de navigateur qui lit le presse-papiers pendant le copier-coller, capture
  d'écran de la console du fournisseur. Hors de portée de ce dispositif.
- **Sauvegardes de l'environnement.** État Terraform, secrets de CI, variables du panneau
  DigitalOcean, capture d'écran d'une console : la clé maîtresse y circule aussi. La
  séparation coffre/clé ne tient que si ces deux sauvegardes ne se retrouvent jamais au
  même endroit — ce qui est une discipline humaine, pas un contrôle technique.
- **Isolation des secrets par organisation.** La v1 est de portée plateforme uniquement.
  Une organisation cliente qui voudrait brancher son propre compte Stripe n'est pas
  couverte ; `scope` existe pour cela, la logique n'est pas écrite.
- **Journaux d'un tiers.** Un fournisseur de journalisation externe qui reçoit une trace
  de pile non assainie contournerait la passe de rédaction. Aucun agrégateur externe n'est
  branché aujourd'hui ; ce point est à rouvrir quand il le sera.

## Conséquences

- Nouvelle collection `integrations`, nouveau module `apps/api/src/integrations/`,
  nouvelles routes `/admin/integrations/*`, nouvelle page `/admin`.
- `packages/shared/src/env/index.ts` gagne `SECRETS_MASTER_KEY` (**requis**, refus de
  démarrer si absent ou mal formée), `SECRETS_MASTER_KEY_ID`, et les deux `_PREVIOUS`
  optionnelles. `.env.example` documente la génération par `openssl rand -base64 32`.
- `OPENAI_API_KEY` devient optionnelle dans le schéma une fois la résolution par base en
  place ; les consommateurs (ADR-0008) passent par `SecretsService`.
- Dépend d'ADR-0012 : `platform_super_admin`, la ré-authentification et `audit_events`
  viennent de là. **ADR-0012 se livre en premier.**
- L'activation réelle de SMTP débloque `AUTH_REQUIRE_EMAIL_VERIFICATION=true` en
  production (docs/17 §Restant) et l'envoi réel des invitations
  (`invitations.controller.ts:88`).
- Coût cryptographique nul en pratique : `node:crypto` natif, aucune dépendance ajoutée.
- Le chiffrement au repos exigé par docs/17 §Données passe d'une intention à un mécanisme
  décrit et testé, pour cette catégorie de données au moins.

## Plan de validation

- **Tests unitaires de chiffrement** : aller-retour chiffrement/déchiffrement ; deux
  chiffrements de la même valeur produisent des `iv` et des `ciphertext` différents ;
  altérer un octet du `ciphertext` ou de l'`authTag` fait échouer le déchiffrement ;
  déplacer un chiffré vers un autre `secretName` ou un autre document (AAD différente)
  échoue ; `keyId` inconnu → `SECRET_KEY_UNAVAILABLE` et **jamais** de repli.
- **Test anti-fuite** : sérialiser un document `integrations` complet (via l'API et via
  `JSON.stringify` du document Mongoose) et échouer si la sortie contient la valeur en
  clair ou l'un des noms `ciphertext`, `iv`, `salt`, `authTag`, `keyId`. Test étendu aux
  corps d'erreur des cinq routes.
- **Test `last4`** : suffixe uniquement, `null` sous 12 caractères, jamais de préfixe.
- **Test du contrat d'écriture seule** : aucune route n'expose de valeur ; un secret absent
  du `PUT` reste inchangé ; `null` supprime.
- **Test de rotation** : jeu de documents en `k1`, `rewrap` vers `k2`, rejeu de la
  migration sans effet, déchiffrement correct après retrait de `k1`.
- **e2e d'autorisation** : `platform_admin`, `platform_support`, `owner` d'organisation →
  403 sur toutes les routes ; `platform_super_admin` sans ré-authentification récente →
  401 `REAUTH_REQUIRED` ; avec → 200.
- **Test du test de connexion** : fournisseur simulé en échec → 422 et **aucune écriture**
  en base (vérification explicite de l'absence du document/secret).
- **Test d'audit** : une écriture produit exactement un `audit_events` sans valeur en
  clair ; un échec d'écriture de l'audit annule la modification du secret.
- **Démarrage** : `SECRETS_MASTER_KEY` absente ou de longueur invalide → refus de démarrer
  avec un message explicite (brief §9-4).
- `pnpm format`, lint, typecheck verts ; les tests existants de `main` inchangés.

## Liens

- `docs/17-SECURITE.md` §Données, §Journalisation, §Menaces prioritaires, §Mise en production
- `docs/13-PRICING.md`, `docs/16-API.md`, `docs/24-INFRASTRUCTURE.md`
- ADR-0004 (transactions, `_schemaVersion`, migrations), ADR-0008 (OpenAI, `OPENAI_API_KEY`),
  ADR-0009 (DigitalOcean, Spaces), ADR-0011 (pas de préfixe `/v1`, format d'erreur)
- ADR-0012 (`platform_super_admin`, ré-authentification, `audit_events`) — **prérequis**
- `packages/shared/src/env/index.ts`, `apps/api/src/security/`,
  `apps/api/src/organizations/invitations.controller.ts`
