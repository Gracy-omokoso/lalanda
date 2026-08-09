# Audit de sécurité avant mise en production (S22e)

**Statut :** en cours de rédaction (S22e)
**Portée :** `apps/api`, `apps/web`, `packages/`, chaîne de déploiement (CI, images, compose, reverse proxy).
**Méthode :** chaque finding porte une **démonstration** — un `curl` rejouable contre l'API locale (`:3001`, pile `docker compose` en marche) ou un test qui échoue. Un constat non démontré n'est pas listé ici. Ce qui est déjà correct n'est pas listé non plus : ce document n'est pas un inventaire de conformité, c'est une liste de ce qui doit changer.

---

## Ce qui bloque une mise en production

Cette section est la seule à lire avant d'arbitrer une date de livraison.

*(en cours de consolidation — voir les findings ci-dessous)*

---

## Échelle de gravité

La classification est faite **par exploitabilité réelle**, pas par catégorie OWASP.

| Niveau | Définition opérationnelle |
| --- | --- |
| **Bloquant** | Exploitable par un attaquant distant avec les moyens qu'il a réellement (un compte gratuit, un nom de domaine, une requête HTTP), avec un impact direct sur la confidentialité des données clientes, l'intégrité financière ou la disponibilité du service. Ne pas livrer en l'état. |
| **Élevé** | Exploitable, mais demande une condition supplémentaire (une action de la victime, un accès réseau particulier, une deuxième faille). À corriger avant l'ouverture commerciale. |
| **Moyen** | Réduit la marge de sécurité sans donner un chemin d'attaque complet aujourd'hui : c'est la deuxième faille dont la première aura besoin. |
| **Faible** | Écart de durcissement ou de doctrine, sans chemin d'attaque identifié. |

---

## Findings

<!-- FINDINGS -->

---

## Annexe — reproduire les démonstrations

```bash
# Pile locale
docker compose up -d           # mongo (rs0), redis, minio
pnpm --filter @lalanda/api dev # API sur :3001

# Deux locataires distincts
for u in alice bob; do
  curl -s -H 'content-type: application/json' \
    -d "{\"email\":\"s22e-$u@example.test\",\"password\":\"Sup3rSecret!$u\",\"name\":\"$u\"}" \
    http://localhost:3001/auth/sign-up/email > /dev/null
  curl -s -D - -o /dev/null -H 'content-type: application/json' \
    -d "{\"email\":\"s22e-$u@example.test\",\"password\":\"Sup3rSecret!$u\"}" \
    http://localhost:3001/auth/sign-in/email \
    | sed -n 's/.*better-auth\.session_token=\([^;]*\).*/better-auth.session_token=\1/p' > "/tmp/$u.cookie"
done
```

Chaque finding cite ensuite la commande exacte qui le démontre.
