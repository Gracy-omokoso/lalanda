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

1. **Modèle personnalisé d'une entreprise — livré** par
   [ADR-0029](adr/ADR-0029-modeles-de-facture-sur-mesure.md) (21 oct. 2026). Paquet `.zip`
   (`manifest.json`, `gabarit.html` en sous-ensemble strict de Mustache, `style.css` en liste
   blanche, images, polices WOFF2) écrit d'après le [guide des créateurs](modeles-facture/README.md)
   par un développeur, Claude ou Codex, vérifié en local (`pnpm --filter @lalanda/api
   modele:valider <dossier>`), puis téléversé dans « Ventes › Modèle de facture › Modèles
   personnalisés » : validation complète et rapport, aperçu EXEMPLE, activation, versions
   immuables. Zone DGI posée par le moteur hors d'atteinte du modèle ; présentation figée au gel
   par identifiant + version + empreinte du paquet. Restent ouverts (ADR-0029, décisions
   ouvertes) : relecture Lalanda avant première activation, retrait d'une version, sonde
   automatique de lisibilité.
2. **Place de marché Lalanda de modèles — préparée, non construite.** Déjà en place : format de
   paquet indépendant de l'organisation, champs `publisher`, `license`, `price` et `author` du
   manifeste, version du contrat de données (`contract`), **empreinte canonique** du paquet
   (indépendante de l'outil de compression), champ `signature` réservé. À construire : signature
   Ed25519 des éditeurs sur l'empreinte (clé publique certifiée par Lalanda), catalogue,
   certification (même batterie de validation + relecture visuelle + rendu Chromium réel),
   installation en un clic, compatibilité par `contract`, paiement et rémunération des auteurs,
   révocation.

## Définition de terminé

Critères d’acceptation approuvés, tests automatisés, audit nécessaire, documentation à jour et démonstration reproductible.
