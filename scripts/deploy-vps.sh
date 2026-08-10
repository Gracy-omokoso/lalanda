#!/usr/bin/env bash
# Déploiement Lalanda sur le VPS (DigitalOcean Droplet — ADR-0009).
#
# À exécuter depuis le répertoire de déploiement (ex: /opt/lalanda) qui contient :
#   - docker-compose.prod.yml
#   - Caddyfile
#   - .env.production   (copié depuis .env.production.example, secrets remplis)
#
# Usage :
#   LALANDA_TAG=0.2.0 ./scripts/deploy-vps.sh     # version épinglée (recommandé)
#   ./scripts/deploy-vps.sh                        # utilise LALANDA_TAG de .env.production, sinon latest
#
# Appelé aussi par le job `deploy` de .github/workflows/deploy.yml (via SSH).

set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"

# ─── Garde-fous ──────────────────────────────────────────────────────────────

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ docker introuvable. Installer Docker Engine + le plugin compose." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "❌ plugin 'docker compose' introuvable (Compose v2 requis)." >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "❌ $COMPOSE_FILE introuvable — exécuter ce script depuis le répertoire de déploiement." >&2
  exit 1
fi

if [[ ! -f "Caddyfile" ]]; then
  echo "❌ Caddyfile introuvable — requis par le service caddy." >&2
  exit 1
fi

if [[ ! -f ".env.production" ]]; then
  echo "❌ .env.production introuvable. Copier .env.production.example et remplir les secrets." >&2
  exit 1
fi

# Les COMMENTAIRES sont exclus, et c'est indispensable : `.env.production.example`
# documente la clé OpenAI par une ligne commentée `# OPENAI_API_KEY=sk-CHANGE-ME`
# (elle est optionnelle depuis S21b, la vraie se saisit dans /admin). Un `grep`
# brut la trouvait et refusait TOUT premier déploiement, en accusant des secrets
# pourtant tous remplis. Le garde-fou doit porter sur les valeurs affectées.
if grep -vE '^[[:space:]]*#' .env.production | grep -q "CHANGE-ME"; then
  echo "❌ .env.production contient encore des valeurs CHANGE-ME — remplir les secrets avant de déployer." >&2
  grep -vE '^[[:space:]]*#' .env.production | grep -n "CHANGE-ME" | cut -d= -f1 >&2
  exit 1
fi

# ─── Validation de la configuration ─────────────────────────────────────────

echo "▶ Validation de $COMPOSE_FILE…"
docker compose --env-file .env.production -f "$COMPOSE_FILE" config --quiet

# ─── Pull des images (GHCR) ─────────────────────────────────────────────────

echo "▶ Pull des images (tag: ${LALANDA_TAG:-défini par .env.production, sinon latest})…"
docker compose --env-file .env.production -f "$COMPOSE_FILE" pull api web caddy

# ─── Démarrage ──────────────────────────────────────────────────────────────

echo "▶ Démarrage de la stack…"
docker compose --env-file .env.production -f "$COMPOSE_FILE" up -d --remove-orphans

echo "▶ Attente des healthchecks (api, web)…"
for service in api web; do
  for _ in $(seq 1 30); do
    status="$(docker compose --env-file .env.production -f "$COMPOSE_FILE" ps --format '{{.Health}}' "$service" 2>/dev/null || echo unknown)"
    if [[ "$status" == "healthy" ]]; then
      echo "  ✅ $service healthy"
      continue 2
    fi
    sleep 5
  done
  echo "❌ $service n'est pas passé healthy en 150 s — voir : docker compose -f $COMPOSE_FILE logs $service" >&2
  exit 1
done

# ─── Nettoyage des vieilles images ──────────────────────────────────────────

echo "▶ Nettoyage des images non utilisées…"
docker image prune -f >/dev/null

echo "✅ Déploiement terminé."
docker compose --env-file .env.production -f "$COMPOSE_FILE" ps
