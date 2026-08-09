# ADR-0014 — Connexion Google et envoi d'emails : deux dépendances externes, toutes deux optionnelles

Statut : Accepted
Date : 2026-08-09
Décideurs : CTO Lalanda (délégation Gracy Omokoso), décideur produit

## Contexte

Deux manques bloquaient des parcours entiers depuis S16a, et docs/17-SECURITE.md les
recensait sans les traiter.

**Aucun email ne part.** Le flux serveur de vérification d'adresse, d'invitation et de
changement d'email est complet depuis S20b — mais le message n'est envoyé nulle part.
Conséquences déjà écrites dans docs/17 § Bloqué par l'absence de SMTP : `emailVerified`
vaut `false` pour tout le monde, un changement d'adresse ne peut pas aboutir, une
invitation n'existe que sous forme de lien à copier à la main, et
`AUTH_REQUIRE_EMAIL_VERIFICATION` doit rester à `false`.

**Aucune récupération de compte.** Il n'existe aucun « mot de passe oublié ». Un
utilisateur qui perd son mot de passe perd son compte, définitivement — il n'y a pas de
support à contacter. C'est le manque le plus grave des deux : les trois autres dégradent
l'expérience, celui-là détruit des données du point de vue de l'utilisateur.

**Aucune alternative au mot de passe.** ADR-0006 a retenu better-auth en citant
explicitement les fournisseurs sociaux ; aucun n'a été branché.

Ces trois manques partagent une racine : le produit n'a jamais eu de dépendance externe
d'infrastructure *optionnelle*. OpenAI (ADR-0008) et MongoDB (ADR-0004) sont requis, le
démarrage échoue sans eux, et c'est correct. Un serveur de mail ne peut pas suivre cette
règle : un développeur sans MailHog doit pouvoir lancer l'API, et un déploiement sans
Google doit fonctionner en connexion par mot de passe. La question tranchée ici est donc
autant *comment on rend ces fonctions optionnelles sans les rendre douteuses* que *quelle
technologie*.

## Options considérées

### Envoi d'emails

**A. API d'un fournisseur (SendGrid, Resend, Postmark, Mailgun) — rejeté.**
Meilleure délivrabilité et meilleure observabilité, sans discussion. Rejeté pour une
raison qui n'est pas technique : le produit vise la RDC et l'espace panafricain, où
plusieurs de ces fournisseurs facturent en devise forte avec un moyen de paiement que le
décideur ne détient pas nécessairement, et où certains refusent les domaines en `.cd`
à l'inscription. Un SDK propriétaire par fournisseur enfermerait de surcroît le code dans
un choix qu'on n'est pas en mesure de valider aujourd'hui.

**B. SMTP générique (nodemailer) — retenu.**
SMTP est le plus petit dénominateur commun : il parle à Gmail/Google Workspace, à un
relais mutualisé local, à MailHog en développement, et aux fournisseurs de l'option A —
qui exposent tous une passerelle SMTP. Choisir SMTP, ce n'est pas renoncer à SendGrid,
c'est refuser de choisir SendGrid *maintenant*, dans le code. La bascule vers une API
propriétaire reste possible en remplaçant une seule classe (`MailTransport`).

**C. File d'attente persistante (BullMQ/Redis) — rejeté pour cette livraison.**
Un envoi qui échoue n'est aujourd'hui pas réessayé. C'est une vraie limite (§ Limites
connues), mais elle ne justifie pas d'introduire Redis comme dépendance requise dans le
même lot que le premier email jamais envoyé. À rouvrir quand le volume le demandera.

### Connexion Google

**D. `NEXT_PUBLIC_GOOGLE_ENABLED` côté web pour afficher le bouton — rejeté.**
Une seconde source de vérité pour un fait que l'API connaît déjà. La panne qui en découle
est classique et silencieuse : le bouton s'affiche vers un fournisseur non configuré, et
le premier clic tombe sur une page d'erreur. Retenu à la place : `GET /auth-providers`,
dérivé de la configuration réellement chargée.

**E. Refuser de démarrer si Google est mal configuré — rejeté.**
Transformerait l'oubli d'une variable en panne totale de l'API. Retenu à la place :
la demi-configuration (une seule des deux variables) est traitée **comme une absence**,
et un avertissement est écrit au démarrage. Motif : un `clientId` sans `clientSecret`
produit, au premier clic, une exception `CLIENT_ID_AND_SECRET_REQUIRED` levée au fond de
better-auth — une panne à l'usage, là où l'absence des deux n'escamote qu'un bouton.

