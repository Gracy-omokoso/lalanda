# Audit de sécurité avant mise en production (S22e)

**Statut :** en cours de rédaction (S22e)
**Portée :** `apps/api`, `apps/web`, `packages/`, chaîne de déploiement (CI, images, compose, reverse proxy).
**Méthode :** chaque finding porte une **démonstration** — un `curl` rejouable contre l'API locale (`:3001`, pile `docker compose` en marche) ou un test qui échoue. Un constat non démontré n'est pas listé ici. Ce qui est déjà correct n'est pas listé non plus : ce document n'est pas un inventaire de conformité, c'est une liste de ce qui doit changer.

---

## Ce qui bloque une mise en production

Cette section est la seule à lire avant d'arbitrer une date de livraison.

**Aucun franchissement de locataire n'a été trouvé.** L'isolation multi-organisation est solide : toute lecture/écriture métier passe par un filtre `{ _id, organizationId }` (ex. `projects.service.ts:57` `findScoped`, `canvas.service.ts:26,45,68`), l'organisation active vient du cookie de session **vérifiée côté serveur** à chaque requête (`auth.guard.ts:64-77` + `orgs.isMember`), jamais du corps de requête, et l'org visée par une route `/:orgId` est réévaluée contre la membership dans `permissions.guard.ts`. Un `active_org_id` forgé (valeur bidon ou opérateur `$ne`) est ignoré silencieusement (démontré : `GET /projects` renvoie l'org primaire, pas les données d'autrui). Le refus par défaut est garanti par `routes-coverage.test.ts`. **C'est le point le plus rassurant de cet audit.**

**Ne bloque PAS strictement, mais à corriger avant l'ouverture commerciale :**

1. **Dépendances (F-06).** `next@15.1.3` porte deux avis critiques exploitables (RCE flight protocol, bypass middleware CVE-2025-29927). Le middleware Lalanda ne fait que du gating d'UX — l'auth réelle est côté API — donc pas de bypass d'autorisation démontré ici, mais deux RCE connues dans le framework front en prod ne se livrent pas. **Bump `next` ≥ 15.2.3 requis** (chantier `apps/web` dédié).
2. **Rate limiting global partagé (F-03).** Derrière Caddy, le seau de 100 req/min est de fait commun à tous les clients : 100 req/min d'un attaquant renvoient 429 à tout le monde. DoS applicatif trivial. À corriger (tracker `X-Forwarded-For` + `trust proxy`) ou à assumer explicitement.
3. **Écarts doctrine docs/17 (F-07) :** pas de MFA plateforme, pas de SMTP donc pas de vérification d'email ni de notification d'événement critique, journal d'audit non centralisé/alerté. Prise de compte plus facile que ce que la doctrine annonce. Décisions produit (ADR SMTP/MFA), hors périmètre de correction ici.

**Déjà corrigé dans cette PR :** exposition réseau des services de données en dev (F-01), confinement du renderer PDF contre la SSRF (F-02), et — commits antérieurs — DoS par exports PDF concurrents (RenderGate), durcissement CI/deploy (permissions GITHUB_TOKEN, action épinglée par SHA, injection de tag), durcissement du compose de production (`no-new-privileges`, `mem_limit`, `pids_limit`, images figées), CSP web complétée, HSTS, `poweredByHeader: false`.

**Gravité résiduelle après cette PR : rien de « Bloquant » au sens strict (attaquant distant → données clientes) n'a été trouvé.** Les deux findings Élevés restants (F-06, F-03) demandent respectivement un chantier front et une décision d'infrastructure.

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

### F-01 — Services de données publiés sur toutes les interfaces en développement — CORRIGÉ

