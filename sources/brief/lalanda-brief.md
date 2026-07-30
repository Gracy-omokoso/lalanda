# PROMPT FONDATEUR — Plateforme de plans financiers par templates

> À coller en premier message dans une session Claude Code, à la racine d'un repo vide.
> Dépose ce document dans le repo sous `docs/00-CHARTE-PRODUIT.md` dès le premier commit.
> Il fait autorité sur toutes les décisions techniques ultérieures.

---

## 0. RÈGLE DE FONCTIONNEMENT — À LIRE EN PREMIER

**Tu ne poses aucune question préalable. Tu ne demandes aucune validation. Tu codes.**

Toutes les décisions d'architecture, de stack, de périmètre et de modèle économique sont
prises dans ce document. Elles ne sont pas négociables et ne doivent pas être rediscutées.

Si un point de détail n'est pas couvert ici :
1. tu choisis l'option la plus simple et la plus standard,
2. tu l'inscris en une ligne dans `docs/decisions.md` (date, choix, raison),
3. tu continues sans interrompre.

Tu avances sprint par sprint dans l'ordre du §11. Tu ne passes au sprint suivant que lorsque
le « Fait quand » du sprint courant est vérifié par un test qui passe en CI. À la fin de chaque
sprint, tu commits, tu pushes, et tu écris un résumé de 5 lignes de ce qui est livré.

---

## 1. RÔLE

Tu es le **Lead Architect + développeur unique** de ce produit. Tu es responsable de la
cohérence entre le moteur de calcul, l'export Excel et l'interface web — cette cohérence est
le cœur du produit, pas un détail d'implémentation.

## 2. MISSION PRODUIT

Construire une **application web** qui permet à un entrepreneur sans compétence comptable de
produire en moins de 30 minutes un **plan financier prévisionnel complet et bancable**, à
partir de **templates sectoriels réutilisables**, avec export **Excel vivant** (formules
préservées) et **PDF dossier de financement**.

**Marché primaire :** RDC et Afrique francophone. Normes **SYSCOHADA révisé**, double devise
**USD/CDF**, fiscalité RDC pré-paramétrée, connectivité faible, Mobile Money.

**Ce n'est pas** un tableur en ligne. C'est un **générateur de modèles financiers piloté par
hypothèses**, dont le tableur n'est qu'un des rendus.

## 3. LE PRINCIPE ARCHITECTURAL NON-NÉGOCIABLE

Trois couches, une seule source de vérité :

```
DRIVERS (hypothèses saisies par l'utilisateur)
        │
        ▼
MOTEUR DE CALCUL (graphe de formules — package TypeScript partagé)
        │
   ┌────┴─────┬──────────────┬─────────────┐
   ▼          ▼              ▼             ▼
Grille web  Export .xlsx  Export PDF   API / benchmarks
```

**Règles absolues :**

1. Une formule n'existe **qu'une seule fois**, dans `packages/engine`. Jamais dupliquée en
   front, jamais réécrite à la main dans le générateur Excel.
2. Le `.xlsx` exporté contient les **formules Excel natives**, pas des valeurs figées.
   Un banquier doit pouvoir ouvrir le fichier, changer une hypothèse et voir tout se
   recalculer. Si l'export contient des nombres en dur, c'est un bug bloquant.
3. **Aucune valeur financière (taux, barème fiscal, coefficient) n'est écrite en dur dans le
   frontend.** Tout vient de l'API ou d'un pack de paramètres versionné.
4. Un template est une **donnée versionnée en base**, pas du code. Ajouter un secteur ne doit
   jamais nécessiter un déploiement.

## 4. STACK — DÉCIDÉE, NON NÉGOCIABLE

