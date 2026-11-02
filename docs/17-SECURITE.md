# Sécurité, confidentialité et continuité

**Statut :** Draft  
**Version :** 0.3

## Implémenté (S16a)

Durcissement de production livré au sprint S16a :

### Fait

- **Authentification sur `/evaluate`** : `GET /evaluate/templates`, `GET /evaluate/templates/:slug` et `POST /evaluate` exigent une session valide (`AuthGuard`). L'exposition publique « S3-lite » est terminée. Couvert par tests unitaires (métadonnées de guard) et e2e (401 sans session, 200 avec).
- **Rate limiting** (`@nestjs/throttler`, `apps/api/src/security/`) :
  - global : 100 req/min/IP sur toutes les routes NestJS (`ClientIpThrottlerGuard` en `APP_GUARD` — voir § Chaîne de confiance du reverse proxy pour ce que « IP » veut dire ici) ;
  - quota strict sur `POST /ai/corrective-actions` (endpoint facturé OpenAI, ADR-0008) : authentification obligatoire + 10 req/min **par utilisateur** (`UserThrottlerGuard`, compteur indexé sur l'id de session) et par IP ;
  - les routes `/auth/*` (better-auth, montées en middleware Express) ne passent pas par ces guards — better-auth applique sa propre limitation de tentatives.
- **Headers de sécurité** :
  - API : `helmet` avec ses défauts (nosniff, protection frame, HSTS…) ;
  - Web (`apps/web/next.config.mjs`) : `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **Vérification d'email** : flag better-auth `requireEmailVerification` piloté par `AUTH_REQUIRE_EMAIL_VERIFICATION` (défaut `false` en dev — aucun SMTP branché). **En production, passer à `true` dès qu'un fournisseur d'envoi d'emails est configuré** — c'est possible depuis S22a (ADR-0014), et c'est la parade au pré-enregistrement d'un compte non vérifié à l'adresse d'un tiers.
- **Schéma d'environnement** : `REDIS_URL` et les variables `S3_*` deviennent optionnelles — requises à partir des exports asynchrones ; rien ne les consomme aujourd'hui.

### Restant (hors périmètre S16a)

- MFA pour rôles sensibles ;
- OTP / notification d'événements critiques ;
- journal d'audit centralisé et alerté ;
- envoi d'email réel (SMTP) pour activer la vérification en production ;
- CSP complète côté web (script-src, etc.) ;
- stockage du rate limiting partagé (Redis) si l'API passe en multi-instances — compteurs en mémoire process aujourd'hui.

## Implémenté (S20b) — compte, sessions, suppression

Espace compte livré au sprint S20b (`apps/api/src/account/`, `apps/web/src/app/(app)/compte/`). Contrat détaillé : docs/16 § Espace compte.

### Fait

- **Sessions révocables.** `GET /account/sessions` liste les sessions actives (appareil déduit du User-Agent, IP, dates, session courante marquée) ; révocation unitaire ou « toutes les autres ». Le `token` de session vaut le cookie de connexion : il ne sort jamais de l’API, seul un `id` opaque circule et la révocation résout `id → token` côté serveur. Un test e2e sérialise la réponse et vérifie qu’aucun token ne s’y trouve — l’écran « sessions actives » ne doit pas devenir un distributeur de sessions détournables.
- **Isolation par session, pas par contrôle ajouté.** Aucune route de l’espace compte n’accepte d’identifiant d’utilisateur, sous aucune forme. Ce n’est pas un contrôle qu’on pourrait oublier d’écrire : c’est l’absence de tout paramètre permettant de désigner autrui. Les schémas `.strict()` transforment un `userId` injecté en `400`, jamais en silence.
- **Changement de mot de passe** délégué à better-auth (`authClient.changePassword`), avec option « déconnecter mes autres appareils ». Passer par un endpoint maison obligerait à retransmettre le `Set-Cookie` de rotation de session ; le moindre écart déconnecterait l’utilisateur au moment précis où il sécurise son compte.
- **Changement d’adresse email vérifié** : mot de passe courant exigé (une session volée ne suffit pas à déplacer un compte), token opaque de 32 octets, expiration 24 h, unicité de l’adresse revérifiée **au moment de la vérification** et pas seulement à la demande. L’adresse du compte ne bouge qu’après vérification.
- **Suppression de compte** : double confirmation (adresse exacte du compte **et** mot de passe courant), portée annoncée avant la saisie, cascade explicite sur les données des organisations qui disparaissent avec le compte, puis appartenances, puis sessions et identité. L’ordre est délibéré : chaque étape laisse un état reprenable si la suivante échoue, là où supprimer l’identité en premier transformerait la moindre panne en données orphelines que plus aucune session ne peut réclamer.
- **Règle du dernier propriétaire** (docs/12) appliquée et revérifiée dans le service, pas seulement dans le contrôleur : un compte dernier propriétaire d’une organisation ayant d’autres membres est refusé (`409 LAST_OWNER`). L’éligibilité est consultable **avant** toute saisie.
- **Frontière sans organisation** (ADR-0012 §9) : `/compte` reste joignable pour un utilisateur sans aucune organisation — sinon un compte dont l’organisation a été supprimée serait enfermé dehors, sans moyen de consulter ses sessions ni de supprimer son compte. Un test e2e dédié couvre ce cas et vérifie d’abord, en précondition, qu’une route métier échoue bien en `403 NO_ORGANIZATION`.
- **Journalisation** : la demande de changement d’email est tracée sans le token. On journalise le fait, jamais le moyen.

### Bloqué par l’absence de SMTP — LEVÉ EN S22a (ADR-0014)

> Cette section décrivait un blocage **structurel** : le produit ne savait envoyer aucun email. S22a a branché un module d’envoi (`apps/api/src/mail/`, ADR-0014). Le blocage devient **configurationnel** : il ne subsiste que tant que `SMTP_HOST` n’est pas renseigné, et il est alors annoncé honnêtement plutôt que masqué. Le texte d’origine est conservé ci-dessous parce qu’il décrit exactement l’état d’un déploiement sans SMTP — qui reste un état supporté.

Sans fournisseur d’envoi configuré, les conséquences restent celles-ci, assumées et affichées dans l’interface :

- **le changement d’adresse email ne peut pas aboutir** : le flux serveur est complet (demande, token, expiration, vérification, application, annulation) mais l’email contenant le lien n’est envoyé nulle part. `verificationDelivered` vaut `false` et la réponse porte un motif lisible. Un utilisateur final ne peut donc pas terminer l’opération seul ;
- **`emailVerified` vaut `false` pour tout le monde** (sauf comptes Google, dont Google atteste l’adresse) : la valeur est lue en base et affichée telle quelle, plutôt que de présenter un compte « vérifié » qui ne l’est pas ;
- **aucune notification n’est envoyée** : les préférences de notification sont enregistrées et seront respectées à la mise en service, mais cocher une case ne déclenche aucun message ;
- **`AUTH_REQUIRE_EMAIL_VERIFICATION` doit rester à `false`.**

Appliquer le changement d’adresse sans vérification lèverait le blocage en une ligne — et ouvrirait un chemin de prise de compte (§ Menaces prioritaires), transformant un manque d’infrastructure en faille. Le blocage est donc maintenu tant qu’aucun SMTP n’est en service.

**Avec SMTP configuré** (`SMTP_HOST`, cf. ADR-0014) : les trois emails partent réellement, le changement d’adresse se termine depuis la page publique `/verification-email`, les invitations arrivent dans les boîtes, et `AUTH_REQUIRE_EMAIL_VERIFICATION=true` devient activable — **ce qu’il faut faire**, car c’est la parade au pré-enregistrement décrit dans ADR-0014 § Risque accepté.

### Restant sur le périmètre S20b

- notification à l’ancienne adresse lors d’un changement (protection contre la prise de compte silencieuse) ;
- index unique sur `user.email` : la collection appartient à better-auth et n’en porte aucun ; l’unicité est aujourd’hui applicative et laisse une fenêtre de concurrence théorique. Poser l’index demande une migration des doublons éventuels — à traiter par un ADR dédié ;
- délai de grâce / restauration après suppression de compte : la suppression est immédiate et définitive.

## Implémenté (S21b) — secrets d’intégration chiffrés, espace admin

Coffre et espace d’administration livrés au sprint S21b (`apps/api/src/integrations/`, `apps/api/src/admin/`, `apps/web/src/app/(app)/admin/`, déplacé dans `apps/web/src/app/(console)/admin/` par ADR-0053 — P1). Décision : ADR-0013. Contrat : docs/16 § Espace admin plateforme. Écrans : docs/04 § Implémenté (S21b).

### Fait

- **Chiffrement au repos, AES-256-GCM.** Clé de chiffrement dérivée par HKDF depuis `SECRETS_MASTER_KEY`, une clé de données par secret, `iv` tiré aléatoirement à chaque écriture. L’AAD lie le chiffré à `provider`, au nom du champ et à la portée : un chiffré déplacé d’un fournisseur à un autre, ou d’un champ à un autre, ne se déchiffre pas. Un secret n’est donc pas transposable même par quelqu’un qui aurait un accès en écriture à la base.
- **`SECRETS_MASTER_KEY` est obligatoire au démarrage.** Sans elle, le coffre est indisponible et l’API le dit (`503 VAULT_UNAVAILABLE`) plutôt que d’accepter une écriture qu’elle ne saurait pas protéger. `OPENAI_API_KEY` est devenue **optionnelle** : elle n’est plus qu’une variable de secours, transitoire (ADR-0013 §8).
- **Écriture seule, sans exception.** Aucun endpoint ne rend une valeur de secret. Ce n’est pas un contrôle qu’on pourrait oublier d’écrire : il n’existe aucune route, aucun paramètre, aucun mode de débogage permettant de la demander. Trois barrières se relaient — `toIntegrationView()` recopie des champs **nommés un par un** (aucun `...doc`, aucun `toObject()`), la transformation `toJSON` du schéma réduit `secrets` à des booléens, et le test anti-fuite balaie la sérialisation de toute réponse produite.
- **Test anti-fuite (`no-secret-leak.test.ts`).** Il ne vérifie pas qu’un mécanisme s’exécute : il vérifie qu’une chaîne précise n’apparaît **nulle part** dans ce que l’API produit. Il est donc indifférent à la manière dont la fuite arriverait — un `...doc` glissé dans un contrôleur, un champ ajouté au schéma, un message d’erreur Zod recopiant la valeur reçue, une trace de pile sérialisée, un `lastTest.detail` dans lequel le fournisseur renvoie la clé. Sont balayés : les cinq routes d’intégration en succès **pour les cinq fournisseurs**, leurs corps d’**erreur** (fournisseur inconnu, champ hors liste blanche, corps invalide, test en échec), `POST /admin/reauth` dont le corps porte un mot de passe, le document Mongoose lui-même, et les entrées d’audit. Trois gardes anti-vacuité l’empêchent de passer au vert pour la mauvaise raison : le détecteur est éprouvé sur une charge délibérément fuyante, le nombre de charges inspectées est asserté, et la présence de `last4` prouve que les réponses ne sont pas vides.
- **Liste blanche par fournisseur, disjointe par construction.** `providers.ts` déclare pour chacun ce qui est secret et ce qui ne l’est pas ; toute clé hors liste est refusée en `400`. La frontière est déclarée une fois plutôt que devinée à chaque écriture, parce qu’elle n’est pas intuitive : `s3.accessKey`, `stripe.publishableKey` et `smtp.user` sont des identifiants publiables, `paypal.clientId` ressemble à un secret sans en être un, `paypal.clientSecret` en est un. Un test vérifie que `configFields[]` ne désigne jamais un secret — un champ **mal classé** ferait rendre le secret par l’interface dans un champ texte, sans qu’aucune valeur ne se soit « échappée ».
- **Clé Stripe restreinte, pas secrète** (ADR-0013 §7). Le champ s’appelle `restrictedKey` : on ne peut pas y ranger une `sk_…` sans remarquer qu’on la place dans un emplacement nommé « clé restreinte ». Une clé restreinte fuitée est un incident de confidentialité ; une clé secrète complète fuitée est un détournement de trésorerie.
- **Ré-authentification de dix minutes** avant toute écriture d’intégration (`401 REAUTH_REQUIRED`). Une session ouverte dure des jours, remplacer une clé prend une seconde : cette fenêtre rend le vol de session insuffisant. Quota dédié de dix écritures par heure et par utilisateur.
- **Test de connexion avant enregistrement.** En échec, **rien n’est écrit** (`422`). La dérogation `?force=true` existe pour les serveurs sans accès sortant, elle est journalisée avec l’identité de son auteur, et l’intégration reste marquée « dernier test en échec » jusqu’à un test concluant.
- **Journal d’audit sans la valeur** (ADR-0013 §6). Un remplacement de secret trace l’auteur, la date, le fournisseur, le nom du champ et les quatre derniers caractères **avant et après** — les deux suffixes répondent à la seule question qui compte en investigation, « quelle clé a été remplacée par quelle autre ? ». Jamais la valeur : le journal est précisément l’endroit où un secret en clair survivrait le plus longtemps, recopié dans les sauvegardes et les exports.
- **Journal de portée plateforme, séparé de celui des organisations.** Les fusionner donnerait à un opérateur une vue sur l’activité interne des clients — l’accès qu’ADR-0012 §4 refuse.
- **Trois actes interdits à tous les rôles plateforme** : `plan.approve`, `period.close`, `report.export`. `routes-coverage.test.ts` échoue si une route `/admin` venait à les déclarer, et vérifie aussi qu’aucune route `/admin` n’est dépourvue de rôle exigé.
- **Source effective affichée** (garde-fou n°1 de l’option C, ADR-0013). L’interface dit d’où vient la valeur réellement utilisée — coffre ou variable d’environnement. Sans cela, une variable oubliée masquerait silencieusement une clé pourtant rotée en base, et la rotation serait crue faite alors qu’elle ne l’est pas.

### Limites connues, à ne pas confondre avec « fait »

- **`SECRETS_MASTER_KEY` vit dans l’environnement du serveur.** Le chiffrement protège la base — sauvegardes, instantanés, accès en lecture au stockage — il ne protège pas d’un accès au processus ou à ses variables d’environnement. Un HSM ou un service de gestion de clés dédié reste à faire.
- **La rotation de la clé maîtresse est outillée** (re-chiffrement, `secret.rewrapped` au journal) **mais n’est pas automatisée** ni planifiée.
- ~~**La désactivation d’un compte révoque ses sessions sans verrouiller la reconnexion.**~~ Levée par ADR-0053, lot P2 (voir plus bas).
- **`OPENAI_API_KEY` et `S3_SECRET_KEY` restent lues en secours.** C’est un chemin de migration borné (ADR-0013 §8), à retirer au sprint de sortie — pas un mode de fonctionnement.

## Implémenté (S22a) — envoi d’emails, connexion Google, mot de passe oublié

Détail complet et arbitrages : **ADR-0014**. Points de sécurité :

- **Mot de passe oublié**, flux inexistant jusqu’ici : un compte dont le mot de passe était perdu était un compte perdu. Délégué à better-auth (qui possède la politique de hachage de la collection `account`), avec jeton à **usage unique**, expiration **30 minutes**, et **révocation de toutes les sessions** à la réinitialisation — une réinitialisation signifie souvent « quelqu’un d’autre avait accès ».
- **Aucune énumération d’adresses** sur la demande de réinitialisation : code de réponse et corps strictement identiques pour une adresse connue et une adresse inconnue, temps de réponse compris (better-auth simule la génération du jeton et la lecture en base). L’interface ne « rattrape » pas cette uniformité en distinguant les cas. Vérifié par test e2e comparant les deux réponses.
- **Connexion Google** : liaison de comptes acceptée **uniquement** si Google atteste lui-même `email_verified` (`trustedProviders` volontairement vide). `prompt: 'select_account'` forcé, pour qu’un poste partagé ne reconnecte pas silencieusement la session Google du collègue.
- **Risque accepté et sa parade** : `requireLocalEmailVerified: false` ouvre le scénario de pré-enregistrement. Voir ADR-0014 § Risque accepté — la parade est `AUTH_REQUIRE_EMAIL_VERIFICATION=true` en production.
- **Journalisation** : le repli sans SMTP journalise le destinataire et le sujet, **jamais le corps** — il contient le lien porteur du jeton. Le `console.log` du jeton d’invitation qui existait depuis S5d est supprimé.
- **Contenu des emails** : aucune ressource distante (pas d’image, donc pas de pixel de suivi révélant l’IP et l’heure d’ouverture), destination du bouton écrite en clair sous celui-ci, données utilisateur échappées. Vérifié par tests.

### Restant sur ce périmètre

- MFA et OTP SMS (ADR-0006 : le fournisseur SMS reste à choisir) ;
- signature DKIM/SPF/DMARC du domaine expéditeur — hors code, à faire côté DNS lors de la mise en service, sans quoi les messages partiront en indésirables ;
- file d’attente d’envoi : un email est aujourd’hui envoyé dans la requête HTTP qui le déclenche. Acceptable à trois messages transactionnels, à revoir dès qu’un envoi groupé existera ;
- identifiants SMTP par organisation, depuis le coffre d’`integrations/` (ADR-0013) : la prise existe (`MailCredentialsProvider`), l’implémentation viendra avec le module ;
- **aucune reprise sur échec d’envoi** : un envoi raté est journalisé, pas réessayé — un incident SMTP de quelques minutes perd les messages émis pendant sa durée. L’utilisateur peut redemander un lien, et une invitation reste récupérable par son lien copiable ;
- **aucun quota propre aux envois** : `/auth/*` s’appuie sur la limitation de tentatives de better-auth, mais rien ne borne spécifiquement le nombre d’emails qu’une même adresse peut faire déclencher ;
- **notification à l’ancienne adresse lors d’un changement d’email** (§ Restant sur le périmètre S20b) : le mécanisme d’envoi existe désormais, le message reste à écrire et à brancher.

## Implémenté (S22f) — chaîne de confiance du reverse proxy

Correctif du finding **F-03** de docs/29-AUDIT-SECURITE-S22e.md. Le sujet n'est pas un réglage : c'est la réponse à la question « quelle valeur, dans une requête HTTP, l'API a-t-elle le droit d'appeler *l'identité du client* ? ». Toute limite par client repose dessus.

### Le problème

Derrière Caddy, l'API ne voit qu'une seule adresse TCP : celle du conteneur du proxy. `req.ip` valait donc la même chose pour tout le monde et le seau de 100 req/min était **un compteur global** : 100 requêtes d'un attaquant renvoyaient `429` à tous les utilisateurs légitimes. Le rate limiting nominalement « par IP » était en réalité une porte de déni de service.

### La chaîne, rang par rang

```
client ─── Internet ───▶ caddy:443 ───▶ api:3001
```

| Rang | Qui écrit | Peut-on le croire ? |
| --- | --- | --- |
| 0 | Le **client** peut envoyer n'importe quel `X-Forwarded-For` | Non — donnée hostile, jamais une identité |
| 1 | **Caddy** (`reverse_proxy`) *append* l'adresse du pair TCP qu'il observe réellement | Oui — c'est notre propre proxy, et cette valeur est toujours la dernière de la chaîne |
| — | Aucun autre proxy : le réseau `edge` de `docker-compose.prod.yml` ne publie que les ports de Caddy, le conteneur `api` n'est joignable que par lui | — |

D'où **`app.set('trust proxy', 1)`** (`apps/api/src/main.ts`, valeur et justification dans `apps/api/src/security/trusted-proxy.ts`). Express tronque la chaîne au premier maillon non fiable et retient l'adresse posée par Caddy — l'IP cliente réelle. Le préfixe forgé par le client est ignoré.

**Pourquoi un nombre et pas `true`.** `trust proxy: true` fait confiance à la chaîne entière, y compris à la partie écrite par le client : Express retiendrait l'adresse la plus à gauche, celle que l'attaquant contrôle, et il lui suffirait d'en changer à chaque requête pour obtenir un seau vierge. La limite ne serait pas réparée, elle serait supprimée. Un rang de confiance est une affirmation sur la topologie du déploiement : elle doit être écrite, datée et vérifiable.

**Ce qui change si la topologie change.** Un CDN ou un load balancer ajouté devant Caddy ajoute un rang : sans mise à jour du nombre, l'IP retenue redevient celle de l'infrastructure et le seau redevient partagé. Le nombre est donc une constante nommée, commentée, et non un littéral perdu dans `main.ts`.

### Ce qui n'a pas changé

Le quota de `POST /ai/corrective-actions` (10 req/min, endpoint facturé OpenAI, ADR-0008) reste indexé **par utilisateur** et non par IP : deux comptes derrière une même IP publique ne se pénalisent pas, et un même compte ne regagne rien en changeant de réseau. Les clés des deux seaux sont préfixées (`ip:` / `user:`) pour ne jamais collisionner dans le stockage.

### Vérification

`apps/api/src/security/trusted-proxy.test.ts` monte de vraies applications Nest et leur envoie de vraies requêtes : seaux indépendants par IP cliente, `X-Forwarded-For` forgé sans effet, quota par utilisateur préservé. Un bloc témoin monte la même application **sans** le correctif et reproduit le finding — sans lui, une suite verte ne dirait pas si elle teste le correctif ou le hasard.

### Restant

Compteurs en mémoire de process (déjà noté § Restant S16a) : dès deux instances d'API, chaque instance a son propre seau. Prérequis à lever avant la mise à l'échelle horizontale — backend Redis partagé (`@nest-lab/throttler-storage-redis`).

## Implémenté (ADR-0029) — modèles de facture sur mesure : contenu non fiable

Un paquet de modèle téléversé par une organisation est traité comme **contenu hostile**
(`apps/api/src/sales/documents/templates/custom/`, lecteur ZIP et politique CSS dans `apps/api/src/security/`) :

- **Archive** : lecteur ZIP propre, sans dépendance ; plafonds avant décompression (taille
  annoncée, 40 entrées, 8 Mio) et pendant (`maxOutputLength`), taux de compression ≤ 200, CRC
  vérifié ; ZIP64, multi-volumes, chiffrement, liens symboliques, chemins absolus ou `..`
  refusés ; liste fermée de fichiers et de types (aucun SVG, aucun script).
- **Gabarit** : sous-ensemble de Mustache **interprété** (aucune génération de code, aucune
  propriété héritée lue, HTML brut et partiels interdits), chaque variable vérifiée contre le
  contrat typé ; HTML en liste blanche (ni `script`, ni `style`, ni attribut `on*`/`style`, ni
  `iframe`/`svg`), sortie **re-validée à chaque rendu** ; texte réservé à la zone DGI refusé.
- **CSS** : liste blanche de propriétés (rien qui positionne, empile, transforme, rogne ou rend
  transparent), aucune at-règle, aucun `url()` hors images du paquet intégrées en `data:`,
  confinement par préfixe `.lx-modele:scope` **et** `@scope` (chacune des deux barrières prouvée
  seule dans Chromium réel).
- **Zone DGI** posée par le moteur hors du conteneur du modèle, en-tête et pied Chromium hors
  d'atteinte ; vérification de toutes les mentions à chaque rendu (ADR-0028).
- **Rendu** : même confinement S22e (JavaScript coupé, réseau avorté, CSP `default-src 'none'`).
- **Stockage** : clé tirée au hasard, enregistrement immuable, isolation par organisation (cache
  compris), empreinte canonique recalculée à chaque réimpression.
- **Risque résiduel documenté** : la lisibilité (couleur du texte égale au fond) n'est pas
  prouvable statiquement ; l'aperçu est exigé avant activation.

## Implémenté (ADR-0044, lot P2) — coordonnées de paiement des fournisseurs

Les coordonnées bancaires et mobile money des fournisseurs (`suppliers.paymentMethods`) sont un actif sensible nouveau : celui qui les modifie détourne les paiements. Code : `apps/api/src/purchases/suppliers/`. Décision : ADR-0044 § 2.1.1.

### Fait

- **Chiffrées au repos, sans schéma nouveau.** `secrets-crypto.ts` (ADR-0013) est réutilisé tel quel : AES-256-GCM sous le trousseau `MASTER_KEYRING`, sel et `iv` neufs à chaque écriture, emplacement `org:supplier_payment_method` dont la dérivation HKDF et l'AAD portent **organisation, fiche et moyen** : un chiffré recopié vers une autre fiche, une autre organisation ou un autre moyen ne se déchiffre pas (test unitaire et e2e). Sans trousseau, l'écriture est refusée (`503 SECRETS_NOT_CONFIGURED`), jamais stockée en clair.
- **Masquées partout.** Listes, fiches, réponses d'écriture, journal d'audit et notifications ne portent que `masked` (`Rawbank •••• 4521`, `M-Pesa •••• 78`) et une empreinte. `toJSON` et `toObject` du schéma remplacent chaque chiffré par `[redacted]`. L'e2e vérifie que ni le numéro ni l'IBAN n'apparaissent dans les réponses, dans le document Mongo, dans `audit_events` ni dans les notifications.
- **Empreinte** : HMAC-SHA256 tronqué à 16 caractères, clé dérivée de la clé maîtresse courante, message préfixé par l'organisation (aucune corrélation entre clients ; un numéro de téléphone, peu entropique, ne se retrouve pas par force brute sans la clé). Deux fiches qui partagent un compte lèvent `SUPPLIER_PAYMENT_DETAILS_SHARED`.
- **Lecture en clair = `reveal`**, réservée à `payables.pay` (Propriétaire, Directeur financier, Comptable), **30 par heure et par utilisateur**, journalisée **strictement** (`supplier.payment_details_revealed`, écrit avant la réponse : sans trace, rien n'est révélé ; ni clair ni masque au journal).
- **Changement** (ajout, modification, retrait) : audit strict dans la même transaction (`supplier.payment_details_changed`, avant et après **masqués**), notification `purchases.supplier_payment_details_changed` aux détenteurs **effectifs** de `payables.pay` et `purchase.approve` (sauf l'auteur), bandeau sur la fiche pendant `paymentDetailsAlertDays` (7 jours par défaut). Personne n'est bloqué (décision ouverte n° 9).
- **Rotation** comprise dans `secrets:rewrap` (`integrations/rewrap.ts`) : chiffré et empreinte recalculés sous la clé courante, `secret.rewrapped` au journal plateforme, `remainingKeyIds` couvre les fiches.

### Limites

- Mêmes limites que le coffre (ADR-0013) : la clé maîtresse vit dans l'environnement du serveur.
- Pendant une rotation inachevée, les empreintes calculées sous l'ancienne et la nouvelle clé ne se comparent pas : l'avertissement de compte partagé peut manquer jusqu'au `secrets:rewrap`.
- Aucune confirmation par une seconde personne avant de payer vers des coordonnées modifiées : alerte seulement (décision ouverte n° 9).

## Implémenté (ADR-0045, lot H2) — données sensibles du personnel

Salaire de base déclaré, coordonnées bancaires et mobile money, pièces d'identité, coordonnées personnelles et motif détaillé de sortie (`hr_employee_private`) : un actif sensible nouveau, dont le détournement du salaire est la fraude classique. Code : `apps/api/src/hr/private/`. Décision : ADR-0045 § 2.4.

### Fait

- **Collection à part.** Les fiches (`hr_employees`) ne portent aucune donnée sensible ; listes, fiches, « moi », équipe et organigramme ne lisent jamais `hr_employee_private`, seulement ses formes masquées, et seulement pour un détenteur de `hr.sensitive.read` ou pour le salarié lui-même.
- **Chiffrées au repos, sans schéma nouveau.** Motif exact des fournisseurs : `secrets-crypto.ts` réutilisé, emplacement `org:hr_employee_private`, dérivation HKDF et AAD portant **organisation, collaborateur et section** (cinq champs : `compensation`, `bankDetails`, `identity`, `personalContact`, `exitNote`) ; un chiffré recopié vers une autre fiche ne se déchiffre pas (`500 HR_PRIVATE_UNREADABLE`, testé). Sans trousseau : `503 SECRETS_NOT_CONFIGURED`. `toJSON`/`toObject` remplacent les chiffrés par `[redacted]`. La nature et l'expiration des pièces d'identité sont recopiées **en clair, sans numéro** (`idExpiries`) pour les rappels.
- **Masques** : « salaire renseigné depuis le … » (ni montant ni devise), `Rawbank •••• 4521` et empreinte HMAC (celle des fournisseurs, préfixée par l'organisation), type et expiration des pièces, nombre de contacts d'urgence.
- **Écriture** : `hr.sensitive.read` **et** `hr.manage` ; audit strict `hr.private.changed` dans la même transaction (avant et après masqués) ; un changement bancaire notifie le salarié relié et les détenteurs **effectifs** de `hr.sensitive.read` sauf l'auteur (`hr.bank_details_changed`, sans numéro) et pose un bandeau de sept jours.
- **Lecture en clair (`reveal`)** : `hr.sensitive.read`, ou le salarié pour ses propres données ; un lecteur qui voit la fiche sans ce droit reçoit `403`, hors portée `404`. Audit **strict** `hr.private.revealed` (sections, jamais de valeur) écrit **avant** tout déchiffrement : journal indisponible ⇒ `503 HR_AUDIT_UNAVAILABLE`, rien n'est révélé. **30 par heure et par utilisateur**, comptés sur le journal lui-même (commun à toutes les instances) : `429 HR_REVEAL_RATE_LIMITED`.
- **Plateforme** : `hr.sensitive.read` est dans `PLATFORM_FORBIDDEN_ACTIONS` (interdit même sous accès délégué).
- **Anonymisation** d'un collaborateur sorti : dossier sensible effacé, noms remplacés, lien au compte délié ; audit strict.
- **Rotation** comprise dans `secrets:rewrap` : chiffrés et empreintes bancaires recalculés, `remainingKeyIds` couvre la collection.
- **Tests anti-fuite** (`hr-private.e2e.test.ts`) : ni IBAN, ni numéro de compte, ni numéro de passeport, ni salaire, ni date de naissance dans le document Mongo, les listes, la fiche, « moi », l'équipe, l'organigramme, `audit_events` et les notifications.

### Limites

- Mêmes limites que le coffre (ADR-0013) et que les coordonnées des fournisseurs.
- Le débit de `reveal` compte les traces de l'heure écoulée : deux appels strictement simultanés au seuil peuvent en laisser passer un de plus.
- Les documents sensibles (pièces scannées, certificats) relèvent du lot H4 ; le brief (H5) ne reçoit que des nombres.

## Implémenté (ADR-0051, lot H15) — objectifs individuels et évaluations

Entretiens d'évaluation (`hr_reviews`) : auto-évaluation, appréciation et notes de l'évaluateur, commentaire du collaborateur, note RH — **parmi les données les plus sensibles du dossier**. Objectifs individuels (`hr_goals`) et campagnes (`hr_review_cycles`). Code : `apps/api/src/hr/performance/`. Décision : ADR-0051 § 2.5 à § 2.7, § 3.5, § 4.

### Fait

- **Éteint par défaut** (`hr_settings.performance.enabled = false`) : toute route rend `409 HR_FEATURE_DISABLED` tant que l'organisation ne l'active pas (`PUT /hr/settings/performance`, `hr.manage`). Manager direct seul (`managerChainDepth = 1`), aucune purge (`retention.reviewsYearsAfterExit = null`).
- **Action dédiée `performance.read`** (Propriétaire, Responsable RH), distincte de `hr.sensitive.read` : le Directeur financier et l'Administrateur ne lisent ni objectifs ni évaluations (`404`, testé) ; `hr.read` seul non plus. Interdit absolu de la plateforme (`PLATFORM_FORBIDDEN_ACTIONS`). Autres lecteurs **par relation** : le collaborateur, l'évaluateur, la chaîne de managers jusqu'à `managerChainDepth`.
- **Chiffrées au repos, sans schéma nouveau.** Quatre sections (`selfAssessment`, `managerAssessment`, `employeeComment`, `hrNote`) chiffrées par `secrets-crypto.ts`, emplacement `org:hr_reviews`, dérivation HKDF et AAD portant **organisation, évaluation et section** ; un chiffré recopié ne se déchiffre pas (testé). Les notes choisies (`ratings`, `overall`) sont **dans** l'appréciation chiffrée. `toJSON`/`toObject` remplacent les chiffrés par `[redacted]`. Sans trousseau : `503 SECRETS_NOT_CONFIGURED`.
- **Listes : statuts seulement** (`GET /hr/reviews`). Le contenu ne sort que par `POST /hr/reviews/:id/reveal` : section par section selon le lecteur et l'étape (l'évalué lit l'appréciation après le partage ; `hrNote` : `performance.read` seul — `403 REVIEW_SECTION_NOT_YOURS`) ; audit **strict** `hr.review.revealed` (sections, jamais de valeur) écrit **avant** le déchiffrement (journal indisponible ⇒ `503 HR_AUDIT_UNAVAILABLE`) ; **30 par heure et par utilisateur** (`429 HR_REVEAL_RATE_LIMITED`).
- **Écriture** d'une section par son seul auteur, à son étape, avec audit strict `hr.review.changed` (section, jamais la valeur) dans la même transaction ; `expectedRevision` partout.
- **Aucune note calculée** : une note est choisie par l'évaluateur dans l'échelle saisie par l'organisation (`checkRating`), `overall` facultatif et choisi ; le moteur ne compte que des statuts (`reviewProgress`). Aucune IA, aucun effet automatique.
- **Clôture** : garde `hr.manage` + `performance.read`, puis `reviewCloseDecision` (ni l'évalué ni l'évaluateur, sauf détenteur unique marqué) ; une évaluation partagée non signée est close avec la mention « non signée » (`closedUnsigned`), jamais un consentement présumé. La prise de connaissance ne change que le statut et la signature (testé).
- **Notifications** (`hr.review_step`, `hr.goal_proposed`, `hr.goal_agreed`) : l'étape, jamais un extrait, une note ni un objectif.
- **Anonymisation** d'un collaborateur (`HrEmployeesService.anonymize`) : ses quatre sections et l'instantané de ses objectifs sont effacés dans la même transaction ; le squelette (campagne, statut, évaluateur) reste.
- **Rotation** comprise dans `secrets:rewrap` (`rewrapHrReviews`) : chaque section re-chiffrée sous la clé courante, écriture conditionnée par l'ancien `iv`, révision inchangée, une trace `secret.rewrapped` par section ; `remainingKeyIds` couvre `hr_reviews`. Testé : après k1 → k2, tout se relit avec la seule k2.
- **Tests anti-fuite** (`hr-performance.e2e.test.ts`) : aucune appréciation, auto-évaluation, commentaire ni note RH dans le document Mongo, les listes, `audit_events` et les notifications.

### Limites

- Mêmes limites que les données sensibles du personnel (débit de `reveal` compté sur l'heure écoulée).
- Les objectifs (`hr_goals`) ne sont **pas** chiffrés : ils sont protégés par la portée (soi, chaîne, `performance.read`), pas par le chiffrement ; ADR-0051 ne chiffre que les évaluations.
- Un acteur plateforme sans appartenance reçoit `404` (son organisation active est la sienne) ; il n'existe pas d'accès délégué aux routes d'organisation qui permettrait d'observer le `403` du critère 2.

## Implémenté (ADR-0046, lot S6) — bibliothèque de documents

Statuts, attestations, licences, polices, contrats (`document_folders`, `library_documents`, `library_document_versions`) : des pièces d'entreprise dont certaines sont sensibles. Code : `apps/api/src/documents/`. Décision : ADR-0046 § 4, § 5.3.

### Fait

- **Droits par dossier, jugés sur les droits effectifs et les personnes** (`folderAccessDecision`, `documentReadDecision`, lot S0) : la lecture exige chaque niveau de la chaîne (un sous-dossier n'élargit jamais, quel que soit `inherit`) ; `inherit` ne gouverne que l'écriture. Un dossier restreint par personnes est invisible, nom compris, d'un gestionnaire (`docs.manage`) qui n'y figure pas. Lire un document exige aussi la lecture du module de chaque entité liée. Invisible ⇒ `404`, et non compté par la recherche (filtrage **avant** pagination). Le Conseiller n'a pas `docs.read`.
- **Fichiers** : motif d'ADR-0039 § 2.5 (PDF reconnus par `%PDF-`, non analysés, images assainies ; tout autre type `415 DOCUMENT_TYPE`), téléchargement **inerte** (`attachment`, `nosniff`, CSP `sandbox`, `no-store`) ; borne **commune** de 1 Gio (`storage/attachments-usage.ts`, partagée avec les RH).
- **Chiffrement par enveloppe** des documents sensibles : code commun avec les documents RH (`integrations/envelope-blob-crypto.ts`), format `LLD1`, AAD = organisation + document + version, clé enveloppée à `org:library_documents` ; un objet recopié ne se déchiffre pas (`500 DOCUMENT_UNREADABLE`, testé) ; sans trousseau `503 SECRETS_NOT_CONFIGURED`. Dépôt et gestion d'un sensible : `docs.manage`.
- **Journal** : tout téléchargement est tracé ; celui d'un sensible est **strict** et écrit avant de servir (`documents.sensitive_downloaded` ; journal indisponible ⇒ `503`). Aucun titre, étiquette ni nom de fichier dans l'audit, les journaux ou les notifications (`documents.expiring` : une nature et une date).
- **Métadonnées jamais dans l'URL ni dans un en-tête** : envoi `multipart/form-data`, recherche en corps de `POST /documents/search`, requêtes `GET` limitées aux identifiants (un `?title=` est refusé) ; un test e2e observe `req.url` et les en-têtes bruts.
- **Plateforme** : un acteur plateforme sans appartenance reçoit `404` (testé sur le fichier sensible).
- **Rotation** comprise dans `secrets:rewrap` : seule la clé enveloppée de chaque version change, l'objet n'est pas réécrit ; `remainingKeyIds` couvre `library_document_versions`.
- **Suppression** logique, puis `documents.purge` après 30 jours : clés effacées (objet illisible à jamais) et objets supprimés. Aucune durée de conservation (décision ouverte n° 16).

### Limites

- Les pièces des projets et des achats calculent encore leur borne sans compter la bibliothèque (leurs fichiers ne sont pas touchés par R5) : la borne est stricte au dépôt d'un document de bibliothèque ou d'une pièce RH, approximative ailleurs.
- La recherche lit au plus 5 000 documents avant filtrage par les droits.

## Implémenté (ADR-0048) — formulaire public de prospects : surface publique nouvelle

Deux routes de l'API **sans session** (`GET /public/lead-forms/:token`,
`POST /public/lead-forms/:token/submissions`) et une page web publique (`/f/<jeton>`). Code :
`apps/api/src/crm/lead-forms/`, `apps/web/src/app/f/`. Décision :
[ADR-0048](adr/ADR-0048-formulaire-public-de-prospects.md).

### Fait

- **Désactivé par défaut**, par organisation ; activé par un détenteur de `crm.manage` seulement
  avec une politique de confidentialité `https://` et un responsable éligible.
- **Jeton** : 24 octets aléatoires (192 bits), index unique, **remplaçable** ; jeton inconnu,
  formulaire désactivé ou remplacé rendent le **même** `404`. La configuration publique ne rend que
  ce qui s'affiche : ni nom d'organisation, ni identifiant interne, ni responsable (testé).
- **Anti-abus sans CAPTCHA tiers** : champ piège (réponse identique à un succès, rien créé) ;
  ticket HMAC (clé dérivée d'`AUTH_SECRET`, étiquette propre) imposant 3 s minimum et 2 h maximum ;
  débit **5 envois par 10 minutes par IP** et **60 par heure par formulaire**, comptés avant toute
  lecture de la base ; corps `.strict()`, champs bornés, JSON seulement (aucune pièce jointe).
- **Aucune IP en clair** : la clé du seau de débit, la preuve de consentement et l'audit portent
  une **empreinte** HMAC (étiquette `lalanda/lead-form-ip`) ; la ligne d'accès automatique de
  pino-http (qui contient l'adresse distante) est **coupée** pour `/public/lead-forms/*` ; les refus
  sont journalisés avec l'empreinte et l'identifiant du formulaire seulement. Testé : ni la base ni
  `audit_events` ne contiennent l'adresse, ni les clés du stockage de débit.
- **Isolation** : la soumission écrit dans l'organisation du jeton seulement ; le dédoublonnage
  par e-mail ne lit que cette organisation ; un visiteur ne réécrit **jamais** une fiche existante.
- **Web** : page hors de l'application, `noindex`, appels API `credentials: 'omit'` ; CSP et
  `frame-ancestors 'none'` **inchangés** (l'extrait à copier est un lien, pas un cadre) ; le logo
  passe par l'URL signée existante (ADR-0028).

### Limites

- Débit en mémoire du processus (une instance d'API), comme les autres gardes.
- L'empreinte d'IP est stable tant qu'`AUTH_SECRET` ne change pas (décision ouverte n° 5).
- Deux soumissions simultanées au même e-mail inconnu peuvent créer deux contacts (fusion manuelle
  dans le CRM).
- Les robots qui exécutent JavaScript et attendent 3 s passent le délai minimal ; la limite de
  débit borne alors leur volume.

## ADR-0053 — console Lalanda : socle P0 (appliqué)

- **Console sans organisation** : `PlatformAuthGuard` remplace `AuthGuard` sur `/admin/**`,
  `/me/platform-access` et `/accounting/platform/**`. Il ne résout aucune organisation et refuse
  toute route non marquée `@PlatformConsoleRoute()` ou déclarant une action d'organisation : une
  route d'organisation ne devient jamais accessible sans organisation. Prouvé sur la table entière
  (`routes-coverage.test.ts`) et de bout en bout dans les deux sens
  (`admin-platform-isolation.e2e.test.ts` : 12 rôles d'organisation × toute la console → `403` ;
  6 rôles plateforme sans appartenance × toute route d'organisation → `403 NO_ORGANIZATION` ou
  `404 ORG_NOT_FOUND`).
- **Blocage, volet console seulement** : un compte dont `disabledAt` est posé n'ouvre plus la
  console (`403 ACCOUNT_BLOCKED`). **Limite maintenue** : l'espace organisation (`AuthGuard`) et
  l'ouverture de session ne lisent pas encore `disabledAt` (lot P2, F5).
- **Restent ouverts** (lots P2, P8) : ré-authentification de toute écriture de la console, session
  de console de 12 heures, double authentification (décision ouverte n° 2). *Levés depuis : P2
  ci-dessous ; P8 en fin de section.*

## ADR-0053 — console Lalanda : lot P2 (appliqué)

- **Blocage effectif (F5)** : `AuthGuard`, `PlatformAuthGuard` et le crochet better-auth
  `session.create.before` lisent `user.disabledAt` ; un compte bloqué n'utilise plus aucune
  session et n'en ouvre plus (`403 ACCOUNT_BLOCKED`, message générique). Seul un `disabledAt` non
  nul refuse. Bloquer et débloquer exigent une note interne (catégorie pour bloquer).
- **Suspension effective** : `PermissionsGuard` lit la suspension active de l'organisation VISÉE ;
  `read_only` (défaut) : écritures `423 ORGANIZATION_SUSPENDED`, lectures ouvertes ; `full` : toute
  route d'organisation `423`. Les sessions des membres ne sont plus révoquées : leurs autres
  organisations restent intactes.
- **Ré-authentification** de dix minutes sur toute écriture de la console (`@RequireRecentReauth`),
  ouverte à tout opérateur par `POST /admin/reauth`. **Session de console de 12 heures**
  d'inactivité par session (`platform_console_activity`, empreinte du cookie) :
  `401 CONSOLE_SESSION_EXPIRED`, rouverte par une ré-authentification.
- **Minimisation (F8)** : `GET /admin/users` exige `q` de trois caractères (`400 SEARCH_REQUIRED`) ;
  fiches détaillées sous motif, lecture journalisée (`platform.organization.viewed`,
  `platform.user.viewed`).
- **Conflit d'intérêts (F9)** : suspension, levée et changement d'offre refusés à un opérateur
  membre de l'organisation cible (`409 PLATFORM_SELF_DEALING`), sauf seul détenteur, marqué.
- **Miroir (F3/F4, volet P2)** : suspension, levée, changement d'offre, blocage d'un membre
  paraissent au journal du client sous `platform:lalanda` (« Équipe Lalanda »), sans identifiant,
  rôle ni note interne de l'opérateur.
- Tests : `admin-accounts.e2e.test.ts`, blocs P2 de `routes-coverage.test.ts` et
  `rbac-matrix.e2e.test.ts`.

## ADR-0053 — console Lalanda : lot P3 (appliqué)

- **Fuite F3 fermée** : confirmer un dépôt manuel n'écrit plus l'identifiant de l'opérateur ni un
  rôle codé en dur dans le journal du client. La transition d'abonnement porte le pseudonyme
  `platform:lalanda` et la source `admin:manual` (sans identifiant) ; le journal plateforme reçoit
  l'acteur réel et ses rôles RELUS. Le refus est désormais journalisé, des deux côtés.
- **Routes plateforme sous la garde de console** : `/payments/manual/*` et
  `/payments/maintenance/sweep` répondent `410 ROUTE_GONE` à tous ; leurs remplaçantes vivent sous
  `/admin/billing/**`. La liste N-1 de `routes-coverage.test.ts` est vide.
- **Matrice appliquée** : `platform_admin` ne confirme plus un dépôt (finance et
  super-administrateur seuls) ; conflit d'intérêts sur confirmation, refus, octroi, approbation et
  retrait.
- **Octrois** à deux personnes (offre Expert, sans échéance, plus de 90 jours) : le palliatif
  `SECOND_PERSON_REQUIRED` de P2 est levé. Un octroi ne simule aucun paiement (`plan.granted`,
  jamais `payment.succeeded`).
- Tests : `admin-billing.e2e.test.ts`, `subscriptions.e2e.test.ts` (nouveaux chemins), blocs P3
  de `routes-coverage.test.ts` et `rbac-matrix.e2e.test.ts`.

## ADR-0053 — console Lalanda : lot P7 (appliqué)

- **Statistiques agrégées seulement** (`/admin/stats`) : aucun nom, identifiant ni montant d'une
  organisation dans la réponse ; seuil de diffusion de 5 sur toute case, avec masquage secondaire
  dans les répartitions (une case masquée ne se déduit pas du total). L'adoption des modules ne lit
  que la clé de locataire (`distinct('organizationId')`), aucun champ de contenu.
- **Finances du site** (`/admin/finance`) : super-administrateur et finance seuls ; calcul dans le
  moteur (`platform-revenue`), « encaissements constatés » et « revenu récurrent déclaré », jamais
  « chiffre d'affaires » (ADR-0047 non tranché). Export CSV journalisé (`platform.finance.exported`).
- Tests : `admin-stats.e2e.test.ts`, `platform-revenue.test.ts`, `stats.test.ts`, blocs P7 de
  `routes-coverage.test.ts` et `rbac-matrix.e2e.test.ts`.

## Menaces prioritaires

- accès inter-organisation;
- prise de compte;
- élévation de privilèges;
- export non autorisé;
- injection par fichier importé;
- falsification de webhook;
- fuite via IA ou journaux;
- altération de calcul ou Country Pack;
- perte de données.

## Contrôles

### Identité

Mots de passe gérés par fournisseur fiable, vérification d’adresse, MFA pour rôles sensibles, sessions révocables, limitation des tentatives et notification d’événements critiques.

### Autorisation

Refus par défaut, contrôle par ressource et action, tests de matrice, séparation plateforme/organisation, accès support temporaire.

### Données

TLS, chiffrement au repos, secrets gérés hors code, pièces analysées, URLs signées courtes, minimisation des données et masquage des journaux.

### Application

Validation des entrées, protection CSRF selon architecture, politiques CSP, prévention injections, dépendances surveillées, limitation de débit et quotas.

### Finance

Plans validés immuables, empreintes, audit, séparation création/approbation, version des règles et réconciliation.

### IA

Contexte minimal, séparation locataire, défense contre injection indirecte, nombres vérifiés, conservation configurable et aucun entraînement externe sans accord explicite.

## Sauvegarde et reprise

- objectifs RPO/RTO à définir par environnement;
- sauvegardes chiffrées;
- copies isolées;
- restauration testée périodiquement;
- procédure d’incident;
- état des dépendances externes;
- mode dégradé pour exports/calculs asynchrones.

## Confidentialité

Le registre de traitement documente finalités, base, catégories, destinataires, durée et droits. La politique doit tenir compte des pays servis et des fournisseurs choisis.

## Journalisation

Les événements de sécurité sont centralisés et alertés. Aucun token, secret, classeur complet ou prompt contenant des données inutiles ne doit apparaître dans les logs.

## Mise en production

Revue de menace, scan des dépendances, tests d’autorisation, secrets vérifiés, sauvegarde restaurée, procédure d’incident et responsables d’astreinte définis.

## ADR-0053 — console Lalanda : lot P8, double authentification (appliqué)

Décision n° 2 retenue par la dirigeante le 3 nov. 2026 ; détail : ADR-0053 § 2.4 bis.

- **TOTP obligatoire pour tout opérateur** (`otpauth` 9.5.2, RFC 6238). Non enrôlé :
  `403 PLATFORM_2FA_REQUIRED` sur toute la console, enrôlement seul ouvert (QR code, code + mot de
  passe). Session non vérifiée : `401 PLATFORM_2FA_VERIFICATION_REQUIRED`, `/admin/reauth` seul ouvert.
- **Ré-authentification de la console** : mot de passe + code, ou code de secours ; la fenêtre de
  `/me/reauth` (mot de passe seul) ne vaut plus pour une écriture de console.
- **Stockage** : secret chiffré sous `SECRETS_MASTER_KEY`, compris dans `secrets:rewrap` ;
  10 codes de secours hachés (SHA-256 salé), à usage unique ; anti-rejeu du pas TOTP.
- **Limitation** : 5 échecs consécutifs → verrouillage 15 minutes (`429 TWO_FACTOR_LOCKED`), plus le
  quota par utilisateur des routes d'enrôlement et de ré-authentification.
- **Journal plateforme** : enrôlement, échec, verrouillage, code de secours utilisé, réinitialisation.
- **Réinitialisation** par un autre super-administrateur, motif obligatoire, jamais sur soi-même.
- **Limite** : les comptes d'organisation n'ont pas de double authentification (non imposée, non
  proposée en v1) ; la ligne « MFA et OTP SMS » du § Restant vaut pour eux.

