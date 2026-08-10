#!/usr/bin/env bash
# Sauvegarde de la base MongoDB de production (S22n).
#
# ── Ce que ce script fait, et ne fait pas ────────────────────────────────────
#
# Il produit une archive `mongodump` compressée, la VÉRIFIE, et applique une
# rotation. Il ne copie RIEN hors du serveur : une sauvegarde qui vit sur la
# machine qu'elle protège ne survit pas à la perte de cette machine. C'est une
# limite assumée de cette première version, écrite ici pour qu'elle ne soit pas
# découverte le jour où elle compte. Voir « Hors site » en bas.
#
# ── Ce qu'il ne doit JAMAIS contenir ─────────────────────────────────────────
#
# `.env.production`, et en particulier `SECRETS_MASTER_KEY`. Les intégrations
# sont chiffrées EN BASE avec cette clé : réunir les deux dans une même archive
# ramènerait le chiffrement à zéro — une seule fuite suffirait au lieu de deux.
# Ce script ne touche donc qu'à la base, jamais au fichier d'environnement.
#
# ── Restauration ─────────────────────────────────────────────────────────────
#
#   docker compose --env-file .env.production -f docker-compose.prod.yml \
#     exec -T mongo mongorestore --archive --gzip --drop < <archive>
#
# `--drop` remplace les collections existantes. À ne lancer qu'en connaissance
# de cause : c'est une restauration, pas une fusion.
#
# ── Usage ────────────────────────────────────────────────────────────────────
#
#   ./scripts/backup-mongo.sh              # sauvegarde + rotation
#   RETENTION_JOURS=30 ./scripts/backup-mongo.sh

set -euo pipefail

REPERTOIRE_DEPLOIEMENT="${REPERTOIRE_DEPLOIEMENT:-/opt/lalanda}"
DESTINATION="${DESTINATION:-$REPERTOIRE_DEPLOIEMENT/backups}"
RETENTION_JOURS="${RETENTION_JOURS:-14}"
COMPOSE="docker compose --env-file $REPERTOIRE_DEPLOIEMENT/.env.production -f $REPERTOIRE_DEPLOIEMENT/docker-compose.prod.yml"

cd "$REPERTOIRE_DEPLOIEMENT"

horodatage="$(date -u +%Y%m%d-%H%M%S)"
archive="$DESTINATION/lalanda-$horodatage.gz"
mkdir -p "$DESTINATION"

echo "▶ Sauvegarde vers $archive"

# `--archive` sur la sortie standard : aucun fichier intermédiaire dans le
# conteneur, donc rien à nettoyer si le script échoue en cours de route.
$COMPOSE exec -T mongo mongodump --archive --gzip --quiet > "$archive"

# ─── Vérification ────────────────────────────────────────────────────────────
#
# Une archive tronquée pèse quand même quelque chose : la taille seule ne prouve
# rien. On demande donc à `mongorestore` de RELIRE l'archive à blanc
# (`--dryRun`), ce qui la déserialise entièrement. Une archive corrompue échoue
# ici, pas le jour de la restauration.

taille=$(wc -c < "$archive")
if [[ "$taille" -lt 1024 ]]; then
  echo "❌ Archive suspecte : $taille octets. Sauvegarde supprimée." >&2
  rm -f "$archive"
  exit 1
fi

if ! $COMPOSE exec -T mongo mongorestore --archive --gzip --dryRun --quiet < "$archive" 2>/dev/null; then
  echo "❌ L'archive ne se relit pas — elle est inutilisable. Supprimée." >&2
  rm -f "$archive"
  exit 1
fi

echo "✅ Archive vérifiée : $(du -h "$archive" | cut -f1)"

# ─── Rotation ────────────────────────────────────────────────────────────────
#
# La suppression vient APRÈS la vérification : on ne retire jamais une ancienne
# sauvegarde tant que la nouvelle n'est pas prouvée lisible.

supprimees=$(find "$DESTINATION" -name 'lalanda-*.gz' -type f -mtime "+$RETENTION_JOURS" -print -delete | wc -l | tr -d ' ')
echo "▶ Rotation ($RETENTION_JOURS jours) : $supprimees archive(s) retirée(s)"

conservees=$(find "$DESTINATION" -name 'lalanda-*.gz' -type f | wc -l | tr -d ' ')
echo "▶ Archives conservées : $conservees ($(du -sh "$DESTINATION" | cut -f1) au total)"

# ─── Hors site ───────────────────────────────────────────────────────────────
#
# À brancher quand un espace distant existe (DigitalOcean Spaces, S3, rsync vers
# une autre machine). Tant que cette étape n'existe pas, la perte du Droplet
# emporte les sauvegardes avec la base.
if [[ -n "${SAUVEGARDE_HORS_SITE:-}" ]]; then
  echo "▶ Copie hors site : $SAUVEGARDE_HORS_SITE"
  eval "$SAUVEGARDE_HORS_SITE \"$archive\""
fi
