# Plan d’exécution détaillé

**Statut :** Draft  
**Version :** 0.1

Chaque sprint est validé par démonstration, critères d’acceptation, tests et documentation. La durée dépend de l’équipe; les identifiants décrivent l’ordre, pas un calendrier garanti.

## S0 — Sources et cas de référence

- intégrer les sources en lecture seule;
- inventorier le classeur;
- créer glossaire et registre d’exigences;
- préparer golden cases.

**Sortie :** matrice Excel ↔ domaine ↔ test.

## S1 — Fondation du monorepo

- web, API, moteur et packages partagés;
- format, lint, types et tests;
- CI;
- environnements;
- conventions et ADR initiaux.

**Acceptation :** build reproductible et pipeline vert.

## S2 — Identité et organisations

- inscription, connexion et vérification;
- organisation;
- membres, invitations et rôles;
- isolation;
- audit initial.

**Acceptation :** aucune lecture croisée entre deux organisations.

## S3 — Abonnements et essai

- catalogue et entitlements;
- essai 14 jours;
- états d’abonnement;
- webhooks idempotents;
- limites côté API.

**Acceptation :** transitions et quotas testés sans suppression de données.

## S4 — Projets et Country Pack

- CRUD projet;
- sélection pays/devise;
- assignation d’une version de pack;
- accès par projet;
- archivage.

**Acceptation :** version du pack conservée et visible.

## S5 — Canvas

- neuf blocs;
- cartes, liens, commentaires;
- versions;
- liens financiers confirmés;
- export.

**Acceptation :** historique et permissions complets.

## S6 — Objectifs et scénarios

- objectifs 1 an/5 ans;
- scénarios base/prudent/ambitieux;
- duplication;
- comparaison d’hypothèses.

**Acceptation :** cibles orientées, datées et versionnées.

## S7 — Wizard V1

- schéma de champs;
- douze étapes;
- autosave;
- validations;
- progression;
- synthèse.

**Acceptation :** reprise sans perte et erreurs explicites.

## S8 — Moteur revenus et charges

- calendrier;
- prix, volumes, saisonnalité;
- coûts variables;
- charges fixes;
- agrégations.

**Acceptation :** cas unitaires et golden cases correspondants.

## S9 — Investissements et financement

- actifs et amortissements;
- apports, subventions et dettes;
- échéanciers;
- intérêts et remboursements.

**Acceptation :** continuité des stocks et dette réconciliée.

## S10 — États financiers

- résultat;
- trésorerie;
- financement;
- bilan;
- BFR et CAF;
- invariants.

**Acceptation :** bilan équilibré et golden files dans la tolérance.

## S11 — Diagnostics et objectifs

- rentabilité;
- trésorerie initiale;
- financement;
- efficacité/efficience/performance;
- explications.

**Acceptation :** chaque statut cite ses valeurs et version de règle.

## S12 — Validation et exports

- approbation immuable;
- PDF;
- Excel;
- tâches et stockage;
- validation LibreOffice.

**Acceptation :** reproduction d’un plan historique et export sans erreur.

## S13 — Réalisé

- périodes;
- saisie;
- import;
- mapping;
- clôture et réouverture;
- audit.

**Acceptation :** plan inchangé et import annulable.

## S14 — Analytics et projection

- KPI;
- filtres;
- écarts;
- graphiques;
- projection;
- alertes et actions.

**Acceptation :** chiffres identiques entre API, tables et graphiques.

## S15 — Copilote

- explications;
- résumé exécutif;
- suggestions confirmables;
- garde-fous numériques;
- quotas et audit.

**Acceptation :** aucune citation numérique non vérifiée.

## S16 — Administration plateforme

- organisations;
- support temporaire;
- Country Packs;
- templates;
- abonnements;
- audit.

**Acceptation :** double validation des règles critiques.

## S17 — Sécurité et bêta

- revue de menace;
- tests de charge;
- accessibilité;
- restauration;
- observabilité;
- support et documentation.

**Acceptation :** aucun défaut critique ouvert; procédures testées.

## S18 — Lancement

- migration bêta;
- monitoring;
- facturation réelle;
- support;
- métriques d’activation;
- plan de réponse aux incidents.

**Acceptation :** lancement réversible et tableau de santé opérationnel.
