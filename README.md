# Lalanda

Lalanda est un SaaS de planification et de pilotage financier destiné aux entrepreneurs et PME (RDC-first, extensible), avec Business Model Canvas dynamique, plan financier 5 ans, prévisionnel/réalisé, Country Packs SYSCOHADA et exports Excel/PDF bancables.

## Démarrage

Prérequis : **Node 20**, **pnpm 9**. Docker est optionnel (voir plus bas).

### 1. Installer les dépendances

```bash
corepack enable
pnpm install
```

### 2. Configurer l'environnement

```bash
cp .env.example .env
```

Renseigne au minimum dans `.env` :

- `MONGODB_URI` — URI d'un cluster **MongoDB Atlas** (M0 gratuit suffit) ou d'un Mongo local (voir §Docker).
- `OPENAI_API_KEY` — clé OpenAI (peut être une valeur factice tant que l'IA n'est pas utilisée).
- Les autres valeurs par défaut fonctionnent.

**MongoDB Atlas** : après avoir créé ton cluster, ajoute ton IP dans **Network Access → ADD CURRENT IP ADDRESS**, sinon les connexions timeout silencieusement.

#### Emails et connexion Google — entièrement optionnels

Les variables `SMTP_*` et `GOOGLE_CLIENT_*` peuvent rester vides : **l'API démarre et fonctionne sans elles** (ADR-0014). Concrètement, sans configuration :

- le bouton « Continuer avec Google » ne s'affiche pas sur `/login` et `/register` ;
- les emails (vérification d'adresse, invitation, réinitialisation de mot de passe) ne partent pas — ils sont journalisés (destinataire et sujet, jamais le corps) et l'interface annonce honnêtement que rien n'a été délivré. Le lien d'invitation reste copiable depuis l'écran des membres.

**Pour recevoir les emails en local**, le plus simple est MailHog (interface web sur `:8025`, aucune authentification) :

```bash
docker run -d -p 1025:1025 -p 8025:8025 mailhog/mailhog
```

puis dans `.env` :

```bash
SMTP_HOST=localhost
SMTP_PORT=1025
```

**Pour activer la connexion Google**, suivre la procédure Google Cloud Console pas à pas dans `docs/adr/ADR-0014-envoi-emails-et-connexion-google.md` § Procédure Google Cloud Console. Renseigner ensuite `GOOGLE_CLIENT_ID` **et** `GOOGLE_CLIENT_SECRET` — les deux ou aucune ; une seule des deux est traitée comme une absence, et l'API le signale au démarrage.

### 3. Démarrer

```bash
pnpm --filter @lalanda/shared build   # première fois seulement
pnpm dev                               # lance web + api en parallèle
```

Endpoints de santé :

- API : http://localhost:3001/health → `{status: ok, mongo: up}`
- Web : http://localhost:3000/health → `{status: ok, api: up}`

### Docker (optionnel)

Un `docker-compose.yml` est fourni pour lancer MongoDB (replica set), Redis et MinIO en local — utile à partir de S8 (BullMQ + stockage objet). Pas requis pour le dev quotidien avec Atlas.

```bash
docker compose up -d
```

### Emplacement du projet

Le projet **doit vivre hors de `~/Documents` et `~/Desktop`** — ces dossiers sont synchronisés iCloud Drive par défaut sur macOS, ce qui offloade `node_modules` et provoque des `ETIMEDOUT` aléatoires. Emplacement recommandé : `~/Code/lalanda`.

## Documentation

- **Charte produit** : [`docs/00-CHARTE-PRODUIT.md`](docs/00-CHARTE-PRODUIT.md)
- **Décisions** : [`docs/adr/`](docs/adr/) (ADR) + [`docs/decisions.md`](docs/decisions.md) (micro-décisions)
- **Brief fondateur** (source directrice, immuable) : [`sources/brief/lalanda-brief.md`](sources/brief/lalanda-brief.md)
- **Documentation complète** : [`docs/README.md`](docs/README.md)

Claude Code lit aussi [`CLAUDE.md`](CLAUDE.md), qui impose les règles de travail essentielles.

## Structure

```
lalanda/
├── apps/
│   ├── web/               # Next.js 15 + Tailwind + shadcn/ui
│   └── api/               # NestJS 10 + Mongoose (jobs BullMQ inclus)
├── packages/
│   ├── engine/            # Compilateur DSL + moteur (HyperFormula) + export xlsx
│   ├── templates/         # Manifestes YAML + seeds sectoriels
│   ├── shared/            # Types, Zod, Money, env config, logger Pino
│   └── ui/                # Composants partagés shadcn
├── sources/               # Brief et classeur (lecture seule)
├── docs/
└── docker-compose.yml
```

## Principes non négociables

- Une seule source de vérité pour les calculs (`packages/engine`).
- Résultats déterministes, auditables, testés (golden files + round-trip LibreOffice).
- Séparation stricte prévisionnel / scénarios / réalisé.
- L'IA explique et conseille ; **elle ne calcule jamais** les états financiers.
- Country Packs versionnés, datés, sourcés.
- Isolation multi-tenant par `organizationId` de bout en bout.

## Plan d'exécution

Voir [`sources/brief/lalanda-brief.md`](sources/brief/lalanda-brief.md) §11 (S0 → S14). Statut d'avancement dans [`docs/25-SPRINTS.md`](docs/25-SPRINTS.md).
