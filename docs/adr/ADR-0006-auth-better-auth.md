# ADR-0006 — Authentification : better-auth

Statut : Accepted
Date : 2026-07-30
Décideurs : Gracy Omokoso

## Contexte

Le brief §4 impose **better-auth** (email + mot de passe, OTP SMS, Google, multi-tenant). `docs/17-SECURITE.md` exige MFA, vérification d'adresse, isolation par organisation.

## Décision

- **better-auth** comme couche d'authentification.
- Méthodes actives dès S4 : email/mot de passe avec vérification, Google OAuth, OTP SMS (au moins un fournisseur RDC-compatible à choisir dans un ADR ultérieur).
- Isolation multi-tenant par `organizationId` sur toutes les entités (brief §5-6, `docs/17-SECURITE.md`).
- Guards de rôle NestJS pour les rôles définis par le brief §6 : `owner | admin | fondateur | comptable | mentor | viewer`.

## Conséquences

- Implémentation en Sprint 4 (auth et tenancy).
- Un test e2e vérifie qu'un utilisateur ne voit jamais les données d'une autre organisation (brief §11 S4).
- Le fournisseur SMS OTP fera l'objet d'un ADR distinct (probable Twilio ou Africa's Talking).

## Alternative rejetée

**Auth.js (NextAuth)** — proposé initialement pour son intégration Next.js. Rejeté : better-auth offre un modèle multi-tenant plus explicite et un contrôle total du schéma en base.

## Liens

- `sources/brief/lalanda-brief.md` §4, §6
- `docs/17-SECURITE.md`
- better-auth : https://www.better-auth.com/