- **Gravité :** Élevé (contexte développement ; aucun impact production).
- **Emplacement :** `docker-compose.yml:32,82,100,101` (avant correctif).
- **Exploitabilité :** Mongo tourne sans `--auth`, Redis sans `requirepass`, MinIO avec un mot de passe en clair dans le fichier. `ports: - '27017:27017'` publie sur `0.0.0.0`, pas sur `localhost` — et sur macOS perce le pare-feu applicatif.
- **Démonstration** (depuis un autre hôte du même wifi, IP LAN `172.20.10.3`) :
  ```
  $ mongosh "mongodb://172.20.10.3:27017/lalanda" --quiet \
      --eval 'JSON.stringify(db.user.find({},{email:1,name:1}).limit(3).toArray())'
  [{"_id":"…","name":"Gracy Omokoso","email":"gracy.omokoso@gofreelancerdc.com"}, …]
  $ redis-cli -h 172.20.10.3 -p 6379 PING     → PONG
  $ curl -o /dev/null -w '%{http_code}' http://172.20.10.3:9001/   → 200
  ```
  Adresses email réelles des comptes de dev lisibles, base entière accessible en écriture, sans aucun identifiant, depuis n'importe quelle machine du réseau (hôtel, coworking, conférence).
- **Impact :** compromission totale des données de développement et poste de rebond.
- **Correction (livrée) :** publication restreinte à `127.0.0.1:` pour les quatre ports. L'application (qui vise `localhost`) et la communication inter-conteneurs (réseau Docker, sans publication) sont inchangées. `docker-compose.prod.yml` n'était pas concerné (réseau `internal: true`, seul Caddy publié).

### F-02 — Renderer PDF Puppeteer non confiné : une future injection HTML devient une SSRF interne — CORRIGÉ

