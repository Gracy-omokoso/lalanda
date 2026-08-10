#!/usr/bin/env bash
# Configure la connexion Google en production, à partir du fichier JSON que la
# console Google Cloud fait télécharger (ADR-0014).
#
# ── Pourquoi ce script existe ────────────────────────────────────────────────
#
# Les deux valeurs à poser sont un identifiant et un SECRET. Les recopier à la
# main, c'est trois occasions de se tromper — et un secret tronqué ne produit
# pas une erreur claire, il produit un bouton qui échoue au premier clic.
# Ce script les lit directement dans le fichier téléchargé : rien à retaper,
# et le secret n'apparaît ni dans ce fichier, ni à l'écran.
#
# ── Usage ────────────────────────────────────────────────────────────────────
#
#   ./scripts/configurer-google.sh ~/Downloads/client_secret_….json
#
# Facultatif : HOTE=lalanda-prod (alias SSH), REPERTOIRE=/opt/lalanda

set -euo pipefail

JSON="${1:-}"
HOTE="${HOTE:-lalanda-prod}"
REPERTOIRE="${REPERTOIRE:-/opt/lalanda}"

if [[ -z "$JSON" || ! -f "$JSON" ]]; then
  echo "Usage : $0 <chemin du client_secret_….json>" >&2
  exit 1
fi

lire() { python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['web'][sys.argv[2]])" "$JSON" "$1"; }

CLIENT_ID="$(lire client_id)"
CLIENT_SECRET="$(lire client_secret)"
REDIRECTIONS="$(python3 -c "import json,sys; print(' '.join(json.load(open(sys.argv[1]))['web'].get('redirect_uris',[])))" "$JSON")"

# ─── Garde-fou : l'URI de redirection doit correspondre à l'API déployée ─────
#
# Google compare la chaîne caractère par caractère. Une URI qui ne correspond
# pas produit `Error 400: redirect_uri_mismatch` au premier clic, et le message
# n'indique pas laquelle des deux extrémités est fautive. On vérifie donc ici,
# avant d'écrire quoi que ce soit.

API_URL="$(ssh "$HOTE" "grep '^API_URL=' $REPERTOIRE/.env.production | cut -d= -f2-")"
ATTENDUE="${API_URL}/auth/callback/google"

if [[ " $REDIRECTIONS " != *" $ATTENDUE "* ]]; then
  echo "❌ Le fichier Google ne déclare pas l'URI attendue." >&2
  echo "   Attendue : $ATTENDUE" >&2
  echo "   Déclarée : $REDIRECTIONS" >&2
  echo "   Corriger dans Google Cloud → Clients → URI de redirection autorisés." >&2
  exit 1
fi

echo "▶ URI de redirection vérifiée : $ATTENDUE"
echo "▶ Identifiant client : ${CLIENT_ID:0:18}… (secret masqué)"

# Les valeurs partent par l'entrée standard de ssh, jamais en argument de
# commande : un argument serait visible dans la table des processus du serveur
# le temps de l'exécution, et resterait dans l'historique du shell local.
printf '%s\n%s\n' "$CLIENT_ID" "$CLIENT_SECRET" | ssh "$HOTE" "
  set -euo pipefail
  cd $REPERTOIRE
  read -r cid
  read -r csec
  cp .env.production .env.production.avant-google
  sed -i \"s|^#\\\\? *GOOGLE_CLIENT_ID=.*|GOOGLE_CLIENT_ID=\\\$cid|\" .env.production
  sed -i \"s|^#\\\\? *GOOGLE_CLIENT_SECRET=.*|GOOGLE_CLIENT_SECRET=\\\$csec|\" .env.production
  grep -q '^GOOGLE_CLIENT_ID=.\\+' .env.production || { echo '❌ GOOGLE_CLIENT_ID non posé' >&2; exit 1; }
  grep -q '^GOOGLE_CLIENT_SECRET=.\\+' .env.production || { echo '❌ GOOGLE_CLIENT_SECRET non posé' >&2; exit 1; }
  echo '▶ Variables posées. Redémarrage de l API…'
  docker compose --env-file .env.production -f docker-compose.prod.yml up -d api >/dev/null 2>&1
"

echo "▶ Attente de l'API…"
for _ in $(seq 1 30); do
  if [[ "$(curl -s -o /dev/null -w '%{http_code}' "${API_URL}/health" --max-time 10)" == "200" ]]; then break; fi
  sleep 2
done

echo -n "▶ Fournisseurs déclarés : "
curl -s "${API_URL%/}/auth-providers" --max-time 15
echo
echo "   \`{\"google\":true}\` = le bouton « Continuer avec Google » est actif."
echo
echo "Sauvegarde de l'ancien fichier : $REPERTOIRE/.env.production.avant-google"
