# Sécurité, confidentialité et continuité

**Statut :** Draft  
**Version :** 0.3

## Implémenté (S16a)

Durcissement de production livré au sprint S16a :

### Fait

- **Authentification sur `/evaluate`** : `GET /evaluate/templates`, `GET /evaluate/templates/:slug` et `POST /evaluate` exigent une session valide (`AuthGuard`). L'exposition publique « S3-lite » est terminée. Couvert par tests unitaires (métadonnées de guard) et e2e (401 sans session, 200 avec).
- **Rate limiting** (`@nestjs/throttler`, `apps/api/src/security/`) :
  - global : 100 req/min/IP sur toutes les routes NestJS (`ThrottlerGuard` en `APP_GUARD`) ;
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

Coffre et espace d’administration livrés au sprint S21b (`apps/api/src/integrations/`, `apps/api/src/admin/`, `apps/web/src/app/(app)/admin/`). Décision : ADR-0013. Contrat : docs/16 § Espace admin plateforme. Écrans : docs/04 § Implémenté (S21b).

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
- **La désactivation d’un compte révoque ses sessions sans verrouiller la reconnexion.** Le verrou au moment de la connexion reste à livrer ; l’interface l’annonce plutôt que de laisser croire l’accès barré.
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