- **Gravité :** Élevé (défense en profondeur ; pas de chemin complet aujourd'hui car l'échappement est actuellement exhaustif).
- **Emplacement :** `apps/api/src/reports/reports.service.ts:52-55` (flags de lancement) et `:120` (`setContent`), `apps/api/src/reports/report-html.ts` (`<head>`).
- **Exploitabilité :** le rapport est rendu par un Chromium lancé avec `--no-sandbox --disable-setuid-sandbox`, **JavaScript activé**, **sans interception réseau**, sur le réseau Docker qui joint `mongo:27017`, `minio:9000` et l'endpoint de métadonnées cloud `169.254.169.254`. L'échappement HTML (`escapeHtml`, `report-html.ts:95`) est aujourd'hui exhaustif (27 sites vérifiés), donc pas d'XSS immédiate — mais un seul oubli futur, dans un renderer non confiné, cesse d'être un défaut cosmétique dans un PDF pour devenir une exfiltration réseau déclenchée par quiconque télécharge le PDF (ou par l'attaquant appelant `GET /projects/:id/report/pdf`).
- **Démonstration** (script Puppeteer répliquant le chemin de rendu, contre la pile locale) :
  ```
  AVANT durcissement :  title after JS = JS-RAN   |  exfil result = minio-9000-reachable
  APRÈS durcissement :  title (JS ran?) = (vide)  |  exfil = undefined (JS disabled)  |  requests aborted = []
  ```
  Le HTML hostile `<script>fetch('http://127.0.0.1:9000/…')</script>` s'exécutait et joignait MinIO ; après correctif le script ne s'exécute plus et aucune requête ne sort (l'`<img src=http://…>` de test est bloqué en amont par la CSP).
- **Impact :** SSRF vers les services internes, lecture de métadonnées cloud, exfiltration de données via `fetch`/beacon, le tout sans interaction utilisateur.
- **Correction (livrée), trois barrières indépendantes chacune suffisante :**
  1. `page.setJavaScriptEnabled(false)` — aucun script de la page ne s'exécute ;
  2. `page.setRequestInterception(true)` + avortement de toute requête sortante — couvre aussi les vecteurs sans JS (`<img>`, `<link>`) ;
  3. `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">` dans le document — filet qui survit même à une régression du service.
  Test de non-régression : `apps/api/src/reports/report-html.confinement.test.ts`.
  **Reste ouvert (hors périmètre applicatif) :** dropper `--no-sandbox` en donnant au conteneur `--cap-add=SYS_ADMIN` ou un profil seccomp Chromium, pour restaurer le bac à sable du renderer lui-même.

### F-03 — Panier de rate limiting global unique : 100 req/min pour TOUS les clients confondus

- **Gravité :** Moyen.
- **Emplacement :** `apps/api/src/security/throttling.module.ts:22` (`ThrottlerModule.forRoot([{ name: 'default', ...GLOBAL_THROTTLE }])`), `apps/api/src/security/throttling.ts:6`.
- **Exploitabilité :** le `ThrottlerGuard` par défaut de `@nestjs/throttler` clé sur l'IP — mais derrière Caddy toutes les requêtes arrivent avec l'IP du proxy, et le tracker par défaut ne lit pas `X-Forwarded-For`. Le compteur devient de fait **global** : un seul client sature le quota de toute l'API.
- **Démonstration** (contre `:3001` local ; 120 requêtes portant chacune une `X-Forwarded-For` différente) :
  ```
  requête #101 (X-Forwarded-For 203.0.113.102) → 429  {"statusCode":429,"message":"ThrottlerException: Too Many Requests"}
  X-Forwarded-For 198.51.100.99 (IP jamais vue)  → 429
  ```
  La 101ᵉ requête est refusée quelle que soit son IP annoncée, et une IP totalement nouvelle est refusée dans la foulée : le seau est partagé. En production derrière Caddy, 100 requêtes/min d'un attaquant suffisent à renvoyer 429 à tous les utilisateurs légitimes — déni de service applicatif trivial.
- **Impact :** DoS de disponibilité à très faible coût ; a contrario, un attaquant multi-IP contourne toute limite « par IP » supposée.
- **Correction proposée (non livrée — à cadrer) :** configurer le `ThrottlerGuard` pour dériver le client de `X-Forwarded-For` **en ne faisant confiance qu'au dernier proxy** (Caddy), via un `getTracker` personnalisé, et fixer `app.set('trust proxy', 1)`. Sans cela, distinguer les clients derrière le proxy est impossible. À défaut de temps, documenter que la limite globale est un plafond de charge, pas une protection par client, et poser une limite basse par session sur les routes coûteuses (déjà fait pour `/ai/corrective-actions`). Le durcissement `pids_limit`/`mem_limit` du compose (déjà en place) borne l'impaction mémoire mais pas ce DoS applicatif.
- **Note multi-instances :** compteurs en mémoire de process (déjà signalé docs/17 § Restant S16a). Dès deux instances d'API, chaque instance a son propre seau : la limite effective double, et le quota `/ai` par utilisateur devient contournable en frappant l'autre instance. Prérequis : backend Redis partagé (`@nest-lab/throttler-storage-redis`).

### F-04 — Corps de requête non validé sur `reopen` : 500 non géré (robustesse) — CORRIGÉ

- **Gravité :** Faible.
- **Emplacement :** `apps/api/src/actuals/actuals.controller.ts:153` (`@Body() body: { reason?: string }` — assertion de type, pas validation) → `apps/api/src/actuals/actuals.service.ts:160` (`reason?.trim()`).
- **Exploitabilité :** route `POST /projects/:id/actual-periods/:year/:month/reopen`, protégée par `@RequirePermission('period.close', 'plan.approve')` — donc réservée à un rôle propriétaire/admin de sa propre organisation. Un corps `{"reason": {"x":1}}` fait que `reason.trim` vaut `undefined` → `TypeError` → **500** non intercepté. Pas d'injection (aucun opérateur n'atteint Mongo), pas de franchissement de tenant : simple défaut de robustesse produisant une 500 au lieu d'un 400.
- **Impact :** bruit d'erreur 500 et absence de contrat d'entrée clair sur une route privilégiée.
- **Correction (livrée) :** garde de type dans `actuals.service.ts` (boundary de validation applicative de ce module) — un `reason` non-chaîne renvoie `400 REOPEN_REASON_INVALID` au lieu de crasher. Test e2e `actuals.e2e.test.ts` (cas `{"reason": {"$ne": null}}` → 400).

### F-05 — DTO d'entrée non `.strict()` sur plusieurs contrôleurs (durcissement) — PARTIELLEMENT CORRIGÉ

