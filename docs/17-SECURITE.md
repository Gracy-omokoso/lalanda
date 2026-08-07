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
