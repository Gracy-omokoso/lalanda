# 30 — Couverture RH au regard du référentiel de la dirigeante, et correspondance ISO

**Statut :** Draft
**Version :** 0.1
**Date :** 2026-11-07

## Objet

Le référentiel « département RH d'une grande entreprise » fourni par la dirigeante (25 domaines,
hors dépôt) sert ici de grille de lecture. Pour chaque domaine : ce que Lalanda couvre **vérifié
dans le code** au 7 nov. 2026 (branche `main`, commit `97343ea`), ce qui manque, de quoi cela dépend,
et une priorité proposée pour une **PME congolaise** (5 à 50 personnes), pas pour une grande
entreprise. La seconde partie relie ces fonctions aux normes ISO qui touchent les RH.

Règles de lecture :

- **Livré** : présent dans `apps/api/src/hr/*`, `packages/engine/src/hr/*` ou
  `apps/web/src/app/(app)/rh/*` (ou un autre module cité). Une fonction seulement décrite dans un ADR
  n'est pas comptée.
- **Livrés depuis la première rédaction** (8 nov. 2026) :
  - **ADR-0068** — livré (v1.21.0) : invitation à la création de la fiche, matricules jamais
    réutilisés, référentiel des postes, import CSV/XLSX des collaborateurs, jours fériés de la RDC ;
    amendement du 8 nov. 2026 : changement de poste, service et manager à l'import, modèle XLSX,
    invitation révoquée quand l'e-mail change ;
  - **ADR-0069** — livré (v1.22.0) : cartes de service à QR de vérification, cartes de visite.
- **Proposé** : décrit dans un ADR au statut Proposed sans code (par exemple ADR-0070, paie).
- Priorité : **P1** (bloquant pour démarrer), **P2** (dans les trois mois), **P3** (plus tard ou
  grande entreprise).
- Lalanda ne pose **aucune règle de droit du travail** (ADR-0045 § 9, ADR-0051 § 11) : durées,
  droits à congé, préavis, conservation sont des réglages de l'organisation.

## 1. Inventaire vérifié

