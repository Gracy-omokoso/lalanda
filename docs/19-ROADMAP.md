# Roadmap

**Statut :** Draft  
**Version :** 0.1

## D0 — Consolider les sources

Importer le brief Markdown comme référence, inventorier le classeur Excel, produire un glossaire et des cas de référence, puis établir la traçabilité sources/exigences.

## D1 — Fonder le produit

Vision, objectifs, personas, parcours, modèle SaaS, pricing, rôles, permissions et périmètre MVP.

## D2 — Spécifier le métier

Entrées, moteur financier, états sur cinq ans, objectifs, diagnostics, prévisionnel/réalisé, Country Pack RDC/SYSCOHADA et exports.

## D3 — Concevoir la plateforme

Architecture, modèle de données, API, sécurité, observabilité, tests et déploiement.

## S0 — Fondation technique

Monorepo, qualité, CI, environnements, conventions, authentification minimale, squelette web/API et observabilité.

## S1 — Organisations, abonnements et accès

Organisations, membres, permissions, essai de 14 jours, plans, limites et audit.

## S2 — Projets, Canvas et objectifs

Projet, Country Pack, Canvas, objectifs 1 an/5 ans, versions et scénarios.

## S3 — Wizard et moteur V1

Saisie, validations, moteur, cas de référence et vues annuelles sur cinq ans.

## S4 — Diagnostics et exports

Rentabilité, trésorerie, financement, objectifs, PDF et Excel reproductibles.

## S5 — Réalisé et analytics

Saisie/import, périodes, écarts, dashboards, filtres et projections.

## S6 — Copilote et industrialisation

Explications, alertes, actions, sécurité, performance et nouveaux Country Packs.

## Prochaines mises à jour

### Modèles de facture personnalisés, puis place de marché Lalanda

Base livrée par [ADR-0028](adr/ADR-0028-modeles-de-facture-et-identite.md) (21 oct. 2026) :
six modèles intégrés, identité visuelle de l'organisation, présentation figée au gel.

1. **Modèle personnalisé d'une entreprise.** Un modèle écrit comme un **gabarit à variables**
   (HTML + CSS, sans script), remis à un développeur, à Claude ou à Codex à partir d'une
   description ou d'une maquette, puis **téléversé et installé** dans Lalanda pour une
   organisation. Il reçoit les mêmes données typées que les modèles intégrés
   (`TemplateRenderInput` : contenu imprimé en lecture seule, fragments DGI imposés, marque,
   thème) et passe par le même moteur : CSP, polices intégrées, filigrane, en-tête et pied
   imposés, **vérification de toutes les mentions DGI à chaque rendu**, version immuable une
   fois publiée. À prévoir : langage de gabarit sans exécution de code (pas de JavaScript),
   validation à l'installation (rendu de la batterie de documents de test, mentions, taille),
   bac à sable de prévisualisation, révocation.
2. **Place de marché Lalanda de modèles.** Catalogue de modèles publiés par des designers et
   développeurs, relus et certifiés par Lalanda (même batterie de vérification), installables
   en un clic ; versions, compatibilité, éventuelle rémunération des auteurs.

## Définition de terminé

Critères d’acceptation approuvés, tests automatisés, audit nécessaire, documentation à jour et démonstration reproductible.
