# ADR-0054 — Décisions du 3 novembre 2026 : questions ouvertes des ADR-0047 à ADR-0053 tranchées pour avancer, à revoir avec le juriste et l'expert-comptable

Statut : **Accepté**
Date : 2026-11-03
Décideur : Gracy Omokoso (dirigeante de Go freelance SARLU).

> **La décision, dans ses mots :** « ne perdons pas le temps, fais ce qui s'applique en RDC Congo et
> nous allons améliorer au fur et à mesure avec les experts. Aucun client n'a encore commencé à
> utiliser Lalanda. »

## Contexte

Les ADR-0047 à ADR-0053 (1ᵉʳ et 2 nov. 2026) ont laissé des **décisions ouvertes** à la dirigeante et
des **questions** au juriste, à l'expert-comptable et à la DGI. La plupart portaient une valeur par
défaut prudente, appliquée en attendant. Aucun client n'utilisant encore Lalanda, la dirigeante tranche
le 3 nov. 2026 pour avancer :

- reconduction tacite et préavis des contrats clients (ADR-0050) ;
- pointage et durée de conservation (ADR-0051) ;
- nouvelles conditions de vente à faire accepter ;
- toutes les décisions ouvertes restantes des ADR-0050, 0051, 0052 et 0053, qui **gardent leur valeur
  par défaut** sauf mention contraire ci-dessous.

## Règle de lecture

Chaque ligne indique la décision et sa **base** :

- **Source** — un texte cité, uniquement lorsqu'il est connu avec certitude et qu'il fonde réellement
  le choix : Code du travail de la RDC (loi n° 015/2002 du 16 octobre 2002), Code civil congolais
  livre III (des contrats ou des obligations conventionnelles), Acte uniforme OHADA relatif au droit
  commercial général (AUDCG), texte congolais de protection des données s'il s'applique. **Aucun
  article n'est cité de mémoire** ; une règle dont la portée exacte n'est pas vérifiée n'est **pas**
  présentée comme une obligation.
- **Choix produit prudent** — sinon : c'est un choix de Go freelance SARLU, pas une conformité.
- Sauf mention contraire, chaque décision est une **décision de la dirigeante du 3 nov. 2026, à revoir
  avec le juriste / l'expert-comptable** (abrégé « *à revoir* » dans les tableaux).

Les questions posées **au conseil** (juriste, expert-comptable, DGI) ne disparaissent pas : la
dirigeante tranche ce que le produit fait en attendant, la question reste posée.

## 1. Ce qui change dans le produit