### Réinitialisation de mot de passe

**F. Implémentation maison (jeton, collection, hachage) — rejeté.**
better-auth possède l'algorithme de hachage de la collection `account`. Réécrire la pose
du nouveau mot de passe reviendrait à dupliquer, puis à désynchroniser, la politique de
hachage — le genre de divergence qui ne se voit qu'au moment où plus personne ne peut se
connecter.

**G. Déléguer à better-auth (`sendResetPassword`) — retenu.**
Fournit sans code supplémentaire les trois garanties qui comptent, vérifiées par des
tests bout en bout plutôt que supposées : jeton à **usage unique**
(`consumeVerificationValue` supprime la valeur en la lisant), **expiration serveur**, et
**absence d'énumération** — `/auth/request-password-reset` répond à l'identique pour une
adresse inconnue, et simule même la génération du jeton pour ne pas se trahir par le
temps de réponse.

## Décision

### 1. Envoi d'emails : SMTP optionnel, repli journal

Module `apps/api/src/mail/`, quatre pièces séparées pour que chacune soit remplaçable :

| Pièce | Rôle |
| --- | --- |
| `MailCredentialsProvider` (abstrait) | D'où viennent les identifiants. Implémentation par défaut : l'environnement. **Seul point d'extension prévu** pour ADR-0013 (identifiants chiffrés en base, éditables depuis `/admin`). |
| `MailTransport` (abstrait) | Comment part le message. Implémentation par défaut : nodemailer + repli journal. |
| `MailService` | Quoi envoyer : une méthode par message métier. |
| `mail.templates.ts` | Gabarits français, texte + HTML, **sans aucune image distante**. |

Règles arbitrées :

- **`SMTP_HOST` seul décide.** Sans hôte, `resolve()` retourne `null`, le message est
  journalisé (destinataire et sujet **uniquement**) et l'appel rapporte
  `delivered: false`. L'application démarre et fonctionne. C'est un état **normal**
  du produit, pas une panne.
- **`SMTP_USER` / `SMTP_PASSWORD` restent facultatifs même avec un hôte** : un relais
  interne ou un MailHog de développement n'authentifie personne.
- **Port par défaut 587**, pas 25 : le port 25 est bloqué en sortie par la quasi-totalité
  des hébergeurs, DigitalOcean compris (ADR-0009). Un défaut à 25 produirait un timeout
  silencieux là où 587 produit une erreur d'authentification lisible. `secure: true`
  uniquement sur 465 (TLS implicite).
- **`resolve()` est asynchrone et appelée à chaque envoi**, jamais figée au démarrage :
  des identifiants lus en base doivent pouvoir changer sans redémarrage. Le transporteur
  nodemailer est mis en cache, invalidé dès que les identifiants changent.
- **Un envoi en échec ne fait pas échouer l'opération métier** qui l'a déclenché : une
  invitation créée reste créée, son lien reste copiable depuis l'interface.
- **Jamais le corps dans les journaux** (docs/17 § Journalisation) : le corps contient
  précisément le lien porteur du jeton. Un opérateur qui a besoin du lien active un vrai
  SMTP ; il ne le lit pas dans `journalctl`.
- **Aucune image distante dans les gabarits** : un pixel chargé depuis un serveur tiers
  annonce à ce tiers qu'un destinataire donné a ouvert le message, et fait
  systématiquement passer l'email par les filtres anti-pistage.

### 2. Connexion Google : optionnelle, avec liaison de comptes explicite

- `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` **optionnelles, les deux ou aucune**.
  Absentes → `socialProviders: {}`, l'API démarre, `/auth/sign-in/social` répond 404
  `PROVIDER_NOT_FOUND`, et le bouton ne s'affiche pas.
- **Une seule des deux** → traitée comme une absence + avertissement au démarrage.
- `prompt: 'select_account'` : sans lui, un poste partagé reconnecte silencieusement la
  dernière session Google du navigateur — l'utilisateur croit se connecter, il entre dans
  le compte du collègue.
- `GET /auth-providers` → `{ "google": true|false }`. Route publique (consultée avant
  toute session), qui ne renvoie **pas** le `clientId`.

**Liaison de comptes** — le point qui mérite d'être discuté plutôt que subi. Cas visé :
quelqu'un s'inscrit par mot de passe, revient plus tard par « Continuer avec Google » avec
la même adresse. Sans liaison, better-auth refuse (`account not linked`) : la personne se
retrouve dehors avec une adresse qui « existe déjà ».

