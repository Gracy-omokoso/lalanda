#!/usr/bin/env bash
# Configure la connexion Google en production, à partir du fichier JSON que la
# console Google Cloud fait télécharger (ADR-0014).
#
# S'exécute depuis le POSTE DE DÉVELOPPEMENT : il a besoin du fichier JSON et de
# la clé SSH, qui n'existent que là. Il se connecte au serveur lui-même.
#
# ── Usage ────────────────────────────────────────────────────────────────────
#
#   ./scripts/configurer-google.sh ~/Downloads/client_secret_….json
#
# Facultatif : HOTE=lalanda-prod (alias SSH), REPERTOIRE=/opt/lalanda
#
# ── Pourquoi ce script existe ────────────────────────────────────────────────
#
# Les deux valeurs à poser sont un identifiant et un SECRET. Recopiées à la
# main, un caractère manquant ne produit pas d'erreur claire : il produit un
# bouton qui échoue au premier clic. Le script les lit dans le fichier
# téléchargé — rien à retaper, et le secret n'apparaît ni ici, ni à l'écran, ni
# dans la table des processus du serveur.
#
# ── Séparation du code et des données ────────────────────────────────────────
#
# L'écriture est faite par `poser-secrets-google.sh`, envoyé par `scp` et
# exécuté sur le serveur. Une première version passait ce code en argument de
# `ssh`, dans une chaîne doublement citée : les `$` s'y trouvaient à deux
# niveaux d'interprétation, et `.env.production` a reçu les chaînes littérales
# `$cid` et `$csec`. Deux variables actives, non vides, d'apparence normale —
# et un bouton Google qui ne s'affichait pas, sans le moindre message.

set -euo pipefail

JSON="${1:-}"
HOTE="${HOTE:-lalanda-prod}"
REPERTOIRE="${REPERTOIRE:-/opt/lalanda}"
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "$JSON" || ! -f "$JSON" ]]; then
  echo "Usage : $0 <chemin du client_secret_….json>" >&2
  exit 1
fi

lire() {
  python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['web'][sys.argv[2]])" "$JSON" "$1"
}

CLIENT_ID="$(lire client_id)"
CLIENT_SECRET="$(lire client_secret)"
REDIRECTIONS="$(python3 -c "import json,sys; print(' '.join(json.load(open(sys.argv[1]))['web'].get('redirect_uris',[])))" "$JSON")"

# ─── Garde-fou : l'URI de redirection doit correspondre à l'API déployée ─────
#
# Google compare la chaîne caractère par caractère. Une URI qui ne correspond
# pas produit `Error 400: redirect_uri_mismatch` au premier clic, et le message
# n'indique pas laquelle des deux extrémités est fautive. On vérifie ici, avant
# d'écrire quoi que ce soit.

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
echo "▶ Identifiant client : ${CLIENT_ID:0:18}… (${#CLIENT_ID} caractères, secret masqué)"

scp -q "$ICI/poser-secrets-google.sh" "$HOTE:$REPERTOIRE/scripts/poser-secrets-google.sh"
ssh "$HOTE" "chmod +x $REPERTOIRE/scripts/poser-secrets-google.sh"

# Les valeurs partent par l'entrée standard, jamais en argument : un argument
# serait visible dans la table des processus du serveur le temps de
# l'exécution, et resterait dans l'historique du shell local.
printf '%s\n%s\n' "$CLIENT_ID" "$CLIENT_SECRET" |
  ssh "$HOTE" "$REPERTOIRE/scripts/poser-secrets-google.sh $REPERTOIRE/.env.production"

echo "▶ Attente de l'API…"
for _ in $(seq 1 40); do
  if [[ "$(curl -s -o /dev/null -w '%{http_code}' "${API_URL}/health" --max-time 10)" == "200" ]]; then break; fi
  sleep 2
done

echo -n "▶ Fournisseurs déclarés : "
REPONSE="$(curl -s "${API_URL%/}/auth-providers" --max-time 15)"
echo "$REPONSE"

if [[ "$REPONSE" == *'"google":true'* ]]; then
  echo "✅ Le bouton « Continuer avec Google » est actif."
else
  echo "❌ Google n'est toujours pas déclaré. Le fichier est posé, mais l'API ne le voit pas." >&2
  echo "   Vérifier : ssh $HOTE 'cd $REPERTOIRE && docker compose --env-file .env.production -f docker-compose.prod.yml logs api --tail=30'" >&2
  exit 1
fi

echo
echo "Sauvegarde de l'ancien fichier : $REPERTOIRE/.env.production.avant-google"