| Couche | Choix |
|---|---|
| Monorepo | **pnpm workspaces + Turborepo** |
| Frontend | **Next.js 15 (App Router) + TypeScript strict + Tailwind + shadcn/ui** |
| Police | **Poppins** |
| Grille tableur | **AG Grid Community (MIT)** — pas Handsontable, licence commerciale |
| Moteur de calcul | **HyperFormula** (MIT/GPL, headless, formules compatibles Excel) |
| Backend | **NestJS 10 + TypeScript strict** |
| Base de données | **MongoDB 7 + Mongoose 8** via `@nestjs/mongoose` |
| Validation | **Zod** partout (DTO, DSL de template, variables d'env) |
| Génération Excel | **ExcelJS** (formules, styles, validation de données, graphiques) |
| Lecture Excel | **SheetJS (`xlsx`)** — import et diff |
| Files d'attente | **BullMQ + Redis** |
| PDF | **Puppeteer** (rendu HTML → PDF) |
| Stockage fichiers | **DigitalOcean Spaces** via `@aws-sdk/client-s3` |
| Auth | **better-auth** — email + mot de passe, OTP SMS, Google. Multi-tenant |
| Paiements | **PawaPay** (Airtel/Orange/M-Pesa), **Stripe** (cartes), **PayPal** (diaspora) |
| IA | **API Anthropic (Claude)** — assistant d'hypothèses et rédaction. Jamais dans le calcul |
| Infra | **Docker + DigitalOcean + Caddy + GitHub Actions** |
| Tests | **Vitest** (unit), **Playwright** (e2e), **golden files** (§10) |
| Logs | **Pino** structuré JSON |

### Structure du monorepo — à créer telle quelle

```
finplan/
├── apps/
│   ├── web/                 # Next.js 15
│   └── api/                 # NestJS
├── packages/
│   ├── engine/              # compilateur DSL, moteur de calcul, générateur xlsx
│   ├── templates/           # manifestes YAML des templates + seeds
│   ├── shared/              # types, schémas Zod, constantes, utilitaires monétaires
│   └── ui/                  # composants partagés shadcn
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
└── docs/
```

## 5. MONGODB — RÈGLES D'IMPLÉMENTATION SPÉCIFIQUES

MongoDB est le choix retenu. Il impose des disciplines que Postgres imposerait à ta place.
Elles ne sont pas optionnelles.

1. **Replica set obligatoire, même en local.** Les transactions MongoDB exigent un replica
   set. Le `docker-compose.yml` doit démarrer un replica set mono-nœud (`--replSet rs0`) et
   lancer `rs.initiate()` automatiquement via un service `mongo-init`. Sans ça, toutes les
   transactions échoueront et tu perdras une journée à comprendre pourquoi.
2. **L'intégrité référentielle est ton travail, pas celui de la base.** Écris un
   `CascadeService` central. Supprimer un projet supprime ses scénarios, snapshots, versions,
   commentaires et exports, dans une transaction. Aucun document orphelin n'est toléré.
3. **Transactions obligatoires** (`session`) pour : création de version, débit de crédits,
   publication de template, suppression en cascade.
4. **Tous les index sont déclarés explicitement** dans les schémas et listés au §6. MongoDB ne
   te préviendra jamais d'un scan de collection. Active `mongoose.set('debug')` en dev et
   vérifie chaque requête lente avec `.explain()`.
5. **Argent : entiers en centimes uniquement.** Jamais de flottant. Sous-schéma réutilisable
   `Money { amount: number, currency: 'USD' | 'CDF' }`. Les taux de change et pourcentages
   utilisent `Decimal128`.
6. **Limite des 16 Mo.** Un snapshot de calcul complet (36 mois × N lignes × M scénarios) peut
   exploser. Règle : les **agrégats** (CA annuel, EBE, résultat net, trésorerie de clôture
   mensuelle, ratios) sont stockés dans le document ; la **grille complète** est sérialisée en
   JSON gzippé et poussée sur Spaces, le document ne garde que l'URL et un hash.
7. **Pas de tableau non borné** dans un document. Les commentaires, les entrées de réalisé et
   les lignes du grand livre vivent dans leurs propres collections.
8. Chaque document porte un champ **`_schemaVersion: number`**. Les migrations de forme se
   font par script idempotent dans `apps/api/src/migrations/`, joué au démarrage.
9. **`strict: true` et `strictQuery: true`** sur tous les schémas Mongoose. Zod valide en
   entrée d'API, Mongoose valide en entrée de base. Les deux.
10. Les agrégations (benchmarks, tableaux de bord de cohorte) passent par des **pipelines
    d'agrégation**, jamais par du filtrage en mémoire côté Node.

## 6. MODÈLE DE DONNÉES — SCHÉMAS MONGOOSE À IMPLÉMENTER

Écris ces schémas tels quels dans `apps/api/src/<module>/schemas/`.

### Sous-schémas partagés (`packages/shared`)

```ts
// Money — jamais de flottant
export const MoneySchema = { amount: { type: Number, required: true },   // centimes, entier
                             currency: { type: String, enum: ['USD','CDF'], required: true } };
```

### `users`
```
_id, email (unique, index), emailVerified, phone (index sparse), name, avatarUrl,
locale ('fr'), lastSeenAt, _schemaVersion
```

### `organizations`
```
_id, name, slug (unique, index), type ('solo'|'agence'|'incubateur'|'banque'|'ecole'),
pays ('CD'), branding { logoUrl, primary, secondary },
ownerId (ObjectId ref User, index), plan ('free'|'pro'|'business'),
creditsBalance (Number, entier), _schemaVersion
```

### `memberships`
```
_id, organizationId (index), userId (index),
role ('owner'|'admin'|'fondateur'|'comptable'|'mentor'|'viewer'),
invitedBy, acceptedAt
index composé unique { organizationId, userId }
```

### `templates`
```
_id, slug (index), version (semver string),
statut ('draft'|'published'|'deprecated'),
secteur, pays [String], deviseBase, horizonMois,
manifest (Mixed — le DSL complet du §7, validé par Zod à l'écriture),
compiledGraph (Mixed — graphe de dépendances précompilé, généré à la publication),
authorOrganizationId, isPublic (Boolean), installCount, ratingAvg,
publishedAt, _schemaVersion
index composé unique { slug, version }
index { statut, secteur, isPublic }
```
> Un template publié est **immuable**. Une correction = nouvelle version. Les projets restent
> épinglés à leur version, avec une proposition de migration explicite.

### `parameterPacks`
```
_id, code ('cd-2026'), pays, annee, statut,
parametres (Mixed) : { tva: 0.16, ibp: 0.30, ipr: [tranches], cnssEmployeur: 0.13,
                       cnssSalarie: 0.05, inpp: 0.03, onem: 0.002, patente: {...} },
sources [String], _schemaVersion
index composé unique { code }
```

### `projects`
```
_id, organizationId (index), createdBy, nom, description,
templateSlug, templateVersion,
deviseAffichage ('USD'), tauxChangeUsdCdf (Decimal128), dateDebut (Date),
parameterPackCode, statut ('brouillon'|'actif'|'archive'),
scenarioActifId, _schemaVersion
index composé { organizationId, statut, updatedAt: -1 }
```

### `scenarios`
```
_id, projectId (index), nom, type ('pessimiste'|'realiste'|'optimiste'|'custom'),
driverValues (Map<string, number | number[]>)   // 36 valeurs max par driver : borné, OK embarqué
inputsHash (String, index)  // sha256 des driverValues, sert de clé de cache
_schemaVersion
index composé { projectId, type }
```

### `snapshots`
```
_id, projectId (index), scenarioId (index), inputsHash (index),
engineVersion, templateVersion,
agregats { caParAn[], ebeParAn[], resultatNetParAn[], tresorerieFinMois[36],
           seuilRentabilite, bfr, dscr, van, tri, delaiRecuperation },
gridUrl (String — JSON gzippé sur Spaces), gridHash,
alertes [{ code, severite, message, cible }],
computedAt, _schemaVersion
TTL index sur computedAt : 90 jours (cache régénérable)
```

### `versions`
```
_id, projectId (index), numero (Number), libelle, createdBy,
payload (Mixed — projet + scénarios + hypothèses figés), createdAt
index composé unique { projectId, numero }
```

### `comments`
```
_id, projectId (index), ancre { type: 'driver'|'cell', driverId?, feuilleId?, ligneId?, mois? },
auteurId, corps, resolu (Boolean), parentId (pour les fils)
index composé { projectId, resolu, createdAt: -1 }
```

### `exports`
```
_id, projectId (index), scenarioId, format ('xlsx'|'pdf'),
statut ('queued'|'processing'|'done'|'failed'), url, taille, expiresAt
TTL index sur expiresAt
```

### `actualEntries`  (réalisé vs prévisionnel)
```
_id, projectId (index), periode (Date, index), source ('manuel'|'csv'|'ofx'|'mobilemoney'),
compteSyscohada, libelle, montant (Money), sens ('debit'|'credit'),
rapprochementLigneId, importBatchId
index composé { projectId, periode }
```

### `auditLogs`
```
_id, organizationId (index), acteurId, action, entiteType, entiteId,
avant (Mixed), apres (Mixed), ip, userAgent, createdAt (index)
index composé { organizationId, createdAt: -1 }
```

### `creditLedger`
```
_id, organizationId (index), delta (Number), motif, refType, refId, soldeApres, createdAt
```

## 7. LE DSL DE TEMPLATE — cœur du produit

Un template est un manifeste déclaratif, stocké dans `templates.manifest`, validé par un
schéma Zod défini dans `packages/shared/src/template-dsl.ts`.

```yaml
slug: restaurant-kinshasa
version: 1.0.0
secteur: restauration
pays: [CD]
devise_base: USD
horizon_mois: 36
parameter_pack: cd-2026

groupes_hypotheses:
  - id: activite
    label: "Activité"
  - id: charges
    label: "Charges d'exploitation"
  - id: investissement
    label: "Investissements"

drivers:
  - id: couverts_jour
    groupe: activite
    label: "Couverts servis par jour"
    type: number
    defaut: 60
    min: 0
    max: 500
    unite: "couverts"
    aide: "Un restaurant de 40 places à Gombe tourne entre 50 et 90 couverts/jour."
    mensualisable: true          # l'utilisateur peut saisir 36 valeurs distinctes
  - id: ticket_moyen
    groupe: activite
    label: "Ticket moyen"
    type: money
    devise: USD
    defaut: 12
  - id: food_cost_pct
    groupe: charges
    label: "Coût matière"
    type: percent
    defaut: 0.32
    benchmark: 0.31              # médiane sectorielle affichée en regard

feuilles:
  - id: hypotheses
    label: "Hypothèses"
    type: input
  - id: ca
    label: "Chiffre d'affaires"
    lignes:
      - id: ca_restauration
        label: "CA restauration"
        formule: "couverts_jour * ticket_moyen * jours_ouvres(m)"
        format: money
  - id: compte_resultat
    type: syscohada_resultat     # feuille générée par le moteur, mapping plan comptable
  - id: tresorerie
    type: cashflow_mensuel
  - id: bilan
    type: syscohada_bilan

sorties: [seuil_rentabilite, bfr, dscr, van, tri, delai_recuperation]
```

**Contraintes du compilateur (à faire échouer en CI) :**
- Graphe de dépendances **acyclique**. Refuser le template sinon, avec le cycle affiché.
- Chaque formule doit être traduisible **à l'identique** en formule Excel. Toute fonction du
  DSL sans équivalent Excel natif est implémentée comme fonction custom HyperFormula **et**
  comme formule Excel équivalente. Pas d'exception.
- Tous les `driver.id` référencés dans une formule doivent exister.

## 8. PÉRIMÈTRE FONCTIONNEL — DÉCIDÉ

### Modèle économique (décidé, à implémenter en sprint 12)
- **Free** : 1 projet, 1 scénario, export xlsx filigrané, pas de PDF.
- **Pro — 9 USD/mois ou 90 USD/an** : projets illimités, 3 scénarios, PDF, import Excel.
- **Business — 49 USD/mois** : white-label, tableau de bord de cohorte, API, 20 sièges.
- Paiement : PawaPay en priorité pour la RDC, Stripe pour les cartes, PayPal pour la diaspora.

### Décisions de périmètre (ne pas rediscuter)
- **Phase 2 : RDC uniquement.** L'UEMOA viendra après, la structure `parameterPacks` le permet.
- **Mode comptable activé** (accès direct au plan comptable SYSCOHADA) à partir du sprint 7.
- **Pas de mobile natif.** Le web est la référence, en PWA. Point.
- **Pas de saisie libre en cellule.** Ce n'est pas un clone de Google Sheets.

### Les 3 templates de lancement (à écrire en sprint 6)
1. `restaurant-kinshasa` — restauration
2. `quincaillerie-negoce` — négoce et distribution
3. `prestation-services` — conseil, agence, freelance

## 9. RÈGLES D'INGÉNIERIE

1. **Lire le code existant avant d'écrire.** Toujours. Étendre plutôt que créer.
2. Ne jamais dupliquer un module existant. Jamais de second fournisseur de paiement, de second
   service de stockage, de second moteur de calcul.
3. Toute écriture sur un projet, un scénario ou un template est journalisée dans `auditLogs`.
4. Aucun secret dans le code. Variables d'environnement validées par Zod au démarrage : si une
   variable manque, l'API refuse de démarrer avec un message explicite.
5. Chaque PR touchant `packages/engine` fait tourner la suite de golden files.
6. i18n dès le jour 1 (`fr` par défaut, `en` prévu). Aucune chaîne en dur dans les composants.
7. TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. Zéro `any`, zéro
   `@ts-ignore` sans commentaire justifiant.
8. Conventional commits. Une branche par sprint.

## 10. STRATÉGIE DE TEST — la garantie de cohérence

C'est le point le plus important de la qualité produit. À mettre en place au sprint 2, pas après.

**Golden files.** Pour chaque template, dans `packages/engine/__golden__/<slug>/` :
- `inputs.json` — jeu complet de valeurs de drivers ;
- `expected.json` — tous les agrégats attendus ;
- un test Vitest qui évalue via le moteur et compare à `expected.json` ;
- **un test de round-trip** : le moteur génère le `.xlsx`, la CI le recalcule avec
  **LibreOffice headless** (`soffice --headless --convert-to csv`), et compare les valeurs à
  celles du moteur. Tolérance : 0,01. **Un écart fait échouer le build.**

C'est ce test qui garantit que la promesse « le fichier Excel est vivant et juste » tient.
Le job GitHub Actions doit installer LibreOffice (`sudo apt-get install -y libreoffice-calc`).

## 11. PLAN D'EXÉCUTION — SPRINTS DANS L'ORDRE

Tu exécutes dans cet ordre. Tu ne sautes rien. Tu ne commences un sprint que si le précédent
est « fait ».

**S0 — Socle.** Monorepo pnpm + Turborepo, `docker-compose.yml` (MongoDB en replica set
mono-nœud auto-initialisé, Redis, MinIO), CI GitHub Actions (lint, typecheck, test, build),
config Zod des variables d'env, Pino.
*Fait quand :* `docker compose up` puis `pnpm dev` démarre web + api, `/health` répond, la CI
est verte.

**S1 — Moteur.** `packages/engine` : schéma Zod du DSL, parseur YAML, compilateur DSL → graphe
HyperFormula, évaluateur, détection de cycle.
*Fait quand :* un template jouet de 5 drivers s'évalue et les tests unitaires passent.

**S2 — Export Excel + golden files.** Sérialiseur graphe → ExcelJS avec **formules natives**,
styles Poppins, formats monétaires, onglets. Infra de golden files + round-trip LibreOffice
en CI.
*Fait quand :* le round-trip LibreOffice passe sur le template jouet.

**S3 — Données et API.** Tous les schémas Mongoose du §6, indexes, `CascadeService`,
transactions, module d'audit, script de migration.
*Fait quand :* les tests d'intégration CRUD passent et aucun orphelin n'est possible.

**S4 — Auth et tenancy.** better-auth, organisations, memberships, guards de rôle NestJS,
onboarding.
*Fait quand :* deux utilisateurs de deux organisations ne voient jamais les données de l'autre
(test e2e).

**S5 — Interface.** Wizard d'hypothèses **généré automatiquement depuis le DSL** (un driver =
un champ typé, avec aide et benchmark). Vue résultats : compte de résultat, trésorerie
mensuelle 36 mois, bilan, ratios, graphiques. Grille AG Grid en lecture. Bouton d'export.
*Fait quand :* le parcours complet fonctionne dans le navigateur.

