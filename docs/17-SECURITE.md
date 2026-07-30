# Sécurité, confidentialité et continuité

**Statut :** Draft  
**Version :** 0.1

## Menaces prioritaires

- accès inter-organisation;
- prise de compte;
- élévation de privilèges;
- export non autorisé;
- injection par fichier importé;
- falsification de webhook;
- fuite via IA ou journaux;
- altération de calcul ou Country Pack;
- perte de données.

## Contrôles

### Identité

Mots de passe gérés par fournisseur fiable, vérification d’adresse, MFA pour rôles sensibles, sessions révocables, limitation des tentatives et notification d’événements critiques.

### Autorisation

Refus par défaut, contrôle par ressource et action, tests de matrice, séparation plateforme/organisation, accès support temporaire.

### Données

TLS, chiffrement au repos, secrets gérés hors code, pièces analysées, URLs signées courtes, minimisation des données et masquage des journaux.

### Application

Validation des entrées, protection CSRF selon architecture, politiques CSP, prévention injections, dépendances surveillées, limitation de débit et quotas.

### Finance

Plans validés immuables, empreintes, audit, séparation création/approbation, version des règles et réconciliation.

### IA

Contexte minimal, séparation locataire, défense contre injection indirecte, nombres vérifiés, conservation configurable et aucun entraînement externe sans accord explicite.

## Sauvegarde et reprise

- objectifs RPO/RTO à définir par environnement;
- sauvegardes chiffrées;
- copies isolées;
- restauration testée périodiquement;
- procédure d’incident;
- état des dépendances externes;
- mode dégradé pour exports/calculs asynchrones.

## Confidentialité

Le registre de traitement documente finalités, base, catégories, destinataires, durée et droits. La politique doit tenir compte des pays servis et des fournisseurs choisis.

## Journalisation

Les événements de sécurité sont centralisés et alertés. Aucun token, secret, classeur complet ou prompt contenant des données inutiles ne doit apparaître dans les logs.

## Mise en production

Revue de menace, scan des dépendances, tests d’autorisation, secrets vérifiés, sauvegarde restaurée, procédure d’incident et responsables d’astreinte définis.
