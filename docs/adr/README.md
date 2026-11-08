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
- [ADR-0053](ADR-0053-administration-plateforme.md) — Administration de la plateforme : la console
  Lalanda quitte la coquille des organisations (groupe de routes propre, `/admin` conservé,
  sous-domaine en décision ouverte) ; `PlatformAuthGuard` sans organisation (un opérateur n'a plus à
  être membre d'un client) ; 21 actions plateforme et matrice 6 × 21, aucun rôle nouveau ; blocage et
  suspension motivés **et effectifs** ; chaque geste au journal plateforme avec le rôle réel, miroir
  pseudonyme « Équipe Lalanda » chez le client ; minimisation (recherche obligatoire, liste blanche de
  métadonnées), conflit d'intérêts refusé ; abonnements et paiements manuels, fonctionnalités par offre
  (catalogue en code, grille ouverte), journaux, annonces in-app à deux personnes, statistiques
  agrégées, encaissements constatés (ADR-0047) ; état des lieux : aucune fuite entre organisations,
  une fuite plateforme → organisation (identifiant d'opérateur au journal client). Statut : **proposé,
  ADR-0053** (2 nov. 2026).
  Socle RBAC plateforme, garde sans organisation et contrats partagés **appliqués au lot P0**.
  Décision n° 2 **retenue le 3 nov. 2026** : double authentification TOTP obligatoire pour tout
  opérateur, **appliquée au lot P8** (§ 2.4 bis).

## Décisions récentes (légal)

- [ADR-0043](ADR-0043-editeur-go-freelance-sarlu.md) — L'éditeur devient Go freelance SARLU
  (SARLU de droit congolais), Televerx LLC partenaire de développement et d'intégration
  (mentions légales seulement) ; corpus `2026-10-30`, nouvelle acceptation. Statut :
  **accepté** (30 oct. 2026).
- [ADR-0047](ADR-0047-factures-des-abonnements-lalanda.md) — Factures des abonnements Lalanda :
  aucune pièce n'est remise aujourd'hui alors que les CGV promettent une facture ; options
  (A) Go freelance SARLU se facture avec son propre module ventes, (B) module dédié, (C) reçu non
  fiscal et CGV corrigées, (D) factures saisies à la main, (E) facturation hors Lalanda ;
  recommandation C puis A. Statut : **accepté** (décision de la dirigeante du 3 nov. 2026, à
  revoir avec l'expert-comptable) : C puis A, facture ordinaire émise par l'organisation vendeuse à
  l'encaissement confirmé, prix HT + TVA 16 % (groupe B), sans normalisation DGI avant
  l'homologation, avoir à deux personnes.
- [ADR-0054](ADR-0054-decisions-du-3-novembre.md) — Décisions de la dirigeante du 3 nov. 2026 :
  inventaire des questions ouvertes des ADR-0047 à ADR-0053 et décision prise pour chacune (source ou
  « choix produit prudent », à revoir avec le juriste et l'expert-comptable). Reconduction tacite
  permise si le contrat la prévoit, constatée par un humain ; avoir déduit du reste à facturer ;
  pointages conservés 5 ans puis purgés chaque jour ; avances sur salaire éteintes ; retrait d'une
  annonce envoyée ; CGV et confidentialité réécrites, corpus `2026-11-03`. Statut : **accepté**
  (3 nov. 2026).
- [ADR-0055](ADR-0055-themes-et-design-professionnel.md) — Thèmes au choix et design « plus
  professionnel », vague 1 sur 5 (fondations) : trois thèmes choisis par personne (Lalanda par défaut,
  Lagune clair et aéré, Ébène toujours sombre), IBM Plex Sans au lieu de Poppins, densité 14/13 px,
  rayons 4/6/8 px, principes de mouvement (120/180/240 ms, rien qui compte, rebondit ou apparaît au
  défilement ; réduction des animations respectée), jetons de graphique pour des SVG maison (vague 4),
  liens légaux vers le menu Aide (vague 2). Statut : **accepté** (3 nov. 2026).
- [ADR-0056](ADR-0056-ecran-factures-et-tableau-de-bord.md) — Écran Factures de la maquette en tranche
  verticale : colonne pleine hauteur rangée par rubrique et en-tête compact à fil d'Ariane, graphiques
  SVG maison (`packages/ui`), `GET /sales/invoices/stats` calculé par le moteur (TTC, devise de
  référence, taux figé sur la facture, retard = échéance dépassée et non soldée), tableau dense.
  Statut : **proposé** (3 nov. 2026).
- [ADR-0057](ADR-0057-interieur-projet-facon-asana.md) — Intérieur d'un projet façon Asana : onglet
  Aperçu par défaut (santé En bonne voie / À risque / En retard calculée par
  `GET /work/projects/:id/overview`), Liste groupée à lignes denses et ajout en ligne, Tableau épuré,
  panneau de tâche à champs enregistrés à la volée et fil commentaires + activité.
  Statut : **proposé** (4 nov. 2026).
- [ADR-0058](ADR-0058-accueil-projets-et-mes-taches-equipe.md) — Accueil des projets et « Mes tâches »
  façon Asana : `GET /work/portfolio` (santé en bonne voie / à risque / en retard, avancement, membres,
  chiffres de l'organisation), sections de semaine civile de Kinshasa, cercle à cocher, ajout rapide,
  couleur de projet tirée de l'identifiant ; piège du rôle « Lecteur » à l'invitation. Statut :
  **proposé** (4 nov. 2026).
- [ADR-0059](ADR-0059-roles-equipe-et-personnalisation-active.md) — Rôles de l'équipe et
  personnalisation des accès active : Salarié (`employee`, rôle par défaut à l'invitation, aucune
  donnée financière), Manager / Chef d'équipe (`team_manager`, + `work.manage`), Stagiaire
  (`intern`), Invité externe (`guest`, `PROJECT_SCOPED_ROLES` pour la v1.15) ; interrupteur
  `MEMBER_PERMISSIONS_ENABLED` allumé sauf `false` explicite. Statut : **accepté** (5 nov. 2026).
- [ADR-0060](ADR-0060-equipes-membres-projet-visibilite.md) — Équipes (RH, membres = utilisateurs,
  au-delà des services), membres d'un projet (personnes ou équipes entières, résolues à chaque
  lecture) et visibilité `organization` · `private` filtrée côté serveur sur tous les points d'entrée ;
  l'Invité externe (`PROJECT_SCOPED_ROLES`) borné à ses projets. Statut : **proposé** (5 nov. 2026).
- [ADR-0061](ADR-0061-parametres-projets-notifications-couleurs.md) — Paramètres des Projets : mes
  notifications (cloche et e-mail par événement, résumé quotidien), comportement des projets
  (créateurs, visibilité et vue par défaut, jours ouvrés, archivage automatique, modération des
  commentaires, numéros), couleurs post-it des cartes (8 pastels, contrastes testés). Statut :
  **proposé** (5 nov. 2026).
- [ADR-0062](ADR-0062-import-projet-fichier.md) — Importer un projet ou des tâches depuis un fichier
  Excel ou CSV : modèle téléchargeable (onglets Guide et Tâches), lecture sûre (`exceljs` sans formule ni
  macro, CSV `;`/`,` avec BOM), aperçu ligne par ligne (erreurs et corrections), import tout ou rien par
  un créateur commun (`WorkPlanBuilder`). Statut : **proposé** (5 nov. 2026).
- [ADR-0063](ADR-0063-construire-projet-avec-ia.md) — « Construire avec l'IA » : plan Scrum/Agile
  proposé (JSON strict validé par zod, dates tirées des sprints calculés par le serveur, sprints en
  étiquettes « Sprint N »), corrigé et signalé, relu puis créé par le même créateur que l'import ; quota
  IA commun et journal. Statut : **proposé** (5 nov. 2026).
- [ADR-0064](ADR-0064-notifications-projets-par-slack.md) — Notifications des Projets par Slack : une
  application « Lalanda » distribuée, connectée par chaque organisation à son espace (OAuth v2,
  `state` signé, jeton du bot au coffre d'organisation), messages privés selon la nouvelle colonne
  Slack des préférences, canal facultatif par projet (confirmation pour un projet privé), envoi non
  bloquant, Events API signée, interrupteur `/admin` + `SLACK_ENABLED`. Statut : **proposé**
  (5 nov. 2026).
- [ADR-0065](ADR-0065-notifications-projets-par-whatsapp.md) — Notifications des Projets par
  WhatsApp : API WhatsApp Business Cloud de Meta, un numéro « Lalanda » commun, numéro de chaque
  personne prouvé par un code à 6 chiffres (empreinte seule, 10 min, 5 essais, 3 codes/heure) et
  jamais montré aux autres, quatrième colonne WhatsApp des préférences, modèles en liste fermée (fr),
  webhook signé (statuts, « STOP »), plafond mensuel par organisation, jeton refusé signalé dans
  `/admin`, interrupteur `/admin` + `WHATSAPP_ENABLED`. Statut : **proposé** (6 nov. 2026).
- [ADR-0066](ADR-0066-suites-equipes-projets.md) — Suites des équipes et des Projets : le
  responsable d'une équipe RH valide l'étape manager de son équipe (décision n° 4 d'ADR-0059), le
  Stagiaire n'assigne qu'à lui-même (`SELF_ASSIGN_ONLY_ROLES`, décision n° 3), notifications d'un
  import regroupées par personne et par canal, numéros de tâche dans la Chronologie et le
  Calendrier, assigner dans un projet privé ajoute l'assigné aux membres (gestionnaire) ou est
  refusé. Statut : **accepté** (6 nov. 2026).
- [ADR-0067](ADR-0067-ecrans-devis-et-encaissements.md) — Écrans Devis et Encaissements sur le modèle
  de Factures : cartes, courbes sur 12 mois, répartitions (statuts, moyens de paiement), onglets à
  compteurs, tableau dense ; `GET /sales/quotes/stats` et `GET /sales/receipts/stats` calculés par le
  moteur, devise de référence et taux figé sur la facture comme ADR-0056 (devis : autres devises à
  part, jamais converties) ; tri des devis par validité. Statut : **proposé** (6 nov. 2026).
- [ADR-0068](ADR-0068-rh-invitation-matricules-postes.md) — RH lot 1 : créer un collaborateur l'invite
  sur Lalanda (membre relié tout de suite, sinon invitation d'ADR-0041 portant la fiche, reliée à
  l'acceptation ; `members.invite` exigé ; réponse identique qu'un compte existe ailleurs ou non ;
  rôle Salarié), matricule automatique `GF-0001` jamais réutilisé (compteur `EMP` de `hr_counters`,
  réservation gardée à l'anonymisation, correction par le droit RH administrateur avec motif),
  référentiel des postes `POS-001` (remplacement poste pour poste, sortie = poste vacant), import du
  personnel CSV/XLSX, jours fériés de la RDC proposés « à vérifier » (ordonnance n° 23/042 du 30 mars
  2023 via l'ACP). Statut : **accepté** (7 nov. 2026).
- [ADR-0069](ADR-0069-cartes-de-service-et-de-visite.md) — Cartes de service et cartes de visite :
  badge CR80 (ISO/IEC 7810 ID-1) avec QR de vérification (jeton aléatoire de 144 bits, révocable,
  réémis en cas de perte) vers la page publique `/v/<jeton>` (« En fonction » / « N'est plus en
  fonction » / « Carte non valide », débit borné, aucun oracle), photo facultative et consentie dans
  `hr_card_profiles` (exception documentée à ADR-0045 § 2.1), carte de visite 85 × 55 mm (fond perdu
  3 mm), vingt modèles Lalanda aux couleurs de l'identité, PDF vectoriel, PNG 300 dpi, planche et
  lot ; paquets sur mesure (code, motif ADR-0029 ; graphiste, fonds 300 dpi et zones en mm).
  Statut : **accepté** (7 nov. 2026).
- [ADR-0070](ADR-0070-paie-rdc.md) — Paie RDC (proposition) : pack de paie `cd-paie` daté et sourcé
  (IRPP de la loi n° 23/053 en remplacement de l'IPR depuis le 1ᵉʳ janv. 2026, CNSS du décret
  n° 18/041, INPP, ONEM, SMIG, tous « à confirmer par l'expert-comptable »), mode simulation par
  défaut, douze cas de référence signés avant tout bulletin réel, rubriques, éléments variables
  (absences, proposition d'heures depuis le pointage, retenue des avances d'ADR-0051), bulletins
  sans modification (rectificatif), écritures `payroll.*` vers ADR-0049 (compte d'attente tant que le
  pack v3 n'a pas les comptes sociaux), dépense possédée par la paie dans ADR-0034, états
  préparatoires sans dépôt ; écarts relevés dans `cd-2026`. Statut : **proposé** (7 nov. 2026).
- [ADR-0072](ADR-0072-documents-rh-generes.md) — Documents RH générés : attestation de travail
  (ou d'emploi) et certificat de travail depuis la fiche, trois modèles A4 aux couleurs de
  l'identité, en-tête tiré de la fiche fiscale, signataire, lieu et date choisis à la génération,
  numéros `ATT-AAAA-NNNN` / `CT-AAAA-NNNN` jamais réutilisés (`hr_counters`), PDF rangé dans les
  documents RH de la fiche (chiffré s'il est sensible) avec registre et audit ; certificat limité
  aux mentions de l'art. 79 du Code du travail (« aucune autre indication »), jamais de motif de
  sortie ni de salaire ; points juridiques « à revoir avec le juriste ». Contrats et avenants hors
  périmètre. Statut : **accepté** (8 nov. 2026).
