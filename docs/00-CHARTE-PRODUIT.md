# 00 — Charte produit

**Statut :** Approved
**Version :** 1.0
**Date :** 2026-07-30

## Source directrice

La charte produit de Lalanda est constituée par le **brief fondateur** :

- **Fichier** : [`sources/brief/lalanda-brief.md`](../sources/brief/lalanda-brief.md)
- **Statut** : source historique **immuable** (ne jamais modifier — `docs/20-CLAUDE-CODE.md:42`).

Ce document fait autorité sur toutes les décisions de stack, de structure, de périmètre et de modèle économique. En cas de contradiction avec un autre document de `docs/`, se référer à **[ADR-0001](adr/ADR-0001-autorite-brief-vs-docs.md)**.

## Résumé opérationnel

Lalanda est une **application web** qui permet à un entrepreneur sans compétence comptable de produire en moins de 30 minutes un **plan financier prévisionnel complet et bancable**, à partir de **templates sectoriels réutilisables**, avec export **Excel vivant** (formules préservées) et **PDF dossier de financement**.

- **Marché primaire** : RDC et Afrique francophone. Normes **SYSCOHADA révisé**, double devise **USD/CDF**, fiscalité RDC pré-paramétrée, connectivité faible, Mobile Money.
- **Ce n'est pas** un tableur en ligne. C'est un **générateur de modèles financiers piloté par hypothèses**.

## Principe architectural non négociable (brief §3)

Trois couches, une seule source de vérité :

1. **DRIVERS** — hypothèses saisies par l'utilisateur.
2. **MOTEUR DE CALCUL** — graphe de formules, package TypeScript partagé (`packages/engine`).
3. **RENDUS** — grille web, export `.xlsx`, export PDF, API.

Une formule n'existe **qu'une seule fois**, dans `packages/engine`. Le `.xlsx` exporté contient les **formules Excel natives**, jamais des valeurs figées. Aucune valeur financière (taux, barème) n'est écrite en dur dans le frontend. Un template est une **donnée versionnée en base**, pas du code.

## Décisions figées (ADR)

| ADR | Sujet |
|---|---|
| [ADR-0001](adr/ADR-0001-autorite-brief-vs-docs.md) | Autorité du brief sur `docs/` |
| [ADR-0002](adr/ADR-0002-methode-avant-implementation.md) | Méthode : présenter le plan avant d'implémenter |
| [ADR-0003](adr/ADR-0003-monorepo-pnpm-turborepo.md) | Monorepo pnpm + Turborepo |
| [ADR-0004](adr/ADR-0004-base-de-donnees-mongodb.md) | MongoDB 7 + Mongoose 8 |
| [ADR-0005](adr/ADR-0005-moteur-formules-hyperformula.md) | Moteur HyperFormula |
| [ADR-0006](adr/ADR-0006-auth-better-auth.md) | Auth better-auth |
| [ADR-0007](adr/ADR-0007-generation-pdf-excel.md) | ExcelJS + Puppeteer + SheetJS |
| [ADR-0008](adr/ADR-0008-ia-openai.md) | Fournisseur IA : OpenAI |
| [ADR-0009](adr/ADR-0009-infrastructure-digitalocean.md) | Infrastructure DigitalOcean + Caddy |

## Micro-décisions

Les décisions non structurantes sont consignées dans [`decisions.md`](decisions.md) (date, choix, raison).
