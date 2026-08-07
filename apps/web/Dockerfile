# Web Lalanda (Next.js 15) — image multi-stage (ADR-0009).
#
# Build depuis la RACINE du monorepo :
#   docker build -f apps/web/Dockerfile -t ghcr.io/gracy-omokoso/lalanda-web \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.exemple.com .
#
# `next.config.mjs` active `output: 'standalone'` : `next build` trace les
# dépendances réellement utilisées et produit `.next/standalone` (serveur
# autonome ~quelques Mo, sans node_modules complet). Pas de Chromium ici —
# Alpine suffit.
#
# ATTENTION : les variables NEXT_PUBLIC_* sont inlinées dans le bundle AU BUILD.
# `NEXT_PUBLIC_API_URL` doit donc être passée en build-arg avec l'URL publique
# de l'API du déploiement cible.

# ─── Stage 1 : build ────────────────────────────────────────────────────────
FROM node:20-alpine AS build

RUN corepack enable
WORKDIR /repo

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=true

# 1) Manifests seuls → cache des dépendances.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/templates/package.json packages/templates/
COPY packages/ui/package.json packages/ui/

RUN pnpm install --frozen-lockfile

# 2) Sources → build de @lalanda/shared et @lalanda/ui puis `next build`.
COPY packages ./packages
COPY apps/web ./apps/web

ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN pnpm --filter @lalanda/web... run build

# ─── Stage 2 : runtime ──────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

# Sortie standalone : server.js + node_modules tracés, arborescence monorepo conservée.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public

USER node

EXPOSE 3000

# /health répond côté web (apps/web/src/app/health/route.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "apps/web/server.js"]