| Fonction | Où dans le code |
|---|---|
| Dossier collaborateur (identité, poste en texte, service, manager, type de contrat, dates d'entrée, d'essai, de fin, sortie et catégorie, rythme de travail) | `hr/employees/employee.schema.ts`, `rh/collaborateurs/[employeeId]` |
| Données sensibles chiffrées (salaire de base déclaré, coordonnées bancaires et mobile money, pièces d'identité, coordonnées personnelles, contacts d'urgence), `reveal` journalisé | `hr/private/`, `rh/collaborateurs/[employeeId]/sensible` |
| Services (arbre), organigramme par services et par ligne hiérarchique | `hr/departments/`, `GET /hr/org-chart`, `rh/services`, `rh/organigramme` |
| Équipes RH (responsable, membres) | `hr/teams/`, `rh/equipes`, `rh/equipe` |
| Types d'absence paramétrés, demandes, validation manager puis RH, soldes, grand livre, acquisition mensuelle ou annuelle | `hr/leave/`, `hr/accruals/hr-leave-accruals.job.ts`, `rh/absences`, `rh/calendrier` |
| Jours fériés (liste saisie, vide par défaut) | `hr/holidays/` |
| Documents RH (contrat, avenant, pièce d'identité, diplôme, médical, justificatif d'absence, accueil, autre), chiffrement des pièces sensibles | `hr/documents/`, `HR_DOCUMENT_CATEGORIES` (`packages/shared/src/hr/constants.ts`) |
| Listes d'entrée et de sortie (modèles, éléments assignés RH, manager, collaborateur) | `hr/checklists/`, `HR_CHECKLIST_KINDS`, `rh/collaborateurs/[employeeId]/parcours` |
| Échéances (fin d'essai, fin de CDD, expiration de pièce) et rappels | `hr/reminders/`, `rh/echeances` |
| Notes de frais, avances de frais et sur salaire, remboursement par la trésorerie | `hr/expenses/`, `hr/advances/`, `rh/frais`, `rh/moi/frais` |
| Pointage simple (désactivé par défaut), corrections validées, constat de retard ; **aucune heure supplémentaire** | `hr/attendance/`, `engine/src/hr/attendance.ts`, `rh/presences` |
| Plannings (créneaux, publication, copie de semaine, indisponibilités, besoins et manques) | `hr/planning/`, `rh/planning` |
| Objectifs individuels, cycles d'évaluation (auto-évaluation, manager, partage, accusé de réception), sections chiffrées | `hr/performance/`, `rh/objectifs`, `rh/evaluations` |
| Rapports : effectif par service, entrées et sorties par catégorie, taux de sortie, absentéisme, ancienneté ; export CSV du registre | `engine/src/hr/reports.ts`, `GET /hr/reports`, `GET /hr/export.csv`, `rh/rapports` |
| Espace salarié (« moi ») | `GET /hr/me`, `rh/moi` |
| Anonymisation, durées de conservation réglables (aucune purge par défaut) | `hr/retention/`, `POST /hr/employees/:id/anonymize` |
| Rôles et permissions (Responsable RH, `hr.*`, `leave.*`, `expenses.*`, `attendance.clock`, `performance.read`), séparation des tâches, journal d'audit | `authz/permissions.ts`, `authz/audit.service.ts` |
| Équipements affectés à un collaborateur (remise, reprise, état) | `assets/assets.schemas.ts` (`asset_assignments`, ADR-0046) |
| Lien dossier — membre de l'organisation ; la sortie **ne retire pas** l'accès (elle le propose) | ADR-0045 § 6.6 |

Absents du code (recherche du 7 nov. 2026) : recrutement, formation, paie, discipline, SST,
enquêtes, signature électronique, référentiel des postes et des compétences, budget RH.

## 2. Les 25 domaines

### A. Stratégie, organisation et planification

| # | Domaine | Couvert aujourd'hui | Manque | Dépend de | Priorité |
|---|---|---|---|---|---|
| 1 | Stratégie et gouvernance RH | indicateurs de base (rapports RH) ; rôles et audit | politique RH documentée, budget RH, risques humains, rapport de direction | budgets (non livrés) ; bibliothèque de documents (ADR-0046) pour les politiques | P3 |
| 2 | Planification des effectifs | effectif actuel par service ; besoins de planning à court terme (`staffing-needs`) | plan prévisionnel des effectifs, coût prévisionnel de main-d'œuvre relié au prévisionnel BUILD | paie (ADR-0070, proposé) ; moteur financier | P3 |
| 3 | Organisation des postes et emplois | organigramme, services, ligne hiérarchique ; intitulé de poste en **texte libre** | fiches de poste, classification et grades, pesée | **référentiel des postes (ADR-0068, livré (v1.21.0))** | P2 |

### B. Acquisition et intégration des talents

| # | Domaine | Couvert aujourd'hui | Manque | Dépend de | Priorité |
|---|---|---|---|---|---|
| 4 | Recrutement et sélection | **rien** | demandes, offres, candidatures, entretiens, offre d'embauche, passage du candidat à la fiche | référentiel des postes (ADR-0068) ; formulaire public (motif d'ADR-0048) ; ADR à écrire | P2 |
| 5 | Intégration (onboarding) | liste d'entrée, documents d'accueil, équipements affectés, fin de période d'essai rappelée, objectifs | création du matricule garanti unique dans le temps, invitation au compte à la création, signature du contrat | **ADR-0068, livré (v1.21.0)** pour matricule et invitation ; signature électronique : aucun ADR | P1 (matricule, invitation) |

### C. Administration et opérations RH

| # | Domaine | Couvert aujourd'hui | Manque | Dépend de | Priorité |
|---|---|---|---|---|---|
| 6 | Administration du personnel | dossier, pièces, données sensibles, échéances CDD et essai, export du registre, anonymisation | attestations et certificats de travail générés, avenants modèles, historique des promotions et mutations, personnes à charge, **import en masse** | **import CSV (ADR-0068, livré (v1.21.0))** ; modèles de documents ; personnes à charge : section sensible nouvelle (ADR-0070 § 4.5) | P1 (import, attestation) |
| 7 | Présences et temps de travail | pointage simple, corrections, retards, plannings, feuille de temps des projets | heures supplémentaires, télétravail, astreintes, contrôle des repos ; **jours fériés RDC** | jours fériés (ADR-0068, livré (v1.21.0)) ; durée légale : question au juriste (ADR-0051 J3) ; ADR-0070 § 5.2 | P2 |
| 8 | Congés et absences | types paramétrés, demandes, validation, soldes, acquisition, calendrier, justificatifs, absentéisme | droits légaux préremplis (aucun, par principe), planning annuel des congés, remplacement | jours fériés (ADR-0068) ; Country Pack sourcé pour les droits | P1 (jours fériés) |
| 9 | Gestion de la paie | **rien** (exclue par ADR-0045, ADR-0051, ADR-0054 D6) ; avances sur salaire sans retenue calculée | tout le domaine | **ADR-0070 (proposé)** ; expert-comptable ; ADR-0068 | P1 |
| 10 | Rémunération et avantages | salaire de base déclaré, chiffré, historisé | grilles, primes, avantages, allocations familiales, assurance santé, équité salariale | ADR-0070 ; question au juriste (allocations familiales, P-J3) | P2 |

