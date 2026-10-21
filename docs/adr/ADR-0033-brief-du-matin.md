# ADR-0033 — Brief du matin : faits du moteur, règles sourcées, explication par l'IA

Statut : Proposed
Date : 2026-10-21
Décideurs : Gracy Omokoso (dirigeante) ; CTO Lalanda (contrat technique). Les seuils des
règles sont des **paramètres produit à valider** par la dirigeante (§ Décisions ouvertes).

> **Applique** le brief stratégique § 7 (cinq niveaux d'IA) et § 8 (« AI CEO Morning
> Brief »), dans les limites déjà décidées : **l'IA explique, elle ne calcule pas** (CLAUDE.md,
> docs/11) ; **le niveau 5 « Act » est refusé** pour l'instant (aucun paiement, aucune
> écriture, aucun envoi externe déclenché par l'IA). Réutilise le fournisseur, la clé, les
> bornes et le quota de l'IA existante ([ADR-0008](ADR-0008-ia-openai.md), docs/11 § S22h,
> `ai-quota.service.ts`), l'ordonnanceur ([ADR-0020](ADR-0020-ordonnanceur-mongodb.md)) et
> l'envoi d'e-mails ([ADR-0014](ADR-0014-envoi-emails-et-connexion-google.md)). Prévoit les
> points d'extension des chantiers parallèles : encaissements
> ([ADR-0031](ADR-0031-encaissements-et-realise.md), branche `feat/encaissements-realise`),
> trésorerie et dépenses (ADR-0034), CRM et devis (ADR-0035), santé GROW (ADR-0032).

## Contexte

Le brief § 8 demande un tableau de bord quotidien : chiffre d'affaires du mois, trésorerie
disponible, créances à encaisser, pipeline, tâches en retard, projets à risque, trois alertes,
trois recommandations, et la question phare **« Que dois-je faire cette semaine pour améliorer
mon entreprise ? »**. Le § 7 exige de **séparer** le calcul métier déterministe, les modèles
prédictifs et l'explication par LLM, avec traçabilité, sources, quotas, coûts et protection
contre les accès inter-entreprises.

Ce que le dépôt possède déjà (v0.9.4) et que cet ADR réutilise sans le réécrire :

| Brique | Où | Ce qu'on en prend |
|---|---|---|
| Factures RUN figées, totaux par groupe calculés par le moteur | `sales_invoices`, ADR-0023 | chiffre d'affaires, part à crédit, état de normalisation |
| Règle du chiffre d'affaires : bases HT des groupes hors H, I, J, L, N, finales moins avoirs, mois civil d'`issuedAt` | ADR-0023 § S25e.13 | reprise telle quelle |
| Client OpenAI borné (jetons, délai), repli déterministe journalisé | `ai/openai-client.ts`, docs/11 § S22h | même client, même repli |
| Vérification des nombres cités | `ai/lala-nombres.ts` | même vérificateur |
| Quota IA mensuel commun par offre, garder avant / compter après | `ai/ai-quota.service.ts` (`runGuarded`) | action `ai.morning_brief` |
| Ordonnanceur en base, au moins une fois | `scheduler/` | tâche récurrente d'envoi |
| Envoi par intentions métier (ZeptoMail ou SMTP) | `mail/` | nouvelle intention `sendMorningBrief` |
| Filtrage bloc par bloc selon la matrice | `organization-space` (`can()`) | bloc ventes masqué sans `sales.read` |

Ce qui **n'existe pas encore** sur `main` : les encaissements (ADR-0031, rédigé, non livré),
les échéances de facture (idem), la trésorerie réelle (ADR-0034), le pipeline commercial
(ADR-0035), les tâches et projets à risque (non planifiés). Le brief ne les invente pas : il
les affiche **« à renseigner »** ou **« non disponible »** et prévoit leur branchement.

## Options considérées

### O1 — Qui produit les alertes et recommandations