**S6 — Les 3 templates de lancement** avec leurs golden files.
*Fait quand :* les 3 round-trips LibreOffice passent.

**S7 — Bancabilité RDC.** ParameterPack `cd-2026` (TVA 16 %, IBP 30 %, IPR par tranches, CNSS
13/5, INPP, ONEM, patente). Plan de financement, échéancier d'emprunt, amortissements linéaire
et dégressif. Mode comptable SYSCOHADA. Multi-devise USD/CDF.
*Fait quand :* un plan avec emprunt et TVA sort des états cohérents, testés en golden file.

**S8 — Dossier PDF.** Puppeteer : page de garde, résumé exécutif, hypothèses, états, ratios,
graphiques. Mise en page attendue par Rawbank, Equity BCDC, TMB, PADMPME.
*Fait quand :* le PDF est généré en tâche BullMQ et téléchargeable.

**S9 — Scénarios.** Pessimiste / réaliste / optimiste, comparaison côte à côte, analyse de
sensibilité (tornado chart : quels drivers font basculer le seuil de rentabilité).
*Fait quand :* trois scénarios s'affichent en parallèle avec leurs écarts.

**S10 — Assistant Claude.** L'utilisateur décrit son projet en langage naturel, Claude
pré-remplit les drivers et justifie chaque hypothèse, puis rédige le mémo stratégique.
**L'IA propose des valeurs de drivers, elle ne calcule jamais.** Toute valeur proposée est
marquée comme telle et modifiable.
*Fait quand :* « je veux ouvrir un restaurant de 40 places à Gombe » remplit le wizard.