```
accountLinking: { enabled: true, trustedProviders: [], requireLocalEmailVerified: false }
```

- **`trustedProviders: []` — volontairement vide, ce n'est pas un oubli.** Y inscrire
  `"google"` lierait le compte même si Google annonçait `email_verified: false`. En le
  laissant vide, on exige que Google atteste lui-même que l'adresse lui appartient. C'est
  la seule preuve de propriété sur laquelle repose toute la liaison. Un test bout en bout
  échoue si quelqu'un ajoute `"google"` en croyant « faciliter » la connexion.
- **`requireLocalEmailVerified: false`.** Avec la valeur par défaut (`true`), la liaison
  exigerait un compte local **déjà vérifié**. Or le produit fonctionne sans SMTP (mode
  documenté ci-dessus) : dans cette situation aucun compte n'est jamais vérifié, la
  liaison ne fonctionnerait pour personne, et l'utilisateur légitime serait enfermé
  dehors sur sa propre adresse.

### 3. Réinitialisation de mot de passe : déléguée, durcie sur trois points

- **TTL 30 minutes** au lieu des 60 par défaut. Ce lien vaut une prise de contrôle
  complète du compte pour qui l'intercepte, et une boîte email consultée sur un poste
  partagé garde ses messages bien plus longtemps que le temps nécessaire pour cliquer.
  Redemander un lien coûte un clic.
- **`revokeSessionsOnPasswordReset: true`.** Une réinitialisation signifie souvent
  « quelqu'un d'autre avait accès » ; laisser vivre les sessions ouvertes ailleurs
  laisserait cet accès intact et rendrait l'opération inutile.
- **Le lien pointe vers la page web** `/nouveau-mot-de-passe?token=…`, pas vers l'endpoint
  API qui redirige : le destinataire doit atterrir directement sur la saisie.
- **TTL de vérification d'adresse : 24 h**, délibérément plus long — ce lien ne donne
  accès à rien, il atteste seulement qu'une boîte est relevée par son propriétaire.

## Procédure — obtenir les identifiants Google

À suivre **à la lettre**. Compte Google requis ; aucun paiement, aucune carte bancaire.

