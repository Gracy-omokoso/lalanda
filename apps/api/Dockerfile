# API Lalanda (NestJS) — image multi-stage (ADR-0009).
#
# Build depuis la RACINE du monorepo :
#   docker build -f apps/api/Dockerfile -t ghcr.io/gracy-omokoso/lalanda-api .
#
# Choix Puppeteer (ADR-0007) : la génération PDF exige Chromium. Plutôt que de
# laisser Puppeteer télécharger son propre binaire (~170 Mo, glibc requis, liens
# dynamiques absents d'Alpine), on part de `node:20-slim` (Debian bookworm) et on
# installe le paquet `chromium` de la distribution. Puppeteer le trouve via
# `PUPPETEER_EXECUTABLE_PATH` (variable lue nativement par la lib, aucun
# changement de code) et `PUPPETEER_SKIP_DOWNLOAD=true` évite le double
# téléchargement au `pnpm install`. Les flags `--no-sandbox` sont déjà passés
# par ReportsService (apps/api/src/reports/reports.service.ts).

# ─── Stage 1 : build ────────────────────────────────────────────────────────
FROM node:20-slim AS build

# corepack fournit le pnpm épinglé par `packageManager` (pnpm@9.15.0).
RUN corepack enable
WORKDIR /repo

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    CI=true

# 1) Manifests seuls → couche de dépendances mise en cache tant que le lockfile ne bouge pas.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/templates/package.json packages/templates/
COPY packages/ui/package.json packages/ui/

RUN pnpm install --frozen-lockfile

# 2) Sources → build de l'API et de ses dépendances workspace (shared, engine).
COPY packages ./packages
COPY apps/api ./apps/api

RUN pnpm --filter @lalanda/api... run build

# 3) `pnpm deploy` produit une arborescence autonome : dist/ + node_modules/ de
#    production uniquement, avec @lalanda/shared et @lalanda/engine embarqués.
RUN pnpm --filter @lalanda/api deploy --prod /out

# ─── Stage 2 : runtime ──────────────────────────────────────────────────────
FROM node:20-slim AS runtime

# Chromium de la distribution + polices (rendu PDF correct, y compris symboles).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-core \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY --from=build --chown=node:node /out ./

# Utilisateur non-root (fourni par l'image node).
USER node

EXPOSE 3001

# /health répond 200 avec l'état Mongo (apps/api/src/health/health.controller.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "--enable-source-maps", "dist/main.js"]
