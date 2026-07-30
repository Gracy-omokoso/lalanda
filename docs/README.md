# Documentation de Lalanda

**Version initiale :** 0.1

Le dossier `docs/` constitue la source de vérité du produit. Les décisions métier, produit, UX et techniques doivent y être documentées avant ou pendant leur implémentation.

## Ordre de lecture minimal

1. [Vision](00-VISION.md)
2. [Objectifs](01-OBJECTIFS.md)
3. [Produit](02-PRODUIT.md)
4. [Parcours utilisateur](03-PARCOURS-UTILISATEUR.md)
5. [Architecture](14-ARCHITECTURE.md)
6. [Roadmap](19-ROADMAP.md)
7. [Sprints](25-SPRINTS.md)
8. [Guide Claude Code](20-CLAUDE-CODE.md)

## Index complet

### Produit et expérience

- [00 — Vision](00-VISION.md)
- [01 — Objectifs](01-OBJECTIFS.md)
- [02 — Produit](02-PRODUIT.md)
- [03 — Parcours utilisateur](03-PARCOURS-UTILISATEUR.md)
- [04 — UX/UI](04-UX-UI.md)
- [05 — Business Model Canvas](05-BUSINESS-MODEL-CANVAS.md)
- [06 — Wizard](06-WIZARD.md)
- [07 — Plan financier](07-PLAN-FINANCIER.md)
- [08 — Prévisionnel / réalisé](08-PREVISIONNEL-REALISE.md)
- [11 — Analytics et IA](11-ANALYTICS-IA.md)
- [12 — Rôles et permissions](12-ROLES-PERMISSIONS.md)
- [13 — Pricing](13-PRICING.md)

### Métier

- [09 — Country Packs](09-COUNTRY-PACKS.md)
- [10 — Diagnostics](10-DIAGNOSTICS.md)
- [21 — Moteur financier](21-MOTEUR-FINANCIER.md)
- [23 — Rapports et exports](23-RAPPORTS-EXPORTS.md)
- [Glossaire](GLOSSAIRE.md)
- [Exigences](EXIGENCES.md)
- [Sources et traçabilité](SOURCES-ET-TRACABILITE.md)

### Technique et exécution

- [14 — Architecture](14-ARCHITECTURE.md)
- [15 — Base de données](15-DATABASE.md)
- [16 — API](16-API.md)
- [17 — Sécurité](17-SECURITE.md)
- [18 — Tests](18-TESTS.md)
- [19 — Roadmap](19-ROADMAP.md)
- [20 — Claude Code](20-CLAUDE-CODE.md)
- [22 — Workflows](22-WORKFLOWS.md)
- [24 — Infrastructure](24-INFRASTRUCTURE.md)
- [25 — Sprints](25-SPRINTS.md)
- [26 — Conventions](26-CONVENTIONS.md)
- [ADR](adr/README.md)

## Cartographie cible

| Domaine | Documents prévus |
|---|---|
| Produit | Vision, objectifs, pricing, parcours, Canvas, wizard, dashboard |
| Métier | Plan financier, calculs, diagnostics, objectifs, prévisionnel/réalisé |
| International | Country Packs, devises, référentiels comptables, fiscalité |
| Plateforme | Organisations, projets, abonnements, rôles, permissions, audit |
| Technique | Architecture, données, API, sécurité, infrastructure, tests |
| Exécution | Roadmap, sprints, conventions, décisions, guide Claude Code |

## Couverture actuelle

Le cadrage transversal est présent. Le prochain enrichissement métier exige les deux sources originales : le brief Markdown complet et le classeur Excel. Tant qu’ils ne sont pas disponibles dans le dépôt, les champs, formules, taux et cas de référence détaillés ne peuvent pas être déclarés validés.

## Gouvernance

- Les calculs financiers ont une source de vérité unique et déterministe.
- L’IA explique et conseille; elle ne remplace jamais le moteur de calcul.
- Les règles comptables et fiscales sont versionnées, datées et rattachées à un Country Pack.
- Toute donnée financière conserve son origine, sa période, sa devise et son statut.
- Les exports sont reproductibles à partir d’une version figée du projet.
- Une fonctionnalité n’est terminée qu’avec critères d’acceptation, tests et documentation.

## Statuts

- **Draft** : proposition en cours.
- **Review** : soumise à validation.
- **Approved** : décision applicable.
- **Superseded** : remplacée, avec lien vers le nouveau document.