> **Note de navigation.** Google a réorganisé cette partie de la console : la
> configuration OAuth vit désormais sous **« Google Auth Platform »**
> (<https://console.cloud.google.com/auth/overview>), avec les sections *Branding*,
> *Audience*, *Clients* et *Accès aux données*. L'ancien chemin
> **APIs et services → Écran de consentement OAuth** y redirige. Les deux appellations
> sont données ci-dessous ; **les valeurs à saisir sont les mêmes**. Si un libellé diffère
> légèrement, se fier au sens de la colonne « Pourquoi ».

### Étape 1 — Projet

1. Ouvrir <https://console.cloud.google.com/>.
2. Sélecteur de projet (barre du haut) → **Nouveau projet**.
3. Nom : `Lalanda`. **Créer**, puis sélectionner ce projet — toutes les étapes suivantes
   s'y déroulent. Vérifier à chaque écran que le sélecteur affiche bien `Lalanda` :
   configurer le mauvais projet est l'erreur la plus fréquente, et elle ne produit aucun
   message d'erreur.

### Étape 2 — Identité de l'application et audience

**Google Auth Platform** → **Branding** (ancien : *Écran de consentement OAuth*).

| Champ | Valeur |
| --- | --- |
| Nom de l'application | `Lalanda` |
| Email d'assistance | l'adresse de l'éditeur |
| Logo | facultatif ; **en ajouter un déclenche une validation Google de plusieurs semaines** — à éviter au lancement |
| Domaine de l'application | `https://app.lalanda.example` |
| Lien vers la politique de confidentialité | page publique du site (livrée en S22c) |
| Lien vers les conditions d'utilisation | idem |
| Domaines autorisés | `lalanda.example` |
| Coordonnées du développeur | l'adresse de l'éditeur |

Puis **Audience** (ancien : *Type d'utilisateur*) → **Externe**. « Interne » n'existe que
pour un domaine Google Workspace et interdirait toute adresse `@gmail.com`.

### Étape 3 — Portées (scopes)

**Accès aux données** → **Ajouter ou supprimer des portées** (ancien : onglet *Portées* de
l'écran de consentement) → cocher **exactement ces trois**, et rien d'autre :

| Portée | Pourquoi |
| --- | --- |
| `openid` | Identifiant stable du compte Google (`sub`) |
| `.../auth/userinfo.email` | L'adresse **et son attestation `email_verified`** — sans elle, la liaison de comptes est impossible |
| `.../auth/userinfo.profile` | Le nom affiché, utilisé pour nommer l'organisation personnelle |

Ces trois portées sont **non sensibles** : elles n'exigent aucune vérification Google et
aucun audit de sécurité. **Toute portée supplémentaire (Drive, Agenda, Gmail…) ferait
basculer l'application en portée sensible ou restreinte**, avec vérification obligatoire
et délai de plusieurs semaines. Ne rien ajouter.

### Étape 4 — Utilisateurs de test, puis publication

**Audience** → section **Utilisateurs de test**. Tant que l'application est en statut
**Test**, seules les adresses listées là peuvent se connecter (100 maximum), et leur
consentement expire au bout de 7 jours — une connexion qui marchait la semaine dernière et
qui échoue aujourd'hui, sans changement de code, vient presque toujours de là. Y ajouter
les adresses de l'équipe pour la recette.

Avant l'ouverture au public : **Publier l'application** (bouton de la même page). Avec ces
trois portées non sensibles seulement, le passage en **Production** est immédiat et ne
déclenche aucun processus de vérification. Un écran « Google n'a pas validé cette
application » qui persiste après publication signale une portée sensible ajoutée par
erreur — revoir l'étape 3.

### Étape 5 — Identifiants OAuth

**Google Auth Platform** → **Clients** → **Créer un client** (ancien : *APIs et services*
→ *Identifiants* → *Créer des identifiants* → *ID client OAuth*).

- **Type d'application : `Application Web`.** Ni « Ordinateur », ni « Android/iOS » :
  eux n'acceptent pas de `client_secret` et le flux serveur ne fonctionnerait pas.
- Nom : `Lalanda API`.

**Origines JavaScript autorisées** — laisser **vide**. La redirection est construite par
l'API, pas par le navigateur ; rien n'est nécessaire ici.

**URI de redirection autorisés** — ajouter les deux, **exactement** (Google compare
caractère par caractère : le protocole, le port et l'absence de barre oblique finale
comptent) :

```
http://localhost:3001/auth/callback/google
https://api.lalanda.example/auth/callback/google
```

> Règle générale : `<API_URL>/auth/callback/google`. **`API_URL`, pas `WEB_URL`** — c'est
> l'API qui porte better-auth (`basePath: '/auth'`). Remplacer `api.lalanda.example` par
> le domaine réel de l'API (`API_DOMAIN` du `.env.production`).

**Créer** → Google affiche l'ID client et le code secret. Les reporter dans le fichier
d'environnement de l'API :

```
GOOGLE_CLIENT_ID=<ID client>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<code secret>
```

Puis redémarrer l'API. Contrôle en une commande — `curl <API_URL>/auth-providers` doit
répondre `{"google":true}` ; s'il répond `{"google":false}`, l'une des deux variables
manque (un avertissement le dit dans les journaux de démarrage).

Le code secret n'est **plus réaffiché** après fermeture de la fenêtre : le perdre oblige à
en générer un nouveau (ce qui invalide l'ancien). Il n'a **rien à faire dans le dépôt** —
`.env` et `.env.production` sont ignorés par git.

## Risque accepté

**Pré-enregistrement d'une adresse.** Avec `requireLocalEmailVerified: false`, un
attaquant qui crée un compte par mot de passe à l'adresse d'une victime **avant elle**
verra la connexion Google de la victime se lier à *son* compte : les deux partagent alors
l'accès.

La parade retenue n'est pas de refuser la liaison — ce serait enfermer dehors les
utilisateurs légitimes de toute installation sans SMTP. Elle est d'**empêcher un compte
non vérifié d'exister utilement** : `AUTH_REQUIRE_EMAIL_VERIFICATION=true` en production,
ce que cet ADR rend enfin possible en branchant l'envoi. La consigne opérationnelle est
donc explicite, et écrite dans `.env.production.example` à côté de la variable :

> **Passer `AUTH_REQUIRE_EMAIL_VERIFICATION` à `true` dès que le bloc SMTP est renseigné.**

Tant que ce n'est pas fait, le risque est ouvert. Il est ici documenté, pas ignoré.

## Conséquences

- Nouveau module `apps/api/src/mail/`, nouvelle route publique `GET /auth-providers`,
  nouvelles pages web `/mot-de-passe-oublie`, `/nouveau-mot-de-passe`,
  `/verification-email`.
- Une dépendance ajoutée : `nodemailer`. Aucune autre.
- Cinq variables SMTP et deux variables Google, **toutes optionnelles** : aucun
  déploiement existant ne casse, et `pnpm dev` fonctionne sans rien configurer.
- Les invitations d'organisation et le changement d'adresse email, jusqu'ici bloqués
  faute d'envoi (docs/17 § Bloqué par l'absence de SMTP), aboutissent dès que `SMTP_HOST`
  est renseigné — sans autre changement de code.
- `AUTH_REQUIRE_EMAIL_VERIFICATION=true` devient tenable en production. C'est le
  prérequis du § Risque accepté.
- ADR-0013 conserve son point d'entrée : `MailCredentialsProvider` est l'unique classe à
  remplacer pour lire les identifiants SMTP chiffrés en base au lieu de l'environnement.

### Limites connues

- **Aucune reprise sur échec.** Un envoi qui échoue est journalisé, pas réessayé
  (option C rejetée). Un incident SMTP de quelques minutes perd les messages émis
  pendant sa durée ; l'utilisateur peut redemander un lien.
- **Aucune observabilité de délivrabilité** : ni taux d'ouverture, ni retour de rejet
  (bounce). SMTP ne les donne pas.
- **SPF/DKIM/DMARC hors périmètre code** : sans ces enregistrements DNS sur le domaine
  d'envoi, les messages partiront en indésirables quel que soit le code. À traiter au
  déploiement (docs/24).
- **Un seul fournisseur social.** Microsoft et Apple ne sont pas branchés ; la structure
  les accepterait sans changement d'architecture.

## Plan de validation

Tous les tests **mockent le transport** : aucune connexion SMTP, aucun appel à Google
n'est ouvert par la suite de tests. Les suites bout en bout sont **non skippables** en CI
(`LALANDA_REQUIRE_E2E=1`).

- **Réinitialisation, bout en bout** — le transport est espionné après le démarrage de
  l'application, ce qui donne le lien réellement émis, donc le jeton réellement produit :
  réponse **identique** pour une adresse inconnue (aucune énumération) et **aucun email
  parti** ; jeton **expiré** refusé, l'ancien mot de passe restant valide ; **second
  usage** du même jeton refusé ; sessions ouvertes ailleurs révoquées (401).
- **Google, bout en bout** — le seul appel réseau du chemin (le JWKS de Google) est
  détourné vers une paire de clés locale, ce qui permet d'exercer le **vrai** code de
  liaison de better-auth : première connexion → compte créé, `emailVerified: true`,
  organisation personnelle provisionnée ; retour Google sur une adresse déjà inscrite par
  mot de passe → **un seul** utilisateur, deux `account` (`credential` + `google`), mot de
  passe d'origine toujours valide ; `email_verified: false` → liaison **refusée** (401),
  aucun `account` Google créé.
- **Démarrage nu** — sans aucune variable Google ni SMTP : l'API démarre, les routes
  répondent, `/auth-providers` renvoie `{ google: false }`, `/auth/sign-in/social` répond
  404, et un changement d'adresse annonce honnêtement `verificationDelivered: false`.
- **Unitaires** — `resolveGoogleCredentials` / `isPartialGoogleConfig` (les deux, une
  seule, aucune, valeurs blanches) ; résolution des identifiants SMTP (port par défaut
  587, `secure` sur 465 seulement, port illisible sans effet de bord) ; repli journal sans
  corps ni jeton ; gabarits (français, lien présent, aucune image distante, durée annoncée
  égale à la durée appliquée).
- `pnpm format`, lint, typecheck, `pnpm -w test` et `pnpm -w build` verts.

## Liens

- ADR-0006 (better-auth — fournisseurs sociaux annoncés), ADR-0009 (DigitalOcean, port 25
  bloqué), ADR-0012 (rôles), ADR-0013 (secrets chiffrés en base — `MailCredentialsProvider`)
- `docs/17-SECURITE.md` § S22a, § Journalisation, § Menaces prioritaires
- `docs/16-API.md`, `docs/24-INFRASTRUCTURE.md`, `docs/18-TESTS.md`
- `packages/shared/src/env/index.ts`, `.env.example`, `.env.production.example`
- `apps/api/src/auth/auth.ts`, `apps/api/src/mail/`, `apps/web/src/app/(auth)/`
