# Documentation de Lalanda

**Version initiale :** 0.1

Le dossier `docs/` constitue la source de vérité du produit. Les décisions métier, produit, UX et techniques doivent y être documentées avant ou pendant leur implémentation.

## Ordre de lecture

1. [00-VISION.md](00-VISION.md)
2. [01-OBJECTIFS.md](01-OBJECTIFS.md)
3. [02-PRODUIT.md](02-PRODUIT.md)
4. [03-PARCOURS-UTILISATEUR.md](03-PARCOURS-UTILISATEUR.md)
5. [14-ARCHITECTURE.md](14-ARCHITECTURE.md)
6. [19-ROADMAP.md](19-ROADMAP.md)
7. [20-CLAUDE-CODE.md](20-CLAUDE-CODE.md)

## Cartographie cible

| Domaine | Documents prévus |
|---|---|
| Produit | Vision, objectifs, pricing, parcours, Canvas, wizard, dashboard |
| Métier | Plan financier, calculs, diagnostics, objectifs, prévisionnel/réalisé |
| International | Country Packs, devises, référentiels comptables, fiscalité |
| Plateforme | Organisations, projets, abonnements, rôles, permissions, audit |
| Technique | Architecture, données, API, sécurité, infrastructure, tests |
| Exécution | Roadmap, sprints, conventions, décisions, guide Claude Code |

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