1. **Le LLM** lit les données et choisit. Écarté : non reproductible, non testable, et c'est
   précisément « l'IA produit un résultat officiel » que CLAUDE.md interdit.
2. **Des règles déterministes dans le moteur**, chacune citant sa donnée et son seuil ; le
   LLM ne fait que rédiger à partir de leur sortie. **Retenu.**

### O2 — Où vivent les calculs

1. Dans l'API. Écarté (CLAUDE.md : le moteur est l'unique source des calculs).
2. **Module pur `packages/engine/src/morning-brief/`**, sans horloge (l'instant est un
   paramètre), arithmétique décimale exacte d'`invoice-totals` (non modifiée). **Retenu.**

### O3 — Question libre ou questions fermées

1. Question libre à l'IA. Écartée pour ce lot : surface d'injection plus large, et la
   question libre relève de l'assistant Lala (docs/11 § S24a).
2. **Deux intentions fermées** : `explain` (un paragraphe d'explication) et `this_week`
   (« Que dois-je faire cette semaine ? », trois actions au plus). **Retenu.** Les autres
   questions du brief § 8 (client le plus rentable, recrutement, levée de fonds…) sont des
   décisions ouvertes : chacune exige d'abord des faits que le moteur ne calcule pas encore.

### O4 — Contenu de l'e-mail quotidien

1. Inclure le paragraphe de l'IA. Écarté : un appel facturé par destinataire et par jour,
   et un texte généré qui part hors de l'application sans relecture.
2. **Faits, alertes et recommandations déterministes seulement**, avec un lien vers le brief
   où l'explication se demande. **Retenu.** Aucun coût d'IA par e-mail.

## Décision

### 1. Les cinq niveaux, appliqués au brief

| Niveau (brief § 7) | Dans ce lot | Qui |
|---|---|---|
| 1 Generate | paragraphe d'explication, liste d'actions de la semaine | LLM, vérifié |
| 2 Understand | les faits de l'organisation courante, rien d'autre | moteur |
| 3 Analyze | règles déterministes → alertes et recommandations sourcées | moteur |
| 4 Predict | **aucune prévision dans ce lot** ; point d'extension (`predictions: []`) réservé aux projections du moteur de scénario, jamais au LLM | moteur, plus tard |
| 5 Act | **refusé** : aucun bouton n'exécute ; chaque recommandation renvoie vers l'écran où l'utilisateur agit lui-même | — |

### 2. Les faits (moteur, `buildMorningBrief`)

Chaque fait porte `id` stable, libellé, nature (`amount`, `count`, `status`), valeur
(chaîne décimale ou entier, jamais un flottant), devise, **statut** (`known`, `to_fill`
« à renseigner », `unavailable` « non disponible », `hidden` « masqué pour votre rôle ») et
**source** (module, collection, règle, référence documentaire). Montants **par devise**
(CDF, USD) : aucun taux n'est appliqué (ADR-0031 décision ouverte n° 3).

| Fait | Règle | Source |
|---|---|---|
| `ca_mois.CDF`, `ca_mois.USD` | Σ bases HT des groupes hors H, I, J, L, N des factures **finales** (`issued`, `normalized`) `FV`/`EV` de la **série réelle** émises dans le mois civil de Kinshasa, moins celles des avoirs finaux `FA`/`EA` | ADR-0023 § S25e.13 |
| `factures_mois.nombre`, `avoirs_mois.nombre`, `acomptes_mois.nombre` | dénombrements des mêmes documents ; acomptes `FT`/`ET` comptés à part, exclus du CA | ADR-0031 décision n° 1 |
| `tresorerie` | **à renseigner** : aucune trésorerie réelle n'existe | ADR-0034 (à venir) |
| `creances.CDF`, `creances.USD` | Σ par facture finale réelle de max(0, `amountOnCredit` − parts à crédit des avoirs finaux qui la visent) — **part à crédit déclarée à l'émission** ; les encaissements reçus ensuite ne sont pas encore suivis, ce que l'écran dit | ADR-0023 § S25e.8, ADR-0031 § 2 |
| `creances_anciennes.*` | mêmes créances, factures émises depuis plus de **30 jours** | seuil S4 |
| `normalisation.echec` | factures `normalization_failed` | ADR-0024 |
| `normalisation.a_verifier` | factures `pending_normalization` en phase `uncertain` ou `needs_review` | ADR-0024 § 4.1 |
| `normalisation.attente_longue` | factures `pending_normalization` gelées depuis plus de **24 h** | seuil S2 |
| `proformas_anciennes.nombre` | brouillons non modifiés depuis plus de **14 jours** | seuil S5 |
| `echeances` | **non disponible** tant qu'ADR-0031 n'a pas livré les dates d'échéance | ADR-0031 § 2 |
| `pipeline`, `taches_en_retard`, `projets_a_risque` | **non disponible** (brief § 8) | ADR-0035, à planifier |

Factures de la série d'essai DGI : exclues partout (sans valeur fiscale).

### 3. Les règles (moteur, `evaluateMorningBriefRules`)

Chaque règle déclenchée produit une **alerte** (si sa gravité est `critique` ou `attention`)
et une **recommandation**. Chacune cite les identifiants de ses faits et **son seuil**
(valeur, unité, nature « paramètre produit à valider »). Tri : gravité, puis ordre de la table.
Le brief affiche les **trois premières** alertes et les **trois premières** recommandations ;
le nombre total déclenché est rendu.

| Règle | Déclenchement | Seuil | Gravité | Recommandation |
|---|---|---|---|---|
| R1 `normalisation_echec` | `normalisation.echec` > S1 | S1 = 0 facture | critique | reprendre en brouillon, corriger, renormaliser |
| R2 `normalisation_a_verifier` | `normalisation.a_verifier` > S1 | S1 = 0 facture | critique | lancer « Vérifier » sur chaque facture |
| R3 `normalisation_attente_longue` | `normalisation.attente_longue` > 0 | S2 = 24 h | attention | relancer la normalisation |
| R4 `creances_anciennes` | une créance de plus de S4 | S4 = 30 jours | attention | relancer les clients concernés |
| R5 `aucune_facture_du_mois` | 0 facture finale dans le mois et jour du mois ≥ S6 | S6 = 10ᵉ jour | attention | émettre les factures du mois |
| R6 `proformas_anciennes` | `proformas_anciennes.nombre` > 0 | S5 = 14 jours | info | émettre ou supprimer les pro forma |
| R7 `tresorerie_a_renseigner` | `tresorerie` à renseigner | — | info | renseigner la trésorerie disponible |

Une règle dont les faits sont masqués ou indisponibles est **non évaluée** et le dit
(`rulesSkipped`) : l'absence d'alerte n'est jamais présentée comme une bonne nouvelle.

### 4. L'explication par l'IA

`POST /morning-brief/explanation`, corps `{ "intent": "explain" | "this_week" }`.

- **Ce que reçoit le modèle** : uniquement les faits `known` du brief de l'organisation
  courante, les alertes et recommandations rendues, la période. **Jamais** : nom de
  l'organisation, noms ou coordonnées de clients, numéros de facture, texte saisi par un
  utilisateur, message d'erreur de la DGI. L'organisation est celle de la session
  (`req.orgId`, résolue par `AuthGuard` puis `PermissionsGuard`), jamais un paramètre du corps.
- **Encadrement** : les données sont placées dans un bloc `<donnees_non_fiables>` ; la
  consigne système dit que ce bloc est une donnée, jamais une instruction ; les chevrons sont
  retirés des chaînes avant insertion.
- **Réponse JSON stricte** : `{ paragraphe, sources[] }` ou `{ actions: [{ texte, sources[] }] }`
  (1 à 3 actions). Rejetée si : JSON invalide, source inconnue ou absente, texte vide ou trop
  long, **un seul nombre absent des faits** (même vérificateur que Lala :
  `chiffresNonAutorises`). Rejet → texte déterministe (`source: 'fallback'`), journalisé.
- **Mention** servie par l'API : « Explication rédigée à partir des chiffres calculés par
  Lalanda. Ce n'est ni un conseil en investissement, ni un conseil juridique, comptable ou
  fiscal. »
- **Modèle** : `gpt-4o-mini` (celui de Lala et des actions correctives, ADR-0008) ; bornes
  S22h inchangées.

### 5. Quotas et coûts

- **Quota** : le quota mensuel commun `aiMessagesPerMonth` de l'offre (Gratuit 20, Pro 500,
  Cabinet 1 500, Business 2 000, Expert illimité), via `runGuarded` : refus 403 **avant**
  l'appel ; une génération **acceptée** compte 1 message ; une génération rejetée par le
  vérificateur et un repli sans appel ne comptent rien (même position que Lala : nos rejets
  ne sont pas facturés au client ; leur coût reste visible dans le journal).
