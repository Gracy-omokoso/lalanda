# ADR-0047 — Factures des abonnements Lalanda : qui émet, avec quel outil, et quand

Statut : Proposed — **en attente de la dirigeante**
Date : 2026-11-01
Décideurs : Gracy Omokoso (dirigeante) ; expert-comptable et juriste de Go freelance SARLU pour
les points fiscaux et juridiques (§ 6).

> **Rien n'est codé tant que la dirigeante n'a pas répondu.** Cet ADR ne pose **aucune valeur par
> défaut** : chaque décision ouverte (§ 9) reste ouverte, et aucun lot (§ 8) ne démarre avant sa
> réponse. Il ne pose aucune règle fiscale ou juridique congolaise : ce qui n'est pas sourcé dans le
> dépôt est écrit comme une question.

## 1. Contexte

### 1.1 Ce que promettent les CGV

La page CGV (`apps/web/src/app/(marketing)/cgv/page.tsx`, section « Facturation », corpus
`2026-10-30`) affirme : « Une facture est émise à chaque échéance et reste consultable depuis
l'espace de l'organisation. Elle reprend l'offre, la période couverte, le montant et les taxes
applicables. » Elle demande aussi au client des « informations de facturation (raison sociale,
adresse, identifiant fiscal) ».

### 1.2 Ce que fait le produit aujourd'hui (relevé le 1ᵉʳ nov. 2026)

| Sujet | Constat | Où |
|---|---|---|
| Vendeur | Go freelance SARLU, SARLU de droit congolais ; Televerx LLC partenaire de développement, ne contracte pas | ADR-0043, docs/28 § 1 |
| Identifiants du vendeur | RCCM, Id. Nat., NIF, siège, capital, gérant, téléphone **non fournis** et non publiés | docs/28 § 1.1, `PUBLISHER_UNPUBLISHED_MENTIONS` |
| Encaissement | `manual` (mobile money, virement) seul circuit opérationnel ; un rôle **plateforme** (`platform_billing`, `platform_admin`, `platform_super_admin`) confirme le dépôt ; Stripe et PayPal codés, en attente d'identifiants marchands | `apps/api/src/payments/`, docs/13 § Paiements |
| Montants | USD (`BILLING_CURRENCY`), centimes entiers, **hors taxes** déclaré (`taxIncluded: false`) ; fiscalité de la vente numérique non arbitrée | `packages/shared/src/pricing`, `billing/proration.ts`, docs/13 § 5 |
| Prorata | montée en gamme : crédit du non-consommé, aucun remboursement, excédent reporté (`carriedCreditCents`) | `billing/proration.ts` |
| Pièce émise au client | **aucune**. Une demande manuelle confirmée (`manual_payment_requests`) déclenche `payment.succeeded` et prolonge l'abonnement ; aucun document n'est produit | `payments.service.ts` (`confirmManualPayment`) |
| Données de facturation du client | **aucune n'est recueillie** : ni raison sociale, ni adresse, ni NIF. La demande manuelle ne stocke volontairement aucune coordonnée du payeur | `manual-payment.schema.ts` |
| Lien avec les ventes | `billing/` et `payments/` n'ont aucun lien avec `sales/` ni avec e-DEF | docs/28 § 6 |
| Stripe | émettrait ses propres factures (`invoice.paid`), au nom du titulaire du compte marchand, non documenté | `payments/stripe.provider.ts` |

**L'écart** : la promesse des CGV n'est pas tenue. Aucun abonné ne reçoit de facture, ni même de
reçu.

### 1.3 Ce que Lalanda sait déjà faire pour ses clients

Le module ventes émet des factures et des avoirs (ADR-0023), numérotés en série annuelle
ininterrompue `IN{AA}{MM}-NNNNNN` (ADR-0027), mis en page sur six modèles avec zone DGI imposée
(ADR-0025, ADR-0028), et les **normalise** auprès de la DGI (ADR-0024) quand l'organisation a
activé la facture normalisée avec sa fiche fiscale et le jeton de son e-MCF (ADR-0021). Les
encaissements sont lettrés aux factures (ADR-0031).

Trois contraintes de ce circuit pèsent sur la décision :

