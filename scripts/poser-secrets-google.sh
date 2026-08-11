#!/usr/bin/env bash
# Pose les identifiants Google dans `.env.production`. S'exécute SUR LE SERVEUR.
#
# Lit deux lignes sur l'entrée standard : l'identifiant client, puis le secret.
# Appelé par `scripts/configurer-google.sh` depuis le poste de développement.
#
# ── Pourquoi un fichier séparé plutôt qu'une commande en ligne ───────────────
#
# La première version passait ce code en argument de `ssh`, dans une chaîne
# doublement citée. Les `$` du script s'y trouvaient à deux niveaux
# d'interprétation : ils ont été résolus côté serveur au lieu d'être substitués,
# et `.env.production` a reçu les chaînes littérales `$cid` et `$csec`. Le
# fichier paraissait correct — deux variables actives, non vides — et rien ne
# signalait la panne avant que le bouton n'apparaisse pas.
#
# Un fichier de script n'a aucun de ces niveaux : ce qui est écrit est ce qui
# s'exécute. Le code voyage par `scp`, les valeurs par l'entrée standard, et
# les deux ne se croisent jamais dans une chaîne de caractères.

set -euo pipefail

FICHIER="${1:-/opt/lalanda/.env.production}"

read -r CLIENT_ID
read -r CLIENT_SECRET

if [[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]]; then
  echo "❌ Identifiant ou secret vide sur l'entrée standard." >&2
  exit 1
fi

# Garde-fou contre la panne d'origine : une valeur qui commence par `$` est le
# signe qu'une substitution a échoué quelque part en amont.
if [[ "$CLIENT_ID" == \$* || "$CLIENT_SECRET" == \$* ]]; then
  echo "❌ Valeur commençant par « \$ » — substitution ratée en amont, rien n'est écrit." >&2
  exit 1
fi

# Forme attendue, vérifiée avant d'écrire plutôt que constatée après.
if [[ "$CLIENT_ID" != *.apps.googleusercontent.com ]]; then
  echo "❌ L'identifiant client ne se termine pas par .apps.googleusercontent.com" >&2
  exit 1
fi

cp "$FICHIER" "$FICHIER.avant-google"

# `python3` plutôt que `sed` : la substitution se fait sur des valeurs
# littérales, sans qu'aucun caractère du secret (`|`, `&`, `\`) ne puisse être
# interprété comme de la syntaxe.
CLIENT_ID="$CLIENT_ID" CLIENT_SECRET="$CLIENT_SECRET" python3 - "$FICHIER" <<'PYTHON'
import os, re, sys

chemin = sys.argv[1]
valeurs = {
    "GOOGLE_CLIENT_ID": os.environ["CLIENT_ID"],
    "GOOGLE_CLIENT_SECRET": os.environ["CLIENT_SECRET"],
}

lignes = open(chemin, encoding="utf-8").read().splitlines()
poses = set()

for i, ligne in enumerate(lignes):
    for cle, valeur in valeurs.items():
        # Reprend la ligne qu'elle soit active ou commentée : le gabarit livre
        # ces variables commentées, c'est l'état de départ normal.
        if re.match(rf"^#?\s*{cle}=", ligne):
            lignes[i] = f"{cle}={valeur}"
            poses.add(cle)

for cle, valeur in valeurs.items():
    if cle not in poses:
        lignes.append(f"{cle}={valeur}")
        poses.add(cle)

open(chemin, "w", encoding="utf-8").write("\n".join(lignes) + "\n")
print(f"▶ Variables posées : {', '.join(sorted(poses))}")
PYTHON

# Relecture : on vérifie ce que le fichier contient VRAIMENT, pas ce qu'on
# croit y avoir écrit. C'est ce contrôle qui manquait à la première version.
verifier() {
  local cle="$1" attendue="$2" lue
  lue="$(grep -m1 "^$cle=" "$FICHIER" | cut -d= -f2-)"
  if [[ "$lue" != "$attendue" ]]; then
    echo "❌ $cle relu ne correspond pas à la valeur fournie (longueur lue : ${#lue})." >&2
    return 1
  fi
  echo "   $cle : ${#lue} caractères, conforme."
}

verifier GOOGLE_CLIENT_ID "$CLIENT_ID"
verifier GOOGLE_CLIENT_SECRET "$CLIENT_SECRET"

echo "▶ Redémarrage de l'API…"
cd "$(dirname "$FICHIER")"
# `--force-recreate` : Compose ne recrée pas toujours un conteneur quand seul le
# contenu d'un `env_file` a changé, et l'API ne lit ses variables qu'au
# démarrage. Sans cela, le fichier est juste mais le service tourne encore avec
# l'ancienne configuration.
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate api >/dev/null 2>&1
echo "▶ API redémarrée."