- **Cache** : une explication acceptée est réutilisée pour la même organisation, la même
  intention, le même jour de Kinshasa et la **même empreinte SHA-256 des faits** : la relire
  ne consomme rien. Les faits changent → nouvelle génération possible.
- **Coût estimé** (tarif public `gpt-4o-mini` : 0,15 $ par million de jetons en entrée,
  0,60 $ en sortie) : ~1 500 jetons en entrée et ~400 en sortie par génération, soit
  **~0,0005 $** ; une organisation qui génère les deux intentions chaque jour ouvré :
  ~44 générations par mois, **~0,02 $ par mois**. L'e-mail quotidien ne coûte aucun appel.
- **Débit** : `AI_THROTTLE` par IP et par utilisateur, comme Lala.

### 6. Journalisation

Collection `morning_brief_ai_logs`, une ligne par tentative : organisation, utilisateur
(identifiant), intention, modèle, version de prompt, empreinte des faits, jour, **prompt
envoyé** (agrégats seulement, par construction sans donnée personnelle), réponse brute
bornée à 4 000 caractères, issue (`accepted`, `rejected`, `error`, `disabled`), motif de rejet,
durée. **Expiration automatique** (index TTL) après `MORNING_BRIEF_AI_LOG_RETENTION_DAYS`
jours (défaut 90, bornes 1 à 365). Aucune clé, aucun secret, aucun jeton.