### D. Développement et performance

| # | Domaine | Couvert aujourd'hui | Manque | Dépend de | Priorité |
|---|---|---|---|---|---|
| 11 | Formation et compétences | **rien** (le diplôme est une catégorie de document) | besoins, plan, sessions, présences, évaluation, obligations réglementaires | référentiel des postes et des compétences ; INPP (financement) ; ADR à écrire | P3 |
| 12 | Gestion de la performance | objectifs individuels, cycles, auto-évaluation et évaluation manager, partage, accusé | objectifs d'équipe, 360°, plans d'amélioration, lien à la rémunération | paie (ADR-0070) pour le lien rémunération | P3 |
| 13 | Carrières et mobilité | changement de poste, de service ou de manager par modification de la fiche (audit) | historique de carrière lisible, demandes de mutation | référentiel des postes (ADR-0068, livré (v1.21.0)) ; « Changer de poste » avec historique des titulaires (amendement du 8 nov. 2026) | P3 |
| 14 | Talents et succession | **rien** | 9-box, plans de succession, postes critiques | évaluations (livré), postes (ADR-0068, livré (v1.21.0)) | P3 |

### E. Relations sociales et conformité

| # | Domaine | Couvert aujourd'hui | Manque | Dépend de | Priorité |
|---|---|---|---|---|---|
| 15 | Relations sociales | **rien** | délégation syndicale, réunions, accords | ADR à écrire ; juriste | P3 |
| 16 | Discipline et conflits | **rien** (le commentaire de sortie est chiffré) | demandes d'explications, avertissements, sanctions, droits de la défense | juriste (procédure du Code du travail) ; motif de chiffrement d'ADR-0045 | P2 |
| 17 | Droit du travail et conformité | registre de traitement « gestion du personnel » et « présences » (docs/28), données chiffrées, conservation réglable | règlement intérieur versionné et accusé de lecture, obligations déclaratives | bibliothèque de documents (ADR-0046) ; paie (ADR-0070) pour les déclarations | P2 |
| 18 | Santé et sécurité (SST) | type d'absence « Maladie » confidentiel, pièce médicale chiffrée | visites médicales, accidents du travail, registre des risques | ADR à écrire ; CNSS risques professionnels | P2 |
| 19 | Bien-être et engagement | **rien** | enquêtes, suggestions | ADR à écrire | P3 |
| 20 | Culture et communication interne | notifications, cloche, brief du matin (sans donnée nominative sensible) | notes de service diffusées avec accusé de lecture | bibliothèque de documents (ADR-0046) | P3 |

### F. Mobilité, sorties, systèmes et contrôle

| # | Domaine | Couvert aujourd'hui | Manque | Dépend de | Priorité |
|---|---|---|---|---|---|
| 21 | Mobilité internationale | pièces d'identité et titres de séjour avec expiration rappelée | dossiers d'expatriation, permis de travail suivis, fiscalité des expatriés | ADR-0070 (P-C13) | P3 |
| 22 | Départs (offboarding) | sortie avec catégorie, liste de départ, annulation des absences futures, reprise des équipements, analyse des sorties | retrait d'accès **automatique** (proposé seulement), solde de tout compte, certificat de travail | paie (ADR-0070, lot ultérieur) ; modèles de documents | P2 |
| 23 | SIRH | rôles, permissions par membre, circuits de validation, notifications, dossiers numériques, règles de congés, pointage configurable, audit | intégration paie, signature électronique, import en masse | ADR-0068 (import, livré en v1.21.0) ; ADR-0070 | P1 (import) |
| 24 | Reporting et analytique | effectif, mouvements, taux de sortie, absentéisme, ancienneté, échéances | masse salariale, coûts de recrutement et de formation, pyramide des âges (la date de naissance est sensible et non exploitée, par minimisation) | paie (ADR-0070) ; recrutement ; formation | P2 |
| 25 | Audit et amélioration continue | journal d'audit strict sur les données sensibles, `reveal` limité | revue de conformité des dossiers (pièces manquantes, expirées), suivi d'actions correctives | rapports (livré) | P2 |

### Lots livrés depuis, rappel

