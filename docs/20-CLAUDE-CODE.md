# Utiliser Lalanda avec Claude Code

**Statut :** Draft  
**Version :** 0.1

## Règle principale

Claude Code lit `docs/README.md`, puis les documents applicables. La documentation approuvée constitue la référence. Il n’invente aucune règle financière, fiscale, comptable ou tarifaire absente.

## Prompt de démarrage

```text
Tu travailles sur Lalanda.

Lis d’abord docs/README.md puis tous les documents requis pour la tâche.
Respecte les spécifications approuvées et les ADR.
Ne modifie pas une règle métier pour simplifier l’implémentation.
Le moteur financier est l’unique source de vérité des calculs.
L’IA ne calcule jamais les états financiers.
Avant de coder, résume le périmètre, les critères d’acceptation et les décisions ouvertes.
Implémente uniquement le prochain lot approuvé.
Ajoute ou adapte les tests et exécute les contrôles du dépôt.
Si une décision structurante manque, propose un ADR au lieu de l’inventer.
```

## Prompt de sprint

```text
Implémente le sprint <ID> défini dans la documentation Lalanda.

1. Lis les documents concernés.
2. Établis la matrice exigences → fichiers/tests.
3. Signale les blocages métier avant toute hypothèse irréversible.
4. Implémente par petits changements cohérents.
5. Exécute tests, typecheck, lint et validations d’exports.
6. Mets à jour la documentation seulement si le changement est approuvé.
7. Résume les exigences couvertes, tests passés et risques restants.
```

## Contraintes

- Ne jamais modifier les sources historiques ou classeurs originaux.
- Ne pas copier des formules dans plusieurs couches.
- Ne pas confondre plan, scénario et réalisé.
- Ne jamais modifier rétroactivement un plan figé.
- Ne pas présenter une règle pays sans source, date et version.
- Ne pas laisser l’IA écrire directement des montants validés.
- Préserver l’isolation des organisations.
- Ne pas introduire une dépendance structurante sans ADR.

## Avant une pull request

- exigences et critères référencés;
- tests pertinents passés;
- migrations documentées;
- sécurité et permissions vérifiées;
- exemples pour les changements UX;
- impact sur calculs et exports expliqué;
- documentation synchronisée;
- aucune donnée sensible.

## À ajouter

`docs/GLOSSAIRE.md`, `docs/adr/`, schéma des entrées, catalogue des formules, Country Pack RDC, matrice des rôles, pricing validé et critères détaillés par sprint.
