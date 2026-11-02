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

- [ADR-0046](ADR-0046-stocks-equipements-documents.md) — Stocks, équipements et documents (R5,
  dernier bloc du RUN) : articles stockés propres, liés facultativement au catalogue ; emplacements
  multiples ; grand livre de mouvements en ajout seul ; entrées par le port `stock-sink` des
  réceptions, sorties par **lecture** des factures finales (aucune écriture dans les ventes ni le
  circuit DGI) ; valorisation au coût moyen pondéré de gestion par devise, sans conversion ;
  inventaires à l'aveugle avec séparation des tâches ; registre des équipements, affectations,
  maintenance, garanties, estimation d'amortissement **de gestion** ; bibliothèque de documents
  avec droits par dossier, versions, échéances, chiffrement des pièces sensibles ; huit actions et
  un rôle Magasinier. Statut : **proposé, ADR-0046** (31 oct. 2026).

- [ADR-0048](ADR-0048-formulaire-public-de-prospects.md) — Formulaire public de prospects
  (web-to-lead, lot C-F d'ADR-0040) : un formulaire par organisation, **désactivé par défaut**,
  jeton non devinable et révocable, champs dans une liste fermée, consentement explicite avec la
  politique de l'organisation, prospect + contact + relance « à traiter » (opportunité seulement
  sur réglage), anti-abus sans CAPTCHA tiers, aucune IP en clair. Statut : **proposé, ADR-0048**
  (1er nov. 2026).
- [ADR-0049](ADR-0049-comptabilite-syscohada.md) — Comptabilité SYSCOHADA : pack de plan comptable
  sourcé, daté et versionné (`draft` tant qu'un expert-comptable ne l'a pas relu ; chaque compte
  candidat « à confirmer ») ; écritures générées par lecture des pièces du RUN, reliées à leur pièce,
  idempotentes, en ajout seul (contre-passations) ; compte d'attente pour tout ce qu'aucune règle
  validée ne classe ; monnaie de tenue choisie, taux de la pièce, observé ou saisi, jamais implicite ;
  journaux, grand livre, balance, lettrage, clôtures ; états **toujours « projet — à valider par un
  expert-comptable »**, exports pour lui ; mode simulation ; aucune écriture dans le réalisé ; cinq
  actions et un rôle Expert-comptable externe. Statut : **proposé, ADR-0049** (1ᵉʳ nov. 2026).
- [ADR-0050](ADR-0050-contrats-commandes-acomptes-abonnements.md) — Contrats clients, commandes
  clients, acomptes et abonnements (brief § 5.2) : commandes `CC…` avec reste à facturer ; contrats
  `CT…` versionnés avant signature, avenants datés, terme, reconduction et préavis **saisis comme
  clauses** (dates calculées, validité jamais affirmée) ; copie signée téléversée (signature
  électronique hors v1) ; acompte = brouillon `FT`/`ET` existant, rappelé en ligne C, **aucune
  imputation automatique** ; échéancier et abonnements en **brouillons** préparés par une tâche,
  jamais émis sans geste humain ; alertes dans « Mes tâches » ; aucune ligne des factures, du circuit
  DGI, du réalisé ni de la comptabilité ne change ; deux actions `sales.contract` et
  `sales.contract.approve` (ⓢ). Statut : **proposé, ADR-0050** (1ᵉʳ nov. 2026) ; socle RBAC et
  contrats partagés **appliqués au lot V0**.
- [ADR-0051](ADR-0051-rh-frais-avances-presences-evaluations.md) — RH, second volet (paie exclue) :
  notes de frais avec justificatifs, validation en deux étapes et remboursement en dépenses
  **possédées par les RH** ; avances de frais et sur salaire versées en mouvements de trésorerie et
  régularisées **sans calcul de paie** ; pointage simple, plannings, objectifs individuels et
  évaluations chiffrées, **éteints par défaut** ; aucune règle sociale, fiscale ni de droit du
  travail posée (questions au juriste et à l'expert-comptable) ; aucune note posée par l'IA ; quatre
  actions, aucun rôle nouveau ; amendement demandé d'ADR-0049 § 6.3. Statut : **proposé,
  ADR-0051** (1ᵉʳ nov. 2026).
- [ADR-0052](ADR-0052-mise-en-route-societe.md) — Mise en route d'une société : **une organisation =
  une entreprise distincte**, créée vide (rien n'est copié, reprise explicite reportée) ; parcours en
  neuf étapes reprenables (société, identité fiscale, devises, identité visuelle, facture normalisée,
  trésorerie, comptabilité et exercice, équipe, modules et offre) ; statut de complétude
  `GET /organizations/current/setup` lisible par tout membre, sans valeur ; seuls verrous ceux du
  serveur (fiche fiscale avant facture, R1 d'ADR-0021, ADR-0049 § 3.1) ; choix des modules côté
  serveur (tranche ADR-0030 D3) ; audit d'isolation **sans fuite de données**, six couplages relevés ;
  e2e d'isolation BUILD/RUN/GROW pour un même utilisateur ; aucune action RBAC nouvelle ; aucune règle
  fiscale ni juridique posée. Statut : **proposé, ADR-0052** (2 nov. 2026).

## Décisions récentes (légal)

- [ADR-0043](ADR-0043-editeur-go-freelance-sarlu.md) — L'éditeur devient Go freelance SARLU
  (SARLU de droit congolais), Televerx LLC partenaire de développement et d'intégration
  (mentions légales seulement) ; corpus `2026-10-30`, nouvelle acceptation. Statut :
  **accepté** (30 oct. 2026).
- [ADR-0047](ADR-0047-factures-des-abonnements-lalanda.md) — Factures des abonnements Lalanda :
  aucune pièce n'est remise aujourd'hui alors que les CGV promettent une facture ; options
  (A) Go freelance SARLU se facture avec son propre module ventes, (B) module dédié, (C) reçu non
  fiscal et CGV corrigées, (D) factures saisies à la main, (E) facturation hors Lalanda ;
  recommandation C puis A ; quatorze décisions ouvertes, sans valeur par défaut. Statut :
  **proposé, en attente de la dirigeante** (1ᵉʳ nov. 2026).
