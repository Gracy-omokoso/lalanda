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
- identifiants SMTP par organisation, depuis le coffre d’`integrations/` (ADR-0013) : la prise existe (`MailCredentialsProvider`), l’implémentation viendra avec le module.

## Implémenté (S22a) — envoi d'emails, récupération de compte, connexion Google

Livré au sprint S22a (`apps/api/src/mail/`, `apps/api/src/auth/`,
`apps/web/src/app/(auth)/`). Décision et procédure d'obtention des identifiants :
**ADR-0014**.

Ce sprint lève le blocage annoncé plus haut (§ Bloqué par l'absence de SMTP) : le
mécanisme d'envoi existe. Il ne le lève **que si `SMTP_HOST` est renseigné** — voir
§ Ce qui reste conditionné à la configuration.

### Fait

- **Récupération de compte.** Le parcours « mot de passe oublié » existe enfin ; jusqu'ici
  un mot de passe perdu valait un compte perdu, sans support à contacter. Le flux est
  délégué à better-auth plutôt que réécrit : lui seul possède l'algorithme de hachage de la
  collection `account`, et une politique de hachage dupliquée finit par diverger — panne
  qui ne se voit qu'au moment où plus personne ne peut se connecter. Trois propriétés,
  vérifiées par des tests bout en bout et non supposées :
  - **jeton à usage unique** — la valeur est supprimée en étant lue ; rejouer un lien
    échoue. Sans cela, un lien qui traîne dans une boîte email reste une porte d'entrée
    permanente ;
  - **expiration 30 minutes**, et non les 60 par défaut : ce lien vaut une prise de
    contrôle complète du compte pour qui l'intercepte, et une boîte consultée sur un poste
    partagé garde ses messages bien plus longtemps que le temps de cliquer. Redemander un
    lien coûte un clic. Le test vieillit le jeton en base plutôt que d'attendre — il
    vérifie que l'expiration est appliquée, pas que l'horloge avance ;
  - **aucune énumération d'adresses** — `/auth/request-password-reset` renvoie exactement
    le même code et le même corps pour une adresse inconnue, et simule la génération du
    jeton pour ne pas se trahir par le temps de réponse. Le test compare les deux réponses
    sérialisées et vérifie qu'aucun email n'est parti pour l'adresse inconnue : le
    formulaire public ne devient pas un annuaire des comptes.
- **Sessions révoquées à la réinitialisation** (`revokeSessionsOnPasswordReset`). Une
  réinitialisation signifie souvent « quelqu'un d'autre avait accès » : laisser vivre les
  sessions ouvertes ailleurs laisserait cet accès intact et rendrait l'opération inutile.
  Un test ouvre une session avant la réinitialisation et vérifie qu'elle retombe en 401.
- **Connexion Google** (ADR-0006, mise en œuvre ADR-0014), avec `prompt: 'select_account'`
  — sans lui, un poste partagé reconnecte silencieusement la dernière session Google du
  navigateur : l'utilisateur croit se connecter, il entre dans le compte du collègue.
- **Liaison de comptes explicite.** Une inscription par mot de passe suivie d'une connexion
  Google sur la même adresse retrouve le compte au lieu d'en créer un second.
  `trustedProviders` est **volontairement vide** : la liaison exige que Google atteste
  lui-même (`email_verified`) que l'adresse lui appartient — c'est la seule preuve de
  propriété sur laquelle elle repose. Un test échoue si quelqu'un y ajoute `"google"` en
  croyant faciliter la connexion.
- **Aucun secret ni jeton dans les journaux** (§ Journalisation). Le repli sans SMTP
  journalise le destinataire et le sujet, **jamais le corps** — le corps porte le lien
  contenant le jeton. Un opérateur qui a besoin du lien active un vrai SMTP ; il ne le lit
  pas dans `journalctl`.
- **Aucune image distante dans les emails.** Un pixel chargé depuis un serveur tiers
  annoncerait à ce tiers qu'un destinataire donné a ouvert le message. Vérifié par test.
- **Dégradation sans point de panne.** Ni SMTP ni Google ne sont requis au démarrage :
  variables absentes → l'API démarre, le bouton Google ne s'affiche pas
  (`GET /auth-providers`, dérivé de la configuration réellement chargée — pas d'une
  variable côté web qui pourrait diverger), et les envois se replient sur le journal avec
  `delivered: false` remonté à l'utilisateur. Une configuration Google **à moitié**
  renseignée est traitée comme une absence, avec un avertissement au démarrage : un
  `clientId` sans `clientSecret` produirait sinon une exception au premier clic.
- **Un envoi en échec ne fait pas échouer l'opération métier** qui l'a déclenché : une
  invitation créée reste créée, son lien reste copiable depuis l'interface.

### Ce qui reste conditionné à la configuration

Ces points ne sont **pas** des restants de code — ils dépendent d'une action de
déploiement, et rien ne les remplace :

- **`SMTP_HOST` non renseigné ⇒ rien ne part.** Les conséquences décrites au § S20b
  (changement d'adresse impossible à terminer, `emailVerified` faux pour tout le monde,
  aucune notification) restent **intégralement valables** tant que le bloc SMTP est vide.
  Le mécanisme existe désormais ; il attend un serveur.
- **`AUTH_REQUIRE_EMAIL_VERIFICATION` doit passer à `true` en production dès que SMTP est
  renseigné.** Ce n'est pas un durcissement optionnel : c'est la parade au risque accepté
  ci-dessous.
- **SPF, DKIM et DMARC** sur le domaine d'envoi : sans ces enregistrements DNS, les
  messages partent en indésirables quel que soit le code (hors périmètre applicatif,
  docs/24).

### Risque accepté — pré-enregistrement d'une adresse

La liaison de comptes n'exige pas que le compte local soit déjà vérifié
(`requireLocalEmailVerified: false`). Exiger l'inverse rendrait la liaison inopérante sur
toute installation sans SMTP — où **aucun** compte n'est jamais vérifié — et enfermerait
dehors l'utilisateur légitime sur sa propre adresse.

Le risque qui en découle est réel et assumé : un attaquant qui crée un compte par mot de
passe à l'adresse d'une victime **avant elle** capte la liaison Google de la victime, et
les deux partagent l'accès (§ Menaces prioritaires — prise de compte).

La parade n'est pas de refuser la liaison, elle est d'empêcher un compte non vérifié
d'exister utilement : **`AUTH_REQUIRE_EMAIL_VERIFICATION=true` en production**, ce que ce
sprint rend enfin possible. Tant que cette variable reste à `false` avec un SMTP
configuré, le risque est ouvert. Détail dans ADR-0014 § Risque accepté.

### Restant sur ce périmètre

- **aucune reprise sur échec d'envoi** : un envoi raté est journalisé, pas réessayé. Un
  incident SMTP de quelques minutes perd les messages émis pendant sa durée ;
  l'utilisateur peut redemander un lien. Une file persistante (Redis) est écartée pour
  cette livraison, à rouvrir avec le volume ;
- **aucune observabilité de délivrabilité** : ni taux d'ouverture, ni retour de rejet ;
- **notification à l'ancienne adresse lors d'un changement** (§ S20b) : toujours pas
  envoyée ;
- **limitation de débit propre aux envois** : `/auth/*` s'appuie sur la limitation de
  tentatives de better-auth ; aucun quota spécifique ne borne le nombre d'emails qu'une
  même adresse peut déclencher ;
- **MFA** et **notification d'événements critiques** : toujours au restant de S16a.

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