### 7. Désactivation

- **Par organisation** : `PUT /morning-brief/settings { aiEnabled }` (`organization.manage`,
  journal d'audit `morning_brief.settings.updated`). Désactivée → le brief reste complet,
  l'explication répond par le texte déterministe sans appel ni quota.
- **Par la plateforme** : `MORNING_BRIEF_AI=off` coupe l'IA du brief pour toutes les
  organisations ; l'absence de clé OpenAI produit le même effet (repli existant).
- **L'e-mail** : désactivé par défaut, **par utilisateur et par organisation**.

### 8. E-mail quotidien

`PUT /morning-brief/preferences { emailDaily }` (`analytics.read` : c'est la préférence de
l'appelant, pour l'organisation active). Tâche récurrente `morning-brief.daily-email`, toutes
les 15 minutes : à partir de **7 h à Kinshasa**, chaque abonnement non encore servi ce jour
est **réclamé atomiquement** (`lastSentOn` posé avant l'envoi : au plus un e-mail par jour,
une panne d'envoi perd l'e-mail du jour sans doublon — même politique que les autres e-mails,
docs/17). Avant l'envoi : la membership existe encore, le rôle détient toujours
`analytics.read`, l'organisation n'est pas suspendue ; le bloc ventes suit `sales.read`.
Lot borné à 200 envois par passage.

### 9. Routes et permissions

| Route | Permission |
|---|---|
| `GET /morning-brief` | `analytics.read` (bloc ventes : `sales.read`, sinon `hidden`) |
| `POST /morning-brief/explanation` | `analytics.read` + quota IA + débit IA |
| `GET /morning-brief/preferences` · `PUT /morning-brief/preferences` | `analytics.read` |
| `PUT /morning-brief/settings` | `organization.manage` |

### 10. Points d'extension

Interfaces de l'API (`morning-brief.ports.ts`), branchées à vide sur `main` :
`ReceivablesSource` (ADR-0031 : reste à encaisser réel et échéances dépassées remplacent la
part à crédit déclarée), `CashPositionSource` (ADR-0034 : trésorerie connue), `PipelineSource`
(ADR-0035), `HealthSource` (ADR-0032). Le moteur accepte déjà ces faits en entrée ; les
brancher n'ajoute que des faits et des règles, sans toucher aux existants.

## Conséquences

- Nouveau module moteur `morning-brief` (`MORNING_BRIEF_VERSION = '1.0.0'`).
- Nouvelles collections : `morning_brief_settings`, `morning_brief_subscriptions`,
  `morning_brief_ai_logs` (TTL).
- Nouvelle intention d'e-mail `sendMorningBrief`.
- Nouvel onglet **Brief du matin** de l'espace organisation (`/organisation/brief`).
- Le quota IA mensuel est désormais aussi consommé par le brief (étiquette `ai.morning_brief`).

## Plan de validation

Moteur : chaque règle déclenchée et non déclenchée, à son seuil exact ; CA hors groupes exclus,
avoirs déduits, série d'essai et acomptes exclus ; créances imputées des avoirs ; faits masqués
→ règles non évaluées. API : isolation (une organisation ne voit jamais les factures d'une
autre, même avec un identifiant forgé) ; bloc ventes masqué au rôle sans `sales.read` ; quota
épuisé → 403 sans appel au modèle ; repli non décompté ; cache non décompté ; IA désactivée →
aucun appel ; **aucun nombre inventé** (réponse simulée citant un nombre absent → rejet) ;
injection dans les données encadrée ; e-mail au plus une fois par jour, jamais à un ancien
membre. Aucun test n'appelle un modèle réel.

## Décisions ouvertes — pour la dirigeante

1. **Seuils** S2 (24 h), S4 (30 jours), S5 (14 jours), S6 (10ᵉ jour du mois) : à confirmer ou
   remplacer ; S4 rejoint la décision n° 5 d'ADR-0031 (échéance par défaut).
2. **Heure d'envoi** de l'e-mail (7 h, Kinshasa) : fixe, ou choisie par l'utilisateur ?
3. **Questions libres** au brief (« Pourquoi le cash baisse-t-il ? »…) : à ouvrir quand les
   faits correspondants existeront (trésorerie, encaissements) ?
4. **Prévisions** (niveau 4) : projection de trésorerie à 30 jours par le moteur une fois
   ADR-0031 et ADR-0034 livrés ?
5. **Conservation des journaux IA** : 90 jours par défaut ; faut-il l'exposer par organisation
   (docs/11 « politique de conservation configurable ») ?
6. **IA activée par défaut** dans le brief (rien n'est généré sans clic) : confirmer.

## Liens

- Brief stratégique ERP et IA (dirigeante, oct. 2026) § 7, § 8 ; docs/11 ; docs/13 ; docs/17 ; docs/21.
- [ADR-0008](ADR-0008-ia-openai.md) ; [ADR-0012](ADR-0012-modele-rbac-complet.md) ;
  [ADR-0014](ADR-0014-envoi-emails-et-connexion-google.md) ;
  [ADR-0020](ADR-0020-ordonnanceur-mongodb.md) ; [ADR-0023](ADR-0023-factures-et-avoirs.md) ;
  [ADR-0024](ADR-0024-normalisation-dgi.md) ; ADR-0031 (proposé, branche parallèle).
- Code : `packages/engine/src/morning-brief/`, `apps/api/src/morning-brief/`,
  `apps/web/src/app/(app)/organisation/brief/`.
