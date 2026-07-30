# Lalanda

Lalanda est un SaaS de planification et de pilotage financier conçu pour guider entrepreneurs et PME depuis leur modèle économique jusqu’au suivi du réalisé.

Le produit réunit un Business Model Canvas dynamique, des objectifs à 1 an et 5 ans, un assistant de saisie, un plan financier sur cinq ans, des diagnostics, le suivi prévisionnel/réalisé et des Country Packs comptables et fiscaux versionnés.

La première cible fonctionnelle est la RDC avec SYSCOHADA. L’architecture reste extensible à d’autres pays, uniquement via des packs validés.

## Documentation

Commencer par [docs/README.md](docs/README.md). Ce dossier constitue la source de vérité du produit.

Claude Code lit aussi [CLAUDE.md](CLAUDE.md), qui impose les règles de travail essentielles.

## État

La documentation fondatrice produit, UX, métier et technique est structurée. Le code applicatif n’est pas encore initialisé; l’analyse détaillée du brief et du classeur source doit précéder le Sprint S1.

## Principes non négociables

- Une seule source de vérité pour les calculs.
- Des résultats déterministes, auditables et testés.
- Une séparation stricte entre prévisionnel, scénarios et réalisé.
- L’IA explique et conseille; elle ne calcule pas les états financiers.
- Les règles pays sont datées, sourcées et versionnées.
- L’isolation des organisations et la traçabilité sont intégrées dès la conception.

## Plan d’exécution

La roadmap et les 19 lots de spécification/développement sont décrits dans [docs/25-SPRINTS.md](docs/25-SPRINTS.md).