**S11 — Aller-retour Excel.** L'utilisateur exporte, travaille hors ligne, réimporte. SheetJS
lit le fichier, le système détecte les cellules modifiées, distingue changement d'hypothèse et
altération de formule, affiche un diff, applique après validation. **Critique en connectivité
faible.**
*Fait quand :* un cycle export → modification → import → recalcul fonctionne sans perte.

**S12 — Monétisation.** PawaPay, Stripe, PayPal, `creditLedger`, quotas par plan, webhooks.
*Fait quand :* un paiement Mobile Money en sandbox fait passer une organisation en Pro.

**S13 — Collaboration et suivi.** Commentaires ancrés, versions restaurables, partage en
lecture avec lien expirant. Import de relevés CSV/OFX et Mobile Money dans `actualEntries`,
rapprochement réalisé vs prévisionnel, re-prévision glissante.

**S14 — Distribution.** Studio de templates (éditeur du DSL + validateur + prévisualisation +
publication), marketplace, white-label incubateurs et banques, tableau de bord de cohorte
(pipeline d'agrégation MongoDB), benchmarks sectoriels anonymisés avec k-anonymat ≥ 20 projets,
API publique et webhooks. PWA offline-first et mode faible bande passante.

## 12. CE QU'IL NE FAUT PAS FAIRE

- Ne pas construire un clone de Google Sheets. La saisie libre en cellule est hors périmètre.
- Ne pas coder un secteur en dur dans le backend. Un secteur = un document `templates`.
- Ne pas laisser un LLM produire un chiffre consommé par le calcul.
- Ne pas exporter des valeurs figées dans le `.xlsx`.
- Ne pas mélanger devises sans conversion explicite et taux tracé.
- Ne pas utiliser de flottant pour de l'argent.
- Ne pas démarrer le mobile, le marketplace ou l'IA avant que le sprint 6 ne passe.
- Ne pas s'arrêter pour demander une validation. Le §0 s'applique.

## 13. DÉMARRAGE IMMÉDIAT

Commence maintenant par le sprint S0. Ton premier commit contient :
`docs/00-CHARTE-PRODUIT.md` (ce document), `docs/decisions.md` (vide avec l'en-tête),
`pnpm-workspace.yaml`, `turbo.json`, `docker-compose.yml`, `.github/workflows/ci.yml`,
et les squelettes `apps/web`, `apps/api`, `packages/engine`, `packages/shared`,
`packages/templates`, `packages/ui`.

Puis enchaîne sur S1 sans t'arrêter.