- **Gravité :** Faible (pas de mass-assignment aujourd'hui).
- **Emplacement :** `apps/api/src/projects/projects.dto.ts:3,19,23`, `apps/api/src/evaluate/evaluate.dto.ts:6`, `organizations.controller.ts:17`, `invitations.controller.ts`, `members.controller.ts`, `ai-actions.dto.ts`.
- **Exploitabilité :** aucune dans l'état — Zod v3 (`zod@3.25.76`) **strippe** les clés inconnues par défaut et chaque contrôleur consomme `parsed.data`, jamais le `body` brut. Il n'y a donc pas d'affectation de masse. Mais un objet non `.strict()` accepte silencieusement des champs superflus au lieu de les rejeter en `400` : le jour où un handler lit `body` directement, ou où un champ sensible est ajouté au schéma sans le vouloir côté client, l'écart devient exploitable.
- **Impact :** marge de sécurité réduite, contrat d'entrée implicite.
- **Correction (livrée pour le périmètre autorisé) :** `.strict()` ajouté à `CreateProjectSchema`, `UpdateDriversSchema`, `EvaluateProjectSchema` (`projects.dto.ts`) et `EvaluateRequestSchema` (`evaluate.dto.ts`). **Restant, hors périmètre de correction :** `organizations.controller.ts:17`, `invitations.controller.ts`, `members.controller.ts`, `ai-actions.dto.ts` (modules `organizations/`, `ai/` non modifiables ici). Non bloquant.

### F-06 — Dépendances : 3 avis critiques et 21 hauts gelés dans le cliquet, dont Next.js exploitable

- **Gravité :** Élevé (dette datée ; le correctif principal est un bump `next` hors périmètre de cette PR).
- **Emplacement :** `scripts/audit-baseline.json` (24 avis gelés), consommé par `scripts/audit-dependencies.mjs` (nouveau job CI, cliquet — voir son en-tête).
- **Détail des critiques :**
  - `next@15.1.3` — **GHSA-9qr9-h5gf-34mp** : RCE dans le protocole React flight (`<15.1.9`, corrigé en 15.1.9).
  - `next@15.1.3` — **GHSA-f82v-jwr5-mffw** : contournement d'autorisation dans le middleware Next (`<15.2.3`, CVE-2025-29927).
  - `vitest` — **GHSA-5xrq-8626-4rwp** : lecture/exécution de fichier arbitraire quand le serveur UI de Vitest écoute (dépendance de dev uniquement, non exposée en prod).
- **Démonstration partielle :** le middleware `apps/web/src/middleware.ts` ne fait que du gating d'UX (redirection), l'authentification réelle est côté API (`AuthGuard`). Le vecteur testé du CVE-2025-29927 (`x-middleware-subrequest`) **n'a pas altéré le gating** sur ce déploiement (`GET /projects` + en-tête → toujours `307 → /login`). L'avis reste néanmoins présent dans la version installée et le middleware Next reste une surface à ne pas charger de décisions d'autorisation.
- **Impact :** deux RCE/bypass connus dans le framework front en production ; dette figée mais non corrigée.
- **Correction proposée :** bump `next` ≥ 15.2.3 (idéalement dernière 15.x) et retrait des lignes correspondantes de `audit-baseline.json` — le bump touche `apps/web` mais relève d'un chantier dédié (risque de régression Next). **Échéance recommandée : avant l'ouverture commerciale.** Le cliquet garantit qu'aucune *nouvelle* dette haute/critique n'entre d'ici là (job `Audit des dépendances` en CI).

### F-07 — Écart avec docs/17 : MFA plateforme, SMTP/vérification email et audit centralisé absents

- **Gravité :** Moyen (dette de doctrine, pas de faille exploitable directe).
- **Emplacement :** `docs/17-SECURITE.md` § « Restant » + § « Bloqué par l'absence de SMTP ».
- **Constat (revue, non corrigé — auth/ hors périmètre) :**
  - **MFA absente** pour les rôles sensibles alors que docs/17 § Identité et § Menaces (« élévation de privilèges ») la prévoit. Une session volée d'un propriétaire donne un accès complet sans second facteur.
  - **`AUTH_REQUIRE_EMAIL_VERIFICATION=false`** faute de SMTP : `emailVerified` vaut `false` pour tous, le changement d'adresse ne peut aboutir, aucune notification d'événement critique (changement de mot de passe/adresse) n'est envoyée — protection contre la prise de compte silencieuse inopérante.
  - **Journal d'audit centralisé et alerté** : `authz/audit.service.ts` enregistre en base mais rien n'est exporté ni alerté (docs/17 § Journalisation).
- **Impact :** surface de prise de compte plus large que ce que la doctrine annonce ; à porter au registre de risque avant ouverture.
- **Correction :** hors périmètre (auth/, mail/). À traiter par les ADR SMTP et MFA déjà annoncés dans docs/17.

<!-- /FINDINGS -->

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