- **Une facture normalisée porte l'identité fiscale du vendeur.** La fiche fiscale exige
  dénomination, **NIF**, adresse du siège, téléphone et e-mail (ADR-0021 § 2) ; le NIF part à la
  DGI et s'imprime. Une facture normalisée de Go freelance SARLU porterait donc son NIF, **même si
  ce NIF reste absent du site**.
- **La production DGI est fermée** (`DGI_PRODUCTION_ENABLED=false`, ADR-0024 § 11) tant que
  Lalanda n'est pas homologué et étalonné. Aujourd'hui, une facture normalisée n'a de valeur
  fiscale nulle part : seul l'environnement de test répond.
- **Une organisation en mode normalisé n'émet plus de facture ordinaire** (ADR-0019, ADR-0021
  R4) : un document non normalisé y reste un pro forma.

### 1.4 Un fait à prendre en compte : l'organisation « Go Freelance » existe déjà

La base de production contient une organisation **Go Freelance**, dotée d'un profil fiscal, d'un
point de vente e-MCF **de test** et de son jeton, qui a servi à l'étalonnage et à la campagne
d'homologation (58 normalisations sur l'environnement de test DGI, ADR-0024 § 7, ADR-0026 § 7).
Ce dépôt ne dit pas si son profil porte l'identité réelle de la société. Deux règles existantes
s'appliquent à toute réutilisation :

- **un même NIF ne peut activer la facture normalisée que dans une seule organisation par
  environnement** (ADR-0021 R1, `nif_elsewhere`) ;
- les séries d'essai (`TEST-…`) et réelle sont distinctes (ADR-0027) : les 58 normalisations de
  test ne consomment pas la série réelle.

## 2. Options considérées

### Option A — Lalanda se facture elle-même avec son propre module ventes

Une organisation interne « Go freelance SARLU » (l'existante ou une nouvelle, décision n° 5) est
désignée comme **organisation vendeuse de la plateforme**. Chaque offre devient un article de son
catalogue. Chaque abonné devient un client de cette organisation. Chaque paiement confirmé
(`payment.succeeded`, quel que soit le fournisseur) crée une facture : **émise** tant que la
facture normalisée n'est pas activée pour elle, **normalisée** une fois la production DGI ouverte et
le jeton e-MCF de production saisi. L'abonné consulte et télécharge ses factures depuis son espace.

- **Avantages.** Réutilise un circuit déjà construit, testé et présenté à l'homologation : calcul
  au centime (moteur `invoice-totals`), série sans trou, avoirs, PDF, zone DGI, conversion CDF,
  états incertains et rattrapage. Une seule logique fiscale à maintenir. Le passage au normalisé
  est un réglage de l'organisation, pas un nouveau développement. Go freelance SARLU fait la
  démonstration de son propre produit.
- **Risques.**
  - **Pont entre locataires.** Les données de l'abonné (raison sociale, NIF, adresse) entrent dans
    une autre organisation. La règle « toute donnée cliente est isolée par organisation » (CLAUDE.md)
    impose un pont explicite, à sens unique, journalisé, et limité aux champs de facturation.
  - **Données manquantes.** Rien n'est recueilli aujourd'hui (§ 1.2) : il faut un formulaire de
    facturation dans le tunnel de souscription.
  - **Couplage.** Un incident DGI ou une facture « incertaine » ne doit jamais bloquer
    l'abonnement : la facture suit le paiement, elle ne le conditionne pas.
  - **Factures ordinaires avant l'ouverture de la production.** Émettre des factures non
    normalisées en attendant n'est acceptable que si Go freelance SARLU n'y est pas tenue, ce qui
    dépend de son régime (§ 6, question F1).
  - **Doublon avec Stripe.** Si Stripe émet aussi ses factures, l'abonné reçoit deux pièces pour
    un même paiement.

### Option B — Un module de facturation dédié aux abonnements

Un composant propre à `billing/` produit ses factures (gabarit, série, PDF, envoi), et plus tard
son propre client e-DEF.

- **Avantages.** Aucun pont entre locataires ; le modèle colle exactement aux abonnements
  (période couverte, prorata, crédit reporté).
- **Risques.** Duplique ce qui existe déjà (numérotation sans trou, calcul conforme, PDF,
  normalisation, rattrapage) : deux circuits fiscaux à tenir justes au centime. Un second émetteur
  dans le logiciel élargit ce que l'homologation doit couvrir (ADR-0019 : « le logiciel ne peut
  émettre que les types de facture et groupes validés lors de l'homologation » ; pièce exigée :
  aucune facture non normalisée ne sort du logiciel). Coût le plus élevé pour le résultat le moins
  vérifié.