| # | Décision | Base | Mise en œuvre |
|---|---|---|---|
| D1 | **Reconduction tacite** des contrats clients : permise si le contrat la prévoit. Le préavis est celui de la clause saisie. Lalanda ne l'impose pas, alerte avant l'échéance et la fait **constater par un humain** (fonctionnement déjà en place, ADR-0050 décision n° 9). | Source : principe de liberté contractuelle et de force obligatoire des conventions, Code civil congolais livre III. Durée, information préalable et préavis minimal éventuels : **non établis** — choix produit prudent. *À revoir.* | Aucun changement de code ; CGV § « Outils de gestion ». |
| D2 | **Avoir dans le reste à facturer** : un avoir gelé lié à une facture d'une commande **réduit le facturé** et rouvre d'autant le reste à facturer. | Choix produit prudent (cohérent avec ADR-0023 : l'avoir annule tout ou partie de sa facture d'origine). *À revoir avec l'expert-comptable (EC1, EC5).* | Moteur `contracts` 1.1.0 (`credited` par ligne) ; API ; fiche commande ; e2e `sales-orders`. |
| D3 | **Pointage — conservation** : 5 ans (60 mois) par défaut, **réglable** par l'organisation (1 à 600 mois ; `null` posé par elle = aucune purge). **Purge automatique** quotidienne des pointages et corrections antérieurs, idempotente, journalisée (`hr.attendance.purged`). | Choix produit prudent : aucune durée légale n'est affirmée ; le Code du travail (loi n° 015/2002) n'est pas invoqué pour cette durée. *À revoir (J4, C5).* | `HR_ATTENDANCE_RETENTION_DEFAULT = 60`, tâche `hr.attendance.retention`, e2e `hr-attendance`. |
| D4 | **Pointage — information des salariés** : un texte est affiché à l'écran de pointage (ce qui est enregistré, qui le lit, durée réglée, à qui s'adresser). L'organisation reste responsable de l'information de son personnel. | Choix produit prudent. Le texte de protection des données applicable en RDC (le Code du numérique, ordonnance-loi n° 23/010 du 13 mars 2023, est une piste) et ses obligations : **à confirmer par le juriste**. *À revoir (J4).* | `attendanceEmployeeNotice` (shared), écran « Présences ». |
| D5 | **Pointage — activation** : reste éteint par défaut ; l'organisation peut l'activer sans attendre la réponse J4. Aucune localisation, jamais. | Choix produit prudent. *À revoir.* | Inchangé (ADR-0051 décision n° 8, défaut levé seulement pour l'attente de J4). |
| D6 | **Avances sur salaire et retenue déclarée sur la paie** : restent **éteintes**, la paie étant exclue de Lalanda (ADR-0045). Avance de frais active. | Choix produit prudent. Les règles de retenue sur salaire du Code du travail (loi n° 015/2002) ne sont pas mises en œuvre. *À revoir (J1, J2).* | Inchangé (ADR-0051 décision n° 5). |
| D7 | **CGV** : applicables dès la version `2026-11-03`, paiement manuel compris ; états réels décrits (paiement manuel, Stripe et PayPal s'ils sont proposés, octrois, contrats clients, formulaire de prospects, annonces, console de la plateforme). | Choix produit prudent, détaillé § 3. *À revoir.* | `cgv/page.tsx`. |
| D8 | **Politique de confidentialité** : nouvelles données décrites (pointage, évaluations, notes de frais, formulaire de prospects, journaux et statistiques de la plateforme) et leurs durées. | Choix produit prudent : rôle de Lalanda « pour le compte de l'organisation » décrit sans qualification juridique. *À revoir (docs/28 § 1.3 points 3 et 9).* | `confidentialite/page.tsx`. |
| D9 | **Nouvelle acceptation** : `LEGAL_VERSION` passe de `2026-10-30` à `2026-11-03` ; l'ancienne reste dans `KNOWN_LEGAL_VERSIONS`. L'écran de nouvelle acceptation la redemande à la prochaine connexion. | Règle d'évolution de docs/28 § 2.2. | `packages/shared/src/legal/index.ts`. |
| D10 | **Annonces (ADR-0053)** : une annonce **envoyée** peut être **retirée** par un opérateur des annonces, avec motif interne et ré-authentification. Elle disparaît de la bannière et de la cloche ; rien n'est effacé ; geste au journal plateforme. | Choix produit prudent. *À revoir (JA4, JA5).* | `POST /admin/announcements/:id/withdraw`, statut `withdrawn`, bouton console, e2e `admin-announcements`. |

## 2. Inventaire des questions ouvertes et décisions

### 2.1 ADR-0047 — Factures des abonnements

Ce chantier est conduit **dans un lot parallèle** (factures des abonnements). ADR-0054 ne tranche que
ce qui touche les textes.

| Question | Décision du 3 nov. 2026 | Base |
|---|---|---|
| n° 11 — Texte des CGV et nouvelle acceptation | **Maintenant** : CGV réécrites (§ 3) ; elles disent qu'aucune facture d'abonnement n'est encore émise, marqueur conservé. | Choix produit prudent. *À revoir.* |
| n° 1 à 10, 12 à 14 (option, régime TVA, groupe, devise, organisation vendeuse, identité, moment de la pièce, données des abonnés, Stripe/PayPal, avoirs, paiements passés, qui corrige, transmission au conseil) | **Renvoyées au lot ADR-0047** en cours ; non tranchées ici. | — |
| F1 à F8, J1 à J4, DGI1 | **Questions au conseil maintenues.** Le marqueur TVA et le marqueur « factures d'abonnement » des CGV en dépendent. | — |

### 2.2 ADR-0048 — Formulaire public de prospects

| Décision ouverte | Décision du 3 nov. 2026 | Base |
|---|---|---|
| 1 Nombre de formulaires | Défaut gardé : un. | Choix produit prudent. *À revoir.* |
| 2 Seuils anti-abus | Défaut gardé (3 s ; 5 envois / IP / 10 min ; 60 / formulaire / h). | Choix produit prudent. *À revoir.* |
| 3 Opportunité automatique | Défaut gardé : non, activable. | Choix produit prudent. *À revoir.* |
| 4 Conservation des preuves de consentement | Défaut gardé : tant que l'organisation existe ; dit dans la politique de confidentialité. | Choix produit prudent. *À revoir avec le juriste.* |
| 5 Rotation de la clé d'empreinte d'IP | Défaut gardé : stable. | Choix produit prudent. *À revoir.* |
| 6 `<iframe>` | Défaut gardé : non. | Choix produit prudent. *À revoir.* |
| 7 Identité visuelle | Défaut gardé : affichée si un logo existe. | Choix produit prudent. *À revoir.* |
| 8 Accusé de réception par e-mail | Défaut gardé : non. | Choix produit prudent. *À revoir.* |
| 9 Offres | Défaut gardé : toutes. | Choix produit prudent. *À revoir.* |
| Mention du rôle de Lalanda dans les CGV et la confidentialité (docs/28 § 2.7) | **Rédigée** : Lalanda héberge et exécute le formulaire pour le compte de l'organisation. | Choix produit prudent. *À revoir.* |

### 2.3 ADR-0049 — Comptabilité SYSCOHADA

Chantier conduit **dans un lot parallèle** (pack comptable). ADR-0054 n'en modifie rien.

| Question | Décision du 3 nov. 2026 | Base |
|---|---|---|
| Décisions ouvertes n° 1 à 21 | **Valeurs par défaut gardées** (telles qu'écrites dans ADR-0049). | Choix produit prudent. *À revoir avec l'expert-comptable.* |
| Questions E1 à E10 à l'expert-comptable | **Maintenues.** | Le référentiel est le Système comptable OHADA annexé à l'Acte uniforme relatif au droit comptable et à l'information financière (cité par ADR-0049) ; son application précise reste à valider par l'expert. |

### 2.4 ADR-0050 — Contrats, commandes, acomptes, abonnements

| Question | Décision du 3 nov. 2026 | Base |
|---|---|---|
| JU1 Reconduction tacite | D1 : permise si le contrat la prévoit ; constatée par un humain ; alerte avant l'échéance. | Liberté contractuelle, Code civil congolais livre III ; reste : choix produit. *À revoir.* |
| JU2 Préavis | Celui de la **clause saisie** ; aucun préavis minimal imposé ni calculé ; décompte en jours civils (comme aujourd'hui). | Choix produit prudent : aucun minimum légal n'est affirmé. *À revoir.* |
| JU3 Mentions obligatoires d'un contrat et d'une commande | Lalanda ne produit pas le contrat (décision n° 18) ; aucune mention n'est contrôlée. | Choix produit prudent. *À revoir avec le juriste (AUDCG, droit de la consommation).* |
| JU4 Preuve, signature électronique | Défaut gardé : PDF signé téléversé obligatoire, pas d'intégration de signature en v1. | Choix produit prudent. *À revoir.* |
| JU5 Conservation des contrats, avenants, commandes | Aucune purge automatique : conservés tant que l'organisation existe. | Choix produit prudent ; la durée de conservation des pièces commerciales et comptables est **à confirmer** par l'expert-comptable (AUDCG). *À revoir.* |
| JU6 Données des signataires | Conservées avec le contrat ; décrites comme données saisies par l'organisation pour son compte. | Choix produit prudent. *À revoir.* |
| JU7 Modification du prix | Par **avenant** daté, comme aujourd'hui ; aucune indexation automatique. | Choix produit prudent. *À revoir.* |
| EC1 à EC6, DGI1 à DGI3 | **Questions maintenues** ; défauts gardés (aucune imputation automatique de l'acompte, aucun prorata, mois d'émission). | — |
| Avoirs dans le reste à facturer | D2 : un avoir gelé réduit le facturé. | Choix produit prudent. *À revoir avec l'expert-comptable.* |
| Décisions ouvertes n° 1 à 8, 11 à 22 | **Défauts gardés.** | Choix produit prudent. *À revoir.* |
| n° 9 Reconduction tacite | Défaut gardé, confirmé par D1. | Voir D1. |
| n° 10 Délais d'alerte | Défaut gardé : préavis 30 jours avant la date limite, fin de terme 60 jours avant. | Choix produit prudent. *À revoir.* |

### 2.5 ADR-0051 — Frais, avances, présences, évaluations

| Question | Décision du 3 nov. 2026 | Base |
|---|---|---|
| J1, J2 Avances sur salaire | D6 : éteintes, paie exclue. Question maintenue. | Choix produit prudent. *À revoir.* |
| J3 Temps de travail | Aucune règle signalée par Lalanda (seuils indicatifs saisis par l'organisation, vides par défaut). | Le Code du travail (loi n° 015/2002) et ses mesures d'application régissent la durée du travail ; **aucune de ses valeurs n'est reprise** sans vérification. Choix produit prudent. *À revoir.* |
| J4 Pointage, données personnelles, conservation | D3, D4, D5. | Voir D3 et D4. |
| J5 Frais professionnels | Remboursement au réel sur justificatif ; aucun barème. | Choix produit prudent. *À revoir avec l'expert-comptable.* |
| J6 Évaluations | Défauts gardés : éteintes ; aucune note calculée ; « pris connaissance » n'est pas un accord. | Choix produit prudent. *À revoir.* |
| C1 à C5 | **Questions maintenues** ; défauts gardés (n° 13). | — |
| n° 5 Avances sur salaire et régularisation sur la paie | D6. | Voir D6. |
| n° 8 Pointage | D5 (activation possible, information affichée). | Voir D5. |
| n° 16 Conservation | **Pointages** : D3 (5 ans, purge). **Évaluations, justificatifs** : défaut gardé, aucune purge automatique, durée réglable par l'organisation (`retention.*`) ; dit dans la politique de confidentialité. | Choix produit prudent. *À revoir.* |
| n° 1 à 4, 6, 7, 9 à 15, 17 | **Défauts gardés.** | Choix produit prudent. *À revoir.* |

### 2.6 ADR-0052 — Mise en route d'une société

| Question | Décision du 3 nov. 2026 | Base |
|---|---|---|
| Décisions ouvertes n° 1 à 9 | **Défauts gardés** (neuf étapes ; seule la fiche fiscale bloque l'émission ; modules rangés par l'organisation ; pas de reprise en v1 ; organisation personnelle créée mais atterrissage sur l'invitante ; un essai par organisation ; pas d'attestation ; pas de limite ; quota RH par organisation). | Choix produit prudent. *À revoir.* |
| EC1 à EC5, JU1 à JU4 | **Questions maintenues.** Aucune mention de facture supplémentaire n'est exigée. | — |

### 2.7 ADR-0053 — Administration de la plateforme

| Question | Décision du 3 nov. 2026 | Base |
|---|---|---|
| n° 2 Double authentification des opérateurs | **Traitée dans un lot parallèle** (double authentification de la console) ; non tranchée ici. | — |
| n° 9 Canal des annonces | Défaut gardé : in-app seulement, aucun e-mail de masse, aucune prospection. **Ajout D10** : retrait d'une annonce envoyée. | Choix produit prudent. *À revoir (JA4).* |
| n° 1, 3 à 8, 10 à 18 | **Défauts gardés** (même domaine `/admin` ; suspension en lecture seule ; aucun e-mail de blocage ; miroir « Équipe Lalanda » ; matrice du § 5.2 ; deux personnes ; grille ouverte ; journaux plateforme ; pas d'accès délégué ; seuil de 5 ; « encaissements constatés » ; octroi motivé ; aucune purge du journal ; entrée « Console Lalanda » ; support à 90 jours). | Choix produit prudent. *À revoir.* |
| JA1 Accès du personnel de Lalanda | Décrit dans la politique de confidentialité et les CGV (métadonnées seulement, gestes motivés et journalisés). | Choix produit prudent. *À revoir.* |
| JA2, JA3 Blocage, suspension | Décrits dans les CGV ; défauts gardés. | Choix produit prudent. *À revoir.* |
| JA4 Messages de masse | Messages de service in-app seulement, retirables. | Choix produit prudent. *À revoir.* |
| JA5 Conservation du journal plateforme, des motifs, des accusés | Sans limite à ce jour (ajout seul), dit dans la politique de confidentialité. | Choix produit prudent. *À revoir.* |
| JA6 Seuil des statistiques | 5 organisations, dit dans la politique de confidentialité. | Choix produit prudent. *À revoir.* |
| JA7 Demandes des autorités | Aucune procédure spécifique ; catégorie de motif « demande légale » existante. | Choix produit prudent. *À revoir avec le juriste.* |

## 3. Conditions générales de vente : choix retenus

Tous sont des **choix produit prudents, alignés sur ce que fait le code**, *à revoir* :

| Point (marqueur de docs/28 § 3.2) | Choix | État dans le code |
|---|---|---|
| Applicabilité au paiement manuel, date | Dès la version `2026-11-03`, tout moyen de paiement | — |
| Moyens de paiement et prestataire | Manuel (mobile money, virement) ; Stripe et PayPal seulement s'ils sont proposés à l'écran | `payments/` |
| Devise | Prix en USD ; montant et devise du paiement : ceux du récapitulatif et des instructions | `pricing` |
| HT ou TTC | Hors taxes ; **TVA : marqueur gardé** (expert-comptable, ADR-0047) | `taxIncluded: false` |
| Carte à l'entrée en essai | Aucun moyen de paiement demandé | essai local |
| Bascule en fin d'essai | Aucune : retour à l'offre gratuite, rien prélevé | `trial.expired` |
| Période de grâce | 7 jours après impayé, accès intact | `GRACE_DAYS = 7` |
| Information préalable à la reconduction | Période couverte affichée dans l'espace de l'organisation ; pas d'e-mail de rappel | — |
| Remboursement | Aucune période commencée remboursée ; double paiement, erreur ou paiement rejeté remboursés sur demande ; crédit de prorata reporté | `proration.ts` |
| Relance, suspension, conservation après suspension | Impayé → grâce 7 jours → limites de l'offre gratuite ; données conservées et exportables | `subscription-state.ts` |
| Frais de recouvrement | Aucun | — |
| Préavis avant hausse de prix | 30 jours | — |
| Mentions du parcours d'achat | Récapitulatif, obligation de payer à la validation, conclusion à la confirmation du paiement | devis de souscription |

Marqueurs **gardés** (donnée ou avis manquant) : TVA ; émission des factures d'abonnement (ADR-0047) ;
droit de rétractation (avis du juriste ; aucune règle affirmée).

## 4. Ce que la dirigeante doit relire

1. Le texte des CGV (`/cgv`) et de la politique de confidentialité (`/confidentialite`), en
   particulier : remboursement, préavis de 30 jours, suspension « en principe » en lecture seule,
   description du rôle de Lalanda pour les données saisies par l'organisation.
2. Le texte d'information des salariés à l'écran de pointage (`attendanceEmployeeNotice`).
3. La durée de 5 ans des pointages.

## 5. Conséquences

- Nouvelle acceptation des CGU, CGV et de la politique de confidentialité par tous les utilisateurs.
- docs/28 : chaque point ouvert porte son état au 3 nov. 2026.
- `LEGAL_REVIEWED_BY_COUNSEL` reste `false` : rien de ce qui précède n'est une relecture juridique.

## Liens

- [ADR-0047](ADR-0047-factures-des-abonnements-lalanda.md) · [ADR-0048](ADR-0048-formulaire-public-de-prospects.md) ·
  [ADR-0049](ADR-0049-comptabilite-syscohada.md) · [ADR-0050](ADR-0050-contrats-commandes-acomptes-abonnements.md) ·
  [ADR-0051](ADR-0051-rh-frais-avances-presences-evaluations.md) · [ADR-0052](ADR-0052-mise-en-route-societe.md) ·
  [ADR-0053](ADR-0053-administration-plateforme.md) · [ADR-0043](ADR-0043-editeur-go-freelance-sarlu.md)
- [docs/28 — Conformité légale](../28-CONFORMITE-LEGALE.md)
- Code : `packages/engine/src/contracts/invoicing.ts`, `apps/api/src/sales/contracts/links/`,
  `apps/api/src/hr/attendance/hr-attendance-retention.job.ts`, `packages/shared/src/hr/attendance.ts`,
  `apps/api/src/admin/announcements/`, `packages/shared/src/legal/index.ts`,
  `apps/web/src/app/(marketing)/{cgv,confidentialite}/page.tsx`.
