# Architecture Decision Records

Les décisions structurantes sont enregistrées dans ce dossier.

## Format

```markdown
# ADR-NNN — Titre

Statut : Proposed | Accepted | Superseded
Date :
Décideurs :

## Contexte
## Options considérées
## Décision
## Conséquences
## Plan de validation
## Liens
```

## Décisions récentes

- [ADR-0030](ADR-0030-refonte-ui-ux.md) — refonte de l'interface (amendé par ADR-0038).
- [ADR-0038](ADR-0038-navigation-par-modules-et-initiatives.md) — navigation par modules
  (accueil, bureaux, colonne d'applications) et renommage « Initiative » — **Accepté**, 29 oct. 2026.

## Premières décisions attendues

- architecture du monorepo;
- base de données principale;
- moteur de formules;
- authentification;
- fournisseur de paiement;
- file de tâches et stockage;
- hébergement et résidence;
- fournisseur IA et politique de données;
- stratégie de génération PDF/Excel.

## Décisions récentes (RUN)

- [ADR-0039](ADR-0039-projets-et-taches-run.md) — Projets et tâches (RUN) : gestionnaire de
  travail (module interne `work`), notifications in-app communes, marge par projet calculée par
  le moteur. Statut : Proposed (29 oct. 2026).
- [ADR-0040](ADR-0040-crm-complet.md) — CRM complet (R2) : application RUN `/crm`, comptes
  360°, pipeline v2, relances dans « Mes tâches », rapports, rôle Commercial et action
  `sales.quote`. Statut : **proposé** (29 oct. 2026).
- [ADR-0041](ADR-0041-autorisations-par-membre.md) — Autorisations par membre : le rôle devient un
  titre et un modèle de départ, avec ajouts et retraits d'actions par membre (amende ADR-0012 et
  docs/12), après le lot C0 d'ADR-0040. Statut : **proposé, ADR-0041** (29 oct. 2026).
- [ADR-0042](ADR-0042-envoi-des-documents-par-email.md) — Envoi des documents de vente par
  e-mail depuis l'aperçu (facture, avoir, pro forma, devis ; PDF joint, audit strict, limite de
  débit). Amende ADR-0035 et ADR-0040 sur ce seul point. Statut : **proposé** (30 oct. 2026).
- [ADR-0044](ADR-0044-achats-et-fournisseurs.md) — Achats et fournisseurs (R3) : fiches
  fournisseurs (coordonnées de paiement chiffrées), demandes et bons de commande à approbation par
  paliers avec séparation des tâches, réceptions sans stock, factures fournisseurs rapprochées à
  deux ou trois voies, échéancier et paiements qui créent les dépenses de la trésorerie ; cinq
  actions, aucun rôle nouveau. Lève le refus des achats d'ADR-0018. Statut : **proposé, ADR-0044**
  (30 oct. 2026).

- [ADR-0045](ADR-0045-ressources-humaines.md) — Ressources humaines (R4), **paie exclue** :
  dossiers collaborateurs distincts des comptes (données sensibles chiffrées, lecture journalisée),
  services et organigramme, absences et congés paramétrables (aucun droit légal posé) validés par le
  manager puis éventuellement les RH, documents RH et échéances, listes d'entrée et de sortie, feuille
  de temps en lecture, rapports, brief R13 à R15 ; cinq actions et un rôle Responsable RH. Statut :
  **proposé, ADR-0045** (30 oct. 2026).

## Décisions récentes (légal)

- [ADR-0043](ADR-0043-editeur-go-freelance-sarlu.md) — L'éditeur devient Go freelance SARLU
  (SARLU de droit congolais), Televerx LLC partenaire de développement et d'intégration
  (mentions légales seulement) ; corpus `2026-10-30`, nouvelle acceptation. Statut :
  **accepté** (30 oct. 2026).
