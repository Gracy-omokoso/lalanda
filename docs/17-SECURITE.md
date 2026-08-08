# Sécurité, confidentialité et continuité

**Statut :** Draft  
**Version :** 0.2

## Implémenté (S16a)

Durcissement de production livré au sprint S16a :

### Fait

- **Authentification sur `/evaluate`** : `GET /evaluate/templates`, `GET /evaluate/templates/:slug` et `POST /evaluate` exigent une session valide (`AuthGuard`). L'exposition publique « S3-lite » est terminée. Couvert par tests unitaires (métadonnées de guard) et e2e (401 sans session, 200 avec).
- **Rate limiting** (`@nestjs/throttler`, `apps/api/src/security/`) :
  - global : 100 req/min/IP sur toutes les routes NestJS (`ThrottlerGuard` en `APP_GUARD`) ;
  - quota strict sur `POST /ai/corrective-actions` (endpoint facturé OpenAI, ADR-0008) : authentification obligatoire + 10 req/min **par utilisateur** (`UserThrottlerGuard`, compteur indexé sur l'id de session) et par IP ;
  - les routes `/auth/*` (better-auth, montées en middleware Express) ne passent pas par ces guards — better-auth applique sa propre limitation de tentatives.
- **Headers de sécurité** :
  - API : `helmet` avec ses défauts (nosniff, protection frame, HSTS…) ;
  - Web (`apps/web/next.config.mjs`) : `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **Vérification d'email** : flag better-auth `requireEmailVerification` piloté par `AUTH_REQUIRE_EMAIL_VERIFICATION` (défaut `false` en dev — aucun SMTP branché). **En production, passer à `true` dès qu'un fournisseur d'envoi d'emails est configuré** (ADR SMTP à venir).
- **Schéma d'environnement** : `REDIS_URL` et les variables `S3_*` deviennent optionnelles — requises à partir des exports asynchrones ; rien ne les consomme aujourd'hui.

### Restant (hors périmètre S16a)

- MFA pour rôles sensibles ;
- OTP / notification d'événements critiques ;
- journal d'audit centralisé et alerté ;
- envoi d'email réel (SMTP) pour activer la vérification en production ;
- CSP complète côté web (script-src, etc.) ;
- stockage du rate limiting partagé (Redis) si l'API passe en multi-instances — compteurs en mémoire process aujourd'hui.

## Implémenté (S20b) — compte, sessions, suppression

Espace compte livré au sprint S20b (`apps/api/src/account/`, `apps/web/src/app/(app)/compte/`). Contrat détaillé : docs/16 § Espace compte.

### Fait

- **Sessions révocables.** `GET /account/sessions` liste les sessions actives (appareil déduit du User-Agent, IP, dates, session courante marquée) ; révocation unitaire ou « toutes les autres ». Le `token` de session vaut le cookie de connexion : il ne sort jamais de l’API, seul un `id` opaque circule et la révocation résout `id → token` côté serveur. Un test e2e sérialise la réponse et vérifie qu’aucun token ne s’y trouve — l’écran « sessions actives » ne doit pas devenir un distributeur de sessions détournables.
- **Isolation par session, pas par contrôle ajouté.** Aucune route de l’espace compte n’accepte d’identifiant d’utilisateur, sous aucune forme. Ce n’est pas un contrôle qu’on pourrait oublier d’écrire : c’est l’absence de tout paramètre permettant de désigner autrui. Les schémas `.strict()` transforment un `userId` injecté en `400`, jamais en silence.
- **Changement de mot de passe** délégué à better-auth (`authClient.changePassword`), avec option « déconnecter mes autres appareils ». Passer par un endpoint maison obligerait à retransmettre le `Set-Cookie` de rotation de session ; le moindre écart déconnecterait l’utilisateur au moment précis où il sécurise son compte.
- **Changement d’adresse email vérifié** : mot de passe courant exigé (une session volée ne suffit pas à déplacer un compte), token opaque de 32 octets, expiration 24 h, unicité de l’adresse revérifiée **au moment de la vérification** et pas seulement à la demande. L’adresse du compte ne bouge qu’après vérification.
- **Suppression de compte** : double confirmation (adresse exacte du compte **et** mot de passe courant), portée annoncée avant la saisie, cascade explicite sur les données des organisations qui disparaissent avec le compte, puis appartenances, puis sessions et identité. L’ordre est délibéré : chaque étape laisse un état reprenable si la suivante échoue, là où supprimer l’identité en premier transformerait la moindre panne en données orphelines que plus aucune session ne peut réclamer.
- **Règle du dernier propriétaire** (docs/12) appliquée et revérifiée dans le service, pas seulement dans le contrôleur : un compte dernier propriétaire d’une organisation ayant d’autres membres est refusé (`409 LAST_OWNER`). L’éligibilité est consultable **avant** toute saisie.
- **Frontière sans organisation** (ADR-0012 §9) : `/compte` reste joignable pour un utilisateur sans aucune organisation — sinon un compte dont l’organisation a été supprimée serait enfermé dehors, sans moyen de consulter ses sessions ni de supprimer son compte. Un test e2e dédié couvre ce cas et vérifie d’abord, en précondition, qu’une route métier échoue bien en `403 NO_ORGANIZATION`.
- **Journalisation** : la demande de changement d’email est tracée sans le token. On journalise le fait, jamais le moyen.

### Bloqué par l’absence de SMTP — à ne pas confondre avec « fait »

Aucun fournisseur d’envoi d’emails n’est configuré (cf. § Restant de S16a, toujours d’actualité). Conséquences concrètes, assumées et affichées dans l’interface :

- **le changement d’adresse email ne peut pas aboutir** : le flux serveur est complet (demande, token, expiration, vérification, application, annulation) mais l’email contenant le lien n’est envoyé nulle part. `verificationDelivered` vaut `false` et la réponse porte un motif lisible. Un utilisateur final ne peut donc pas terminer l’opération seul aujourd’hui ;
- **`emailVerified` vaut `false` pour tout le monde** : la valeur est lue en base et affichée telle quelle, plutôt que de présenter un compte « vérifié » qui ne l’est pas ;
- **aucune notification n’est envoyée** : les préférences de notification sont enregistrées et seront respectées à la mise en service, mais cocher une case ne déclenche aucun message ;
- **`AUTH_REQUIRE_EMAIL_VERIFICATION` reste à `false`.**

Appliquer le changement d’adresse sans vérification lèverait le blocage en une ligne — et ouvrirait un chemin de prise de compte (§ Menaces prioritaires), transformant un manque d’infrastructure en faille. Le blocage est donc maintenu jusqu’à la mise en service d’un SMTP.

### Restant sur ce périmètre

- envoi d’email réel, prérequis de tout ce qui précède ;
- notification à l’ancienne adresse lors d’un changement (protection contre la prise de compte silencieuse) ;
- index unique sur `user.email` : la collection appartient à better-auth et n’en porte aucun ; l’unicité est aujourd’hui applicative et laisse une fenêtre de concurrence théorique. Poser l’index demande une migration des doublons éventuels — à traiter par un ADR dédié ;
- délai de grâce / restauration après suppression de compte : la suppression est immédiate et définitive.

## Menaces prioritaires

- accès inter-organisation;
- prise de compte;
- élévation de privilèges;
- export non autorisé;
- injection par fichier importé;
- falsification de webhook;
- fuite via IA ou journaux;
- altération de calcul ou Country Pack;
- perte de données.

## Contrôles

### Identité

Mots de passe gérés par fournisseur fiable, vérification d’adresse, MFA pour rôles sensibles, sessions révocables, limitation des tentatives et notification d’événements critiques.

### Autorisation

Refus par défaut, contrôle par ressource et action, tests de matrice, séparation plateforme/organisation, accès support temporaire.

### Données

TLS, chiffrement au repos, secrets gérés hors code, pièces analysées, URLs signées courtes, minimisation des données et masquage des journaux.

### Application

Validation des entrées, protection CSRF selon architecture, politiques CSP, prévention injections, dépendances surveillées, limitation de débit et quotas.

### Finance

Plans validés immuables, empreintes, audit, séparation création/approbation, version des règles et réconciliation.

### IA

Contexte minimal, séparation locataire, défense contre injection indirecte, nombres vérifiés, conservation configurable et aucun entraînement externe sans accord explicite.

## Sauvegarde et reprise

- objectifs RPO/RTO à définir par environnement;
- sauvegardes chiffrées;
- copies isolées;
- restauration testée périodiquement;
- procédure d’incident;
- état des dépendances externes;
- mode dégradé pour exports/calculs asynchrones.

## Confidentialité

Le registre de traitement documente finalités, base, catégories, destinataires, durée et droits. La politique doit tenir compte des pays servis et des fournisseurs choisis.

## Journalisation

Les événements de sécurité sont centralisés et alertés. Aucun token, secret, classeur complet ou prompt contenant des données inutiles ne doit apparaître dans les logs.

## Mise en production

Revue de menace, scan des dépendances, tests d’autorisation, secrets vérifiés, sauvegarde restaurée, procédure d’incident et responsables d’astreinte définis.
