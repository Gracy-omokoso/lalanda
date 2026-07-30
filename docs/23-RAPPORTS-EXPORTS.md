# Rapports et exports

**Statut :** Draft  
**Version :** 0.1

## Catalogue initial

- Business Model Canvas;
- résumé exécutif;
- plan financier complet;
- besoins de financement;
- diagnostics;
- prévisionnel/réalisé;
- état mensuel de l’activité;
- rapport de scénario;
- dossier bancaire.

## Métadonnées obligatoires

Organisation, projet, scénario, plan, version, pays, Country Pack, devise, horizon, date de génération, auteur et avertissements.

## PDF

- page de garde;
- sommaire;
- hypothèses principales;
- tableaux avec répétition des en-têtes;
- graphiques accessibles;
- notes de méthode;
- pagination;
- absence de coupe illisible;
- polices incorporées si nécessaire.

## Excel

- feuille de lecture;
- données d’entrée;
- états;
- diagnostics;
- métadonnées et versions;
- cellules protégées selon usage;
- formats de nombre explicites;
- aucune formule cassée;
- validation LibreOffice.

L’export n’est pas la source de vérité : il matérialise un résultat déjà calculé.

## Word

Prévu après stabilisation des rapports PDF/Excel. Le format vise les dossiers narratifs modifiables, sans devenir une seconde implémentation des calculs.

## Dossier bancaire

Structure configurable : présentation, promoteurs, Canvas, marché, hypothèses, financement demandé, états, ratios, risques, garanties et annexes. Les exigences d’une banque spécifique sont des templates versionnés.

## Sécurité

Exports générés en tâche isolée, analysés, stockés chiffrés, accessibles par URL courte signée, expirables et journalisés. Les modèles empêchent l’injection de formules depuis des entrées utilisateur.

## Reproductibilité

Deux exports du même format, moteur, données et template doivent produire les mêmes valeurs. Les différences non déterministes comme l’horodatage sont isolées.