### Option C — Un reçu non fiscal en attendant, et des CGV mises en cohérence

À chaque paiement confirmé, Lalanda produit un **reçu de paiement** (référence, offre, période,
montant, devise, moyen de paiement, date), consultable dans l'espace de l'organisation, titré sans
ambiguïté « Reçu — ce document n'est pas une facture ». Les CGV cessent de promettre une facture
automatique et disent ce qui est réellement remis, et comment obtenir une facture.

- **Avantages.** Ne demande **aucun** identifiant de la société ; réalisable sans attendre la DGI ;
  rend la promesse publique exacte ; donne à l'abonné une preuve de paiement.
- **Risques.** Ne règle pas l'obligation de facturer, si elle existe (§ 6) : c'est une mesure
  d'attente, pas une solution. Un reçu mal titré pourrait être pris pour une facture. Modifier les
  CGV change le corpus : nouvelle `LEGAL_VERSION` et nouvelle acceptation par tous les utilisateurs
  (docs/28 § 2.3 bis et § 4, point 6).

### Option D — Factures faites à la main dans le module ventes, sans automatisme

La dirigeante (ou un membre de l'organisation Go freelance) saisit elle-même, dans le module ventes,
une facture pour chaque paiement confirmé.

- **Avantages.** Aucun code ; disponible dès que l'organisation vendeuse a une fiche fiscale
  complète. Permet de commencer à facturer tout de suite si la dirigeante le veut.
- **Risques.** Travail manuel à chaque encaissement ; oublis et retards ; aucune vue de la facture
  dans l'espace de l'abonné (envoi par e-mail depuis l'aperçu seulement, ADR-0042). Mêmes réserves
  que A sur les factures ordinaires avant l'ouverture de la production DGI.

### Option E — Facturer hors de Lalanda

Factures émises par un autre outil : celles de Stripe pour les paiements par carte, ou un autre
logiciel de facturation (éventuellement homologué) tenu par Go freelance SARLU ou son comptable.

- **Avantages.** Aucun développement côté Lalanda.
- **Risques.** Une facture Stripe n'est pas une facture normalisée DGI ; le circuit manuel
  (mobile money, virement) resterait sans pièce. Deux outils pour une même activité. Paradoxal pour
  un éditeur qui vend la facture normalisée à ses clients. Non retenu par le dépôt comme piste
  principale, mais cité parce qu'il est possible.

## 3. Recommandation (proposée, non appliquée)

**C tout de suite, A pour la cible, D si la dirigeante veut facturer avant que A soit prêt. B et E
écartés.**

1. **C d'abord**, parce qu'il corrige l'inexactitude publique sans attendre aucun identifiant ni la
   DGI, et parce qu'une CGV qui promet ce que le produit ne fait pas est un risque en soi.
2. **A ensuite**, parce que Lalanda possède déjà le circuit complet, et que le seul chemin vers une
   facture **normalisée** des abonnements passe de toute façon par un SFE homologué : autant que ce
   soit Lalanda, avec l'organisation de Go freelance SARLU comme premier client réel. Le pont entre
   locataires est le prix à payer ; il est petit, borné et testable.
3. **D comme passerelle**, au choix de la dirigeante, une fois la fiche fiscale de l'organisation
   vendeuse complète et la question F1 tranchée.
4. **B est écarté** : il refait, moins bien, ce qui existe, et complique l'homologation.
   **E est écarté** comme cible : il laisse le mobile money sans pièce et ne produit pas de facture
   normalisée.

Cette recommandation ne vaut décision qu'après la réponse aux décisions ouvertes n° 1 à 4.

## 4. Ce qu'il faut à la dirigeante, option par option

| Élément | A | B | C | D | E |
|---|---|---|---|---|---|
| Choix de l'organisation Lalanda vendeuse (existante ou nouvelle) | oui | — | — | oui | — |
| Dénomination exacte de la société | oui | oui | oui (sur le reçu) | oui | selon l'outil |
| **NIF** (imprimé sur chaque facture et envoyé à la DGI) | oui | oui | non | oui | selon l'outil |
| Adresse du siège, téléphone, e-mail de facturation (champs requis de la fiche fiscale) | oui | oui | non | oui | selon l'outil |
| RCCM, Id. Nat. (facultatifs dans la fiche ; présence sur facture à confirmer par le juriste) | à décider | à décider | non | à décider | — |
| **Assujettissement à la TVA** de Go freelance SARLU | oui | oui | non | oui | oui |
| **Groupe de taxation** et taux applicables aux abonnements | oui | oui | non | oui | oui |
| Prix HT ou TTC | oui | oui | oui (le reçu affiche un montant) | oui | oui |
| Devise de facturation et règle de conversion (USD payé, CDF à la normalisation, mobile money encaissé en CDF) | oui | oui | oui (devise du reçu) | oui | oui |
| **Jeton e-MCF de production** du point de vente de Go freelance SARLU | oui, après homologation | oui, après homologation | non | oui, après homologation | — |
| Titulaire des comptes marchands Stripe / PayPal | oui | oui | oui | — | oui |
| Données à demander aux abonnés (raison sociale, NIF, adresse ; obligatoires ou non) | oui | oui | non | oui | oui |
| Nouvelle acceptation des CGV par les utilisateurs | si les CGV changent | si les CGV changent | **oui** | si les CGV changent | si les CGV changent |

Rappel : fournir le NIF **pour les factures** ne revient pas à le publier sur le site. Les mentions
légales restent régies par ADR-0043 ; seule la facture le porte, et elle n'est remise qu'à
l'abonné concerné.

## 5. Ce que chaque option change dans le code (pour estimation, rien n'est engagé)

- **A** : configuration de l'organisation vendeuse ; profil de facturation de l'abonné ; pont
  `payment.succeeded` → facture, idempotent par identifiant d'événement de paiement ; vue des
  factures dans l'espace de l'abonné ; avoirs sur remboursement ; aucune modification du circuit
  de normalisation.
- **B** : nouveau générateur, nouvelle série, nouveau PDF, nouveau client e-DEF, nouveaux tests de
  conformité.
- **C** : collection ou champ de reçu, PDF de reçu, page dans l'espace de l'organisation, texte des
  CGV, `LEGAL_VERSION`.
- **D** : rien.
- **E** : désactivation éventuelle des reçus ou factures du fournisseur, documentation.

## 6. Risques juridiques et fiscaux — questions ouvertes, rien n'est tranché

Aucune des réponses ci-dessous ne se trouve dans une source du dépôt. Chacune est à obtenir de
l'expert-comptable (F), du juriste (J) ou de la DGI (DGI).

| N° | Question | À qui | Source qui la soulève |
|---|---|---|---|
| F1 | Go freelance SARLU est-elle assujettie à la TVA ? Si oui, depuis le 1ᵉʳ avril 2026, ses factures doivent-elles toutes être normalisées, y compris celles des abonnements ? Si non, que doit-elle remettre ? | F | docs/sources/dgi-rdc (fin du moratoire, sources secondaires) |
| F2 | Quel groupe de taxation et quel taux pour un abonnement à un logiciel en ligne vendu par une société congolaise ? | F, DGI | ADR-0019 (16 groupes A à P) |
| F3 | Abonné établi hors de RDC (diaspora, étranger) : même facture, même groupe, autre traitement ? | F, J | docs/28 § 6, § 3.1 |
| F4 | Quel est le fait générateur : l'échéance, l'encaissement, ou le début de la période ? (les CGV disent « à chaque échéance », le produit ne connaît que l'encaissement) | F | CGV § Facturation |
| F5 | Un mobile money payé en CDF contre un prix en USD : quel taux s'applique, et lequel figure sur la facture ? | F | docs/13 § 5, ADR-0023 § S25e.4 |
| F6 | Crédit de prorata reporté sans remboursement (`carriedCreditCents`) : remise sur la facture suivante, avoir, ou autre écriture ? | F | `billing/proration.ts` |
| F7 | Que faire des paiements déjà encaissés sans facture, s'il y en a ? | F | § 1.2 |
| F8 | Durée de conservation des factures et pièces d'une SARLU congolaise | F, J | docs/28 § 1.3 point 6 |
| J1 | Mentions obligatoires d'une facture de société (RCCM, Id. Nat., siège, capital) au-delà de ce qu'exige la DGI | J | ADR-0021 § 2 (« relève du droit OHADA, à confirmer ») |
| J2 | Un reçu non fiscal suffit-il, même temporairement, au regard des CGV et du droit de la consommation applicable ? | J | CGV, docs/28 § 3.1 |
| J3 | Le pont de l'option A (données de facturation de l'abonné copiées dans l'organisation vendeuse) : base légale et information de l'abonné dans la politique de confidentialité | J | CLAUDE.md (isolation), docs/28 § 1.3 point 3 |
| J4 | Si Stripe ou PayPal émettent leurs propres factures ou reçus, quel document fait foi ? | J, F | docs/28 § 6 |
| DGI1 | Un éditeur de SFE peut-il normaliser ses propres ventes avec son propre logiciel, sous le même ISF ? | DGI | ADR-0019, ADR-0021 (ISF plateforme) |

## 7. Conséquences

- docs/28 § 6 renvoie vers cet ADR ; il reste ouvert.
- Les CGV ne changent pas tant que la décision n° 1 n'est pas prise.
- Aucune ligne de code n'est écrite. Aucun lot ci-dessous n'est engagé.

## 8. Découpage en lots, pour plus tard

L'ordre suppose la recommandation retenue ; il sera revu selon la décision n° 1.

| Lot | Contenu | Dépend de |
|---|---|---|
| **N0** | Textes : CGV § Facturation réécrites selon l'option retenue ; `LEGAL_VERSION` avancée et ancienne valeur ajoutée à `KNOWN_LEGAL_VERSIONS` ; docs/13 et docs/28 mis à jour | décisions 1, 11 |
| **N1** | Reçu de paiement (option C) : produit à chaque `payment.succeeded`, idempotent, PDF, liste dans l'espace de l'organisation, e-mail facultatif | décisions 1, 7, 11 |
| **N2** | Profil de facturation de l'abonné : formulaire dans le tunnel de souscription (champs selon la décision 8), validation, audit, mention dans la politique de confidentialité | décisions 8, J3 |
| **N3** | Organisation vendeuse : désignation par configuration plateforme, fiche fiscale complète, articles « offres » au catalogue avec leur groupe de taxation | décisions 2 à 6 |
| **N4** | Pont paiement → facture (option A) : à chaque `payment.succeeded`, client créé ou mis à jour dans l'organisation vendeuse, facture émise ou normalisée, journal ; un échec de facturation est rattrapé par l'ordonnanceur (ADR-0020) et ne touche jamais l'abonnement ; tests d'idempotence et de rejeu | N2, N3, décision 9 |
| **N5** | Espace de l'abonné : liste de ses factures, PDF, envoi par e-mail (ADR-0042) | N4 |
| **N6** | Avoirs : remboursement, correction de données de facturation, traitement du crédit de prorata | N4, décision 10, F6 |
| **N7** | Passage au normalisé de l'organisation vendeuse : jeton e-MCF de production, activation | homologation et ouverture de la production (ADR-0024 § 11) |

## 9. Décisions ouvertes — elles appartiennent à la dirigeante

Aucune valeur par défaut n'est appliquée. Rien n'est codé avant sa réponse.

1. **Option retenue** : A, B, C, D, E, ou une combinaison (la recommandation est C, puis A, avec D
   comme passerelle). Et dans quel ordre ?
2. **Régime TVA de Go freelance SARLU** : assujettie ou non (réponse de l'expert-comptable, F1).
3. **Groupe de taxation et taux** des abonnements (F2), et **prix affichés HT ou TTC** : si une
   taxe s'applique, 19 USD devient-il 19 USD plus taxe, ou 19 USD taxe comprise ?
4. **Devise** : facture en USD convertie en CDF à la normalisation (règle d'ADR-0023), ou autre ;
   règle de taux pour un paiement mobile money encaissé en CDF (F5).
5. **Organisation vendeuse** : réutiliser l'organisation « Go Freelance » déjà en production
   (profil fiscal et point de vente de test de l'homologation), ou en créer une dédiée ? (Avec le
   même NIF, une seule des deux peut activer la facture normalisée par environnement.)
6. **Identité sur la facture** : accord pour que le NIF, l'adresse du siège, le téléphone et
   l'e-mail de facturation figurent sur les factures remises aux abonnés (sans être publiés sur le
   site) ; RCCM et Id. Nat. aussi, oui ou non (J1).
7. **Moment de la pièce** : à l'encaissement confirmé, ou à l'échéance même impayée (F4) ?
8. **Données demandées aux abonnés** : raison sociale, NIF, adresse ; obligatoires ou
   facultatives ; type de client (particulier, personne morale) ; abonnés hors RDC (F3).
9. **Stripe et PayPal** : titulaire des comptes marchands ; faut-il désactiver leurs propres
   factures ou reçus pour éviter deux pièces pour un même paiement (J4) ?
10. **Avoirs et remboursements** : la politique de remboursement n'est pas arbitrée (docs/28
    § 3.2) ; traitement du crédit de prorata (F6).
11. **Texte des CGV** et nouvelle acceptation par tous les utilisateurs que leur modification
    entraîne : d'accord pour le faire maintenant, ou attendre la solution définitive ?
12. **Paiements passés** sans facture (F7) : y en a-t-il, et faut-il les régulariser ?
13. **Qui consulte et corrige** les factures d'abonnement côté plateforme : les rôles plateforme
    qui confirment les paiements, les membres de l'organisation vendeuse, ou les deux ?
14. **Questions au conseil** : les transmettez-vous vous-même à l'expert-comptable, au juriste et
    à la DGI (§ 6), ou voulez-vous un projet de courrier ?

### Éléments à fournir par la dirigeante (selon l'option retenue)

- dénomination exacte de Go freelance SARLU ;
- NIF ;
- adresse du siège, téléphone, e-mail de facturation ;
- RCCM et Id. Nat., si la décision 6 les retient ;
- attestation ou réponse de l'expert-comptable sur le régime TVA et le groupe de taxation ;
- après homologation : jeton e-MCF de production du point de vente, saisi par elle dans le coffre
  (jamais transmis par écrit, jamais commité).

## 10. Plan de validation

Une fois les décisions prises : critères d'acceptation et tests écrits par lot (idempotence du
pont, aucune facture sans paiement, aucun paiement bloqué par la facturation, série sans trou,
reçu jamais titré « facture », isolation des données de l'abonné), puis essai réel sur
l'environnement de test DGI avant toute ouverture de la production.

## Liens

- [docs/28 § 6](../28-CONFORMITE-LEGALE.md) — écart signalé ; [docs/13 § 5](../13-PRICING.md) — devise et fiscalité
- [ADR-0019](ADR-0019-facture-normalisee-dgi-rdc.md), [ADR-0021](ADR-0021-modules-erp-et-identite-fiscale.md),
  [ADR-0023](ADR-0023-factures-et-avoirs.md), [ADR-0024](ADR-0024-normalisation-dgi.md),
  [ADR-0025](ADR-0025-documents-pdf-factures.md), [ADR-0026](ADR-0026-campagne-homologation.md),
  [ADR-0027](ADR-0027-numerotation-des-factures.md), [ADR-0028](ADR-0028-modeles-de-facture-et-identite.md) — facturation et normalisation
- [ADR-0031](ADR-0031-encaissements-et-realise.md) — encaissements ; [ADR-0042](ADR-0042-envoi-des-documents-par-email.md) — envoi par e-mail
- [ADR-0043](ADR-0043-editeur-go-freelance-sarlu.md) — éditeur et mentions non publiées
- Code : `apps/api/src/billing/`, `apps/api/src/payments/`, `packages/shared/src/pricing/`,
  `apps/web/src/app/(marketing)/cgv/page.tsx`