- **ADR-0068**, livré (v1.21.0), touche les domaines 3, 5, 6, 7, 8, 13 et 23 : matricule jamais
  réutilisé, référentiel des postes, import en masse, jours fériés proposés « à vérifier » ;
  l'amendement du 8 nov. 2026 ajoute le changement de poste (domaine 13) et le service et le manager
  à l'import.
- **ADR-0069**, livré (v1.22.0), touche les domaines 5 (remise de la carte à l'entrée), 20 et 22
  (carte invalidée à la sortie par sa vérification QR).

## 3. Les cinq manques les plus importants pour une PME congolaise qui démarre lundi

1. **Paie** (domaine 9) : l'entreprise paie ses salariés dès la fin du premier mois ; sans paie,
   elle calcule ailleurs et ressaisit. Voie proposée : ADR-0070, lot P0 puis P2 (export des éléments
   variables), simulation ensuite, réel après relecture de l'expert-comptable.
2. **Import des collaborateurs et matricules stables** (domaines 5, 6, 23) : saisir trente fiches une
   par une décourage ; un matricule réutilisé fausse la CNSS et les bulletins. Voie : ADR-0068, livré
   (v1.21.0).
3. **Jours fériés de la RDC** (domaines 7, 8) : la liste vide fausse les décomptes d'absence dès le
   premier congé. Voie : ADR-0068, livré (v1.21.0), sourcé et daté.
4. **Documents générés** (domaines 6, 22) : attestation de travail, certificat de travail, contrat et
   avenant depuis un modèle. Aucun ADR ; à cadrer après ADR-0068.
5. **Retrait des accès à la sortie et discipline tracée** (domaines 16, 22) : aujourd'hui la sortie
   propose le retrait sans l'imposer, et aucune procédure disciplinaire n'est suivie. Voie : décision
   ouverte n° 13 d'ADR-0045 à retrancher ; ADR « discipline » à écrire avec le juriste.

## 4. Correspondance ISO

### 4.1 Rappel

Une certification ISO s'applique à une **organisation** (son système de management, sur un périmètre,
après audit par un organisme accrédité), **jamais à un logiciel**. Lalanda peut aider une organisation
à **produire et conserver des preuves** ; il ne la rend pas conforme et ne promet aucune
certification. Aucun écran ni document commercial ne doit dire « conforme ISO » ou « certifié ISO ».
Les clauses sont citées par leur numéro et leur intitulé, sans reproduire le texte des normes
(protégé par le droit d'auteur) ; l'organisation doit disposer de la norme elle-même.

Deux familles :

- normes **d'exigences**, certifiables : ISO 9001:2015, ISO 45001:2018, ISO/IEC 27001:2022,
  ISO 30401:2018 ;
- normes **de lignes directrices**, non certifiables : ISO 30414 (vérifier l'édition en vigueur,
  2018 ou sa révision), ISO 30405:2016, ISO 10015:2019.

### 4.2 Tableau

« Aujourd'hui » = preuve que Lalanda peut produire avec le code livré ; « Demain » = avec un lot en
cours ou proposé, cité.

#### ISO 9001:2015 — Systèmes de management de la qualité

| Clause | Preuve aujourd'hui | Preuve demain |
|---|---|---|
| 7.1.2 Ressources humaines | registre du personnel (export CSV), organigramme, effectifs par service, plannings et manques | référentiel des postes (ADR-0068) : effectif par poste |
| 7.2 Compétences | diplômes en documents RH ; évaluations et objectifs datés | fiches de poste avec compétences requises (ADR-0068 puis ADR à écrire) ; plan de formation (domaine 11, aucun ADR) |
| 7.3 Sensibilisation | — (aucun accusé de lecture) | notes de service et règlement intérieur avec accusé de lecture (domaines 17, 20, aucun ADR) |
| 7.5 Informations documentées (7.5.1 à 7.5.3) | documents RH catégorisés, versions par dépôt successif, accès par rôle, pièces sensibles chiffrées, journal d'audit, conservation réglable | modèles de documents générés et versionnés (manque n° 4) |

#### ISO 30414 — Lignes directrices pour le reporting interne et externe sur le capital humain

| Domaine d'indicateurs | Aujourd'hui | Demain |
|---|---|---|
| Effectifs | effectif, effectif moyen, par service, par type de contrat | par poste (ADR-0068) |
| Recrutement, mobilité et rotation | entrées, sorties par catégorie, taux de sortie, ancienneté | délai et coût de recrutement (domaine 4, aucun ADR) |
| Santé, sécurité et bien-être | absentéisme (types `countsAsAbsenteeism`) | accidents du travail (domaine 18, aucun ADR) |
| Coûts | — | masse salariale, coût employeur (ADR-0070) |
| Compétences et capacités ; productivité ; leadership ; relève ; culture ; diversité ; conformité et éthique | — (la minimisation exclut sexe et âge du dossier courant ; un indicateur de diversité exigerait une décision et une base légale) | selon les lots formation, succession, enquêtes ; diversité : décision de la dirigeante et avis du juriste |

#### ISO 45001:2018 — Santé et sécurité au travail

| Clause | Aujourd'hui | Demain |
|---|---|---|
| 5.4 Consultation et participation des travailleurs | — | domaine 15 ou 19 (aucun ADR) |
| 6.1.2 Identification des dangers et évaluation des risques et opportunités | — | registre des risques (domaine 18, aucun ADR) |
| 7.2 Compétences | voir ISO 9001 § 7.2 | formations de sécurité (domaine 11) |
| 9.1 Surveillance, mesure, analyse et évaluation des performances | absentéisme par service | taux de fréquence des accidents (domaine 18) |
| 10.2 Événement indésirable, non-conformité et action corrective | — | déclaration d'accident et suivi d'actions (domaine 18) |

#### ISO/IEC 27001:2022 — Annexe A, mesures liées aux personnes (A.6)

| Mesure | Aujourd'hui | Demain |
|---|---|---|
| A.6.1 Sélection des candidats | pièces d'identité chiffrées, dates d'expiration | recrutement (domaine 4) avec vérifications tracées |
| A.6.2 Termes et conditions du contrat de travail | contrat et avenants en documents RH | contrats générés depuis un modèle, signature (manque n° 4) |
| A.6.3 Sensibilisation, enseignement et formation à la sécurité de l'information | — | accusé de lecture, formation (domaines 11, 20) |
| A.6.4 Processus disciplinaire | — | domaine 16 (aucun ADR) |
| A.6.5 Responsabilités consécutives à la fin ou à la modification du contrat de travail | liste de départ, reprise des équipements, annulation des absences futures ; retrait d'accès proposé | retrait d'accès imposé ou tracé (manque n° 5) ; carte de service invalidée (ADR-0069, livré (v1.22.0)) |
| A.6.6 Accords de confidentialité ou de non-divulgation | dépôt du document signé (catégorie « autre ») | catégorie dédiée et rappel d'expiration |
| A.6.7 Travail à distance | — | télétravail (domaine 7) |
| A.6.8 Déclaration des événements liés à la sécurité de l'information | — (hors RH) | — |

Mesures voisines que Lalanda alimente aussi : droits d'accès par rôle et par membre (A.5.15, A.5.18),
journalisation (A.8.15), protection des données personnelles (A.5.34).

#### ISO 30405:2016 — Lignes directrices sur le recrutement

Aujourd'hui : **aucune preuve** (pas de module de recrutement). Demain : demande de recrutement
validée, offre publiée, candidatures horodatées, motifs de décision, information des candidats non
retenus, durée de conservation des candidatures (juriste) — domaine 4, ADR à écrire.

#### ISO 10015:2019 — Lignes directrices pour le management des compétences et le développement des personnes

Aujourd'hui : évaluations et objectifs datés, diplômes. Demain : besoins de compétences par poste
(ADR-0068 puis ADR à écrire), plan de formation, évaluation de l'efficacité des formations (domaine 11).

#### ISO 30401:2018 — Systèmes de management des connaissances (facultatif)

Aujourd'hui : bibliothèque de documents (ADR-0046) et listes d'entrée réutilisables. Demain :
passation des responsabilités dans la liste de départ (domaine 22). Pertinence faible pour une PME qui
démarre.

## 5. Ce que ce document ne dit pas

- Il ne vaut ni audit RH, ni avis juridique, ni diagnostic de conformité ISO.
- Les priorités sont des **propositions** ; l'ordre des lots appartient à la dirigeante.
- Les domaines marqués « aucun ADR » exigent un ADR avant tout code (CLAUDE.md).

## Liens

- [ADR-0045](adr/ADR-0045-ressources-humaines.md), [ADR-0051](adr/ADR-0051-rh-frais-avances-presences-evaluations.md),
  [ADR-0054](adr/ADR-0054-decisions-du-3-novembre.md), [ADR-0046](adr/ADR-0046-stocks-equipements-documents.md),
  [ADR-0070](adr/ADR-0070-paie-rdc.md) (paie, proposé).
- [docs/12 — Rôles et permissions](12-ROLES-PERMISSIONS.md), [docs/17 — Sécurité](17-SECURITE.md),
  [docs/28 — Conformité légale](28-CONFORMITE-LEGALE.md).
