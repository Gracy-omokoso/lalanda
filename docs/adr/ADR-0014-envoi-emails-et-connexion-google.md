# ADR-0014 — Envoi d'emails et connexion Google

Statut : Accepted
Date : 2026-08-09 — amendé le 2026-08-12 (§ S22m : ZeptoMail)
Décideurs : Gracy Omokoso

## Contexte

Deux manques bloquants coexistaient depuis S16a :

1. **Aucun email n'était jamais envoyé.** La vérification d'adresse et les invitations étaient simulées par des logs serveur. Le flux de changement d'adresse livré en S20b était complet côté serveur mais inopérant : `notifiedAt` restait `null`, l'API annonçait honnêtement `verificationDelivered: false`, et un utilisateur final ne pouvait pas terminer l'opération seul (`docs/17` § Bloqué par l'absence de SMTP). Il n'existait par ailleurs **aucun flux de mot de passe oublié** : un compte dont le mot de passe est perdu était un compte perdu.
2. **Aucune connexion Google**, alors qu'ADR-0006 l'annonçait comme active dès S4.

Contrainte de départ, non négociable : le produit doit continuer de **démarrer et fonctionner sans aucune de ces configurations**. Un développeur qui clone le dépôt n'a ni serveur SMTP ni application OAuth ; rendre le démarrage dépendant de l'un ou l'autre transformerait deux fonctionnalités optionnelles en points de panne du produit entier.

## Options considérées

### Envoi d'emails

| Option | Retenue | Motif |
| --- | --- | --- |
| **SMTP via `nodemailer`, variables optionnelles, repli sur log** | ✅ (S22a) | Fonctionne avec n'importe quel fournisseur (Gmail, Brevo, SES, MailHog local) sans SDK propriétaire. Le repli conserve exactement le comportement d'avant S22a quand rien n'est configuré. |
| SDK d'un fournisseur (Resend, SendGrid, Postmark) | ❌ | Enferme le produit dans un fournisseur et impose une clé d'API pour le moindre test local. La question du fournisseur reste ouverte : SMTP la garde ouverte. |
| File d'attente (BullMQ) dès maintenant | ❌ | Redis n'est pas branché en production (`REDIS_URL` optionnel, S16a). Trois emails transactionnels par action utilisateur ne justifient pas une infrastructure. `MailService` est une abstraction : la file s'insérera derrière sans toucher aux appelants. |

### Mot de passe oublié

| Option | Retenue | Motif |
| --- | --- | --- |
| **`emailAndPassword.sendResetPassword` de better-auth** | ✅ | better-auth possède l'algorithme de hachage de la collection `account`. Il fournit déjà le jeton à usage unique (`consumeVerificationValue`), l'expiration serveur, et la non-énumération (réponse identique pour une adresse inconnue, avec simulation du travail pour ne pas se trahir par le temps de réponse). |
| Implémentation maison, comme le changement d'adresse (S20b) | ❌ | Obligerait à réécrire la pose du mot de passe haché, donc à dupliquer — puis à désynchroniser — la politique de hachage. Ce genre de divergence ne se voit qu'au moment où plus personne ne peut se connecter. |

### Liaison de comptes Google

Voir § Risque accepté : c'est le point qui a demandé un arbitrage.

## Décision

### 1. Module `apps/api/src/mail/`

Trois étages, chacun déclaré par son abstraction dans le module Nest (`provide: X, useClass: Y`) donc chacun remplaçable sans toucher aux appelants :

- `MailCredentialsProvider` → d'où viennent les identifiants SMTP. Implémentation actuelle : lecture d'environnement. **Point d'extension prévu pour `integrations/`** (ADR-0013), qui stockera un jour ces identifiants chiffrés en base, par organisation. `resolve()` est asynchrone et appelée à chaque envoi précisément pour qu'une implémentation en base ait un cycle de vie utilisable. Le module mail ne dépend **pas** d'`integrations/` : il expose une prise, il ne va pas chercher la fiche.
- `MailTransport` → acheminement. Implémentation actuelle : `nodemailer` avec transporteur mis en cache, invalidé dès que les identifiants changent.
- `MailService` → **l'interface que consomment les autres modules**, exprimée en intentions métier (`sendInvitation`, `sendPasswordReset`, `sendEmailVerification`) et non en primitives de transport. Un appelant ne compose jamais un sujet ni un corps.

Cinq variables, **toutes optionnelles** : `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. `SMTP_HOST` seul décide : sans hôte, le message est journalisé (destinataire et sujet, **jamais le corps** — il contient le lien porteur du jeton) et l'appel retourne `delivered: false`. `SMTP_USER`/`SMTP_PASSWORD` restent facultatifs même avec un hôte (relais interne, MailHog).

> **Amendé en S22m.** SMTP n'est plus le seul chemin ni le chemin par défaut : voir **§ 1 bis** ci-dessous. Ce qui précède reste exact pour le chemin SMTP, qui est conservé.

**Aucune méthode ne lève sur échec d'envoi.** Une invitation créée reste créée si son email ne part pas ; son lien reste copiable depuis l'interface. Faire échouer l'opération métier ferait dépendre l'écriture en base de la disponibilité d'un serveur de mail.

### 1 bis. Amendement S22m — l'API ZeptoMail devient le chemin d'envoi

S22a laissait la question du fournisseur ouverte, et c'était le but. Elle est tranchée : **Zoho ZeptoMail**, appelé par son API HTTP, devient le chemin d'envoi préféré. `MailService`, les gabarits et le contrat des appelants sont **inchangés** — c'est précisément ce que l'architecture en trois étages devait permettre, et elle l'a permis.

#### SMTP est CONSERVÉ en repli. Pourquoi

C'est le seul arbitrage réel de ce lot, et la réponse n'est pas « par prudence ».

- **Le développement local.** ADR-0014 écartait les SDK fournisseurs parce qu'ils « imposent une clé d'API pour le moindre test local ». Retirer SMTP referait exactement ce qui avait été refusé : un développeur devrait détenir un jeton ZeptoMail — c'est-à-dire un jeton **de production**, capable d'écrire à de vraies adresses — pour voir un email pendant un test. MailHog n'envoie rien à personne ; c'est une propriété de sécurité, pas un confort.
- **Le déploiement en cours d'exploitation.** Le bloc SMTP est posé en production. Le retirer du code ferait de la mise à jour une bascule obligatoire au lieu d'un changement réversible.
- **Le coût de le garder est faible et connu** : une branche dans le transport, et `nodemailer` qui était déjà là.

Ce n'est pas un **repli automatique**. Le chemin est choisi une fois, à la résolution des identifiants, et un échec ne fait **jamais** réessayer l'autre chemin. Un envoi qui échoue en ayant peut-être abouti — délai dépassé après acceptation par Zoho — partirait alors deux fois, et l'utilisateur recevrait deux liens de réinitialisation dont un seul fonctionne. La délivrabilité n'y gagne rien ; l'ambiguïté, elle, est certaine.

#### Précédence

| Configuration | Chemin |
| --- | --- |
| `ZEPTOMAIL_TOKEN` posé | API ZeptoMail — même si le bloc SMTP est encore renseigné |
| sinon `SMTP_HOST` posé | SMTP |
| sinon | journal, `delivered: false` — **propriété d'origine intacte** |

Que ZeptoMail gagne sur un bloc SMTP encore présent rend la migration atomique : poser le jeton suffit, il n'y a pas à vider SMTP le même jour. Le chemin retenu est **journalisé** au premier envoi (`Chemin d'envoi des emails : …`), et de nouveau s'il change. Sans cette ligne, « par où partent réellement les emails ? » n'aurait pas de réponse observable — deux chemins et un repli silencieux se ressemblent beaucoup vus depuis une boîte de réception vide.

#### Aucune dépendance npm ajoutée

Le paquet `zeptomail` de Zoho **n'a pas pu être installé** : `registry.npmjs.org` est injoignable depuis le poste de développement (IPv6 non routé), `pnpm add` échoue en `ETIMEDOUT`. Ce n'est pas le seul motif, et le second aurait suffi : son `SendMailClient` n'est qu'une enveloppe autour d'un `POST` JSON, et ADR-0013 §10 désigne la chaîne d'approvisionnement npm comme « le maillon faible » du dispositif qui protège les secrets. L'appel est donc écrit directement (`fetch`, en-tête `Authorization: Zoho-enczapikey <jeton>`), comme `storage/sigv4.ts` parle SigV4 sans `@aws-sdk`. Le point d'attache est `apps/api/src/mail/zeptomail.client.ts`, et lui seul : si le paquet devient installable et que l'usage se complique (pièces jointes, gabarits Zoho), la décision se rediscutera à cet endroit.

#### Où vit le jeton — et l'asymétrie à connaître

| | Aujourd'hui | Cible |
| --- | --- | --- |
| Test de connexion (`/admin`) | fiche `zeptomail`, secret chiffré en base (ADR-0013) | inchangé |
| Transport (envoi réel) | `ZEPTOMAIL_TOKEN` dans l'environnement | fiche `zeptomail` |

Le critère de partage d'ADR-0013 §8 désigne bien le coffre : un email part longtemps après la lecture de la base. Mais brancher le transport sur `SecretsService` fait dépendre `MailModule` — `@Global`, chargé avant `AuthModule` dont la factory better-auth injecte `MailService` au bootstrap — du graphe d'`IntegrationsModule`. C'est un lot à part entière, pas un effet de bord de celui-ci ; il consiste à écrire le `DatabaseMailCredentialsProvider` que §1 annonce depuis S22a, et **rien d'autre ne bougera** : ni le service, ni le transport, ni les gabarits.

D'ici là l'ordre d'usage est le suivant, et il est inscrit dans `.env.production.example` : **tester le jeton dans `/admin`, le poser dans l'environnement.** La fiche `/admin` a donc une utilité immédiate et réelle — valider un jeton *avant* de le déployer — mais un jeton qui n'existerait que là ne ferait partir aucun email. Cette asymétrie est temporaire ; elle ne doit pas être découverte.

`envFallback` reste **vide** pour `zeptomail` : lui donner une entrée ferait afficher « source : env » dans `/admin` et recréerait l'hybride permanent qu'ADR-0013 option C rejette.

#### Test de connexion sans coût

ZeptoMail n'expose aucun point de lecture — son API de transaction n'a qu'une route, `POST /v1.1/email`. Le test l'appelle donc, avec une charge **`{}`** : ni destinataire, ni sujet, ni corps. Deux propriétés en découlent, et la première est la seule qui compte pour la facture :

1. **Aucun destinataire n'est émis.** Il n'y a personne à qui écrire ; même une API qui accepterait tout n'aurait aucune adresse à servir. C'est une propriété de la **requête émise**, vérifiable hors ligne, et non une promesse sur le comportement du serveur.
2. **L'authentification est tranchée avant la validation.** `401`/`403` → jeton refusé. `400` → jeton **accepté**, charge refusée à la validation : c'est le résultat attendu, il ne s'obtient qu'authentifié. Un `2xx` serait une anomalie — l'API aurait accepté une charge vide — et est signalé comme tel plutôt que compté pour un succès.

`apiUrl` figure dans la liste blanche `config` de la fiche : Zoho exploite trois centres de données (`api.zeptomail.com`, `.eu`, `.in`) et un jeton émis dans l'un est refusé par les autres. Sans ce champ, un compte européen serait intestable depuis `/admin`, et le `401` obtenu accuserait le jeton alors que seul le point d'entrée serait en cause.

#### Variables

Toutes optionnelles, la propriété de démarrage sans configuration est intacte.

| Variable | Rôle |
| --- | --- |
| `ZEPTOMAIL_TOKEN` | « Send Mail Token » de la console Zoho. Le préfixe `Zoho-enczapikey` est retiré s'il a été collé avec — la console affiche la ligne d'en-tête entière, et le doubler produit un `401` que personne ne relie à un copier-coller. |
| `ZEPTOMAIL_API_URL` | Centre de données. Défaut `https://api.zeptomail.com/v1.1/email`. |
| `MAIL_FROM` | Expéditeur affiché, **commun aux deux chemins**. Nom canonique depuis S22m : il ne nomme plus un protocole que ZeptoMail n'utilise pas. |
| `SMTP_FROM` | Ancien nom de `MAIL_FROM`, toujours lu. Il est **déjà posé en production** ; le retirer d'un coup ferait partir les premiers emails ZeptoMail depuis une adresse déduite. `MAIL_FROM` gagne quand les deux sont là. |

Une seule variable d'expéditeur pour les deux chemins, et c'est délibéré : deux finiraient par diverger, et l'expéditeur affiché dépendrait alors du transport en vigueur — écart invisible en développement, visible par les destinataires en production. ZeptoMail veut `{address, name}` séparés là où SMTP accepte `"Nom <adresse>"` : la conversion se fait dans le client, pas dans la configuration.

#### Ce qui ne change pas

- Sans aucune configuration, l'API démarre, l'email est journalisé, l'appel retourne `delivered: false`. Cette propriété est la raison d'être du repli et reste testée.
- Aucune méthode ne lève sur échec d'envoi. **Mais aucun échec n'est silencieux** : chaque échec est journalisé avec le chemin emprunté, le destinataire et le sujet — jamais le corps, qui porte le lien et son jeton (docs/17 § Journalisation). C'est la contrepartie indispensable de « ne jamais lever » : sans cette ligne, un email jamais parti ne laisserait aucune trace, et le seul signal serait la plainte d'un utilisateur des jours plus tard.
- Le motif machine `SMTP_NOT_CONFIGURED` devient `MAIL_NOT_CONFIGURED` (deux chemins possibles : un motif qui n'en nomme qu'un ferait chercher un serveur SMTP absent là où c'est le jeton qui manque), et `ZEPTOMAIL_ERROR` s'ajoute à `SMTP_ERROR`. Ces codes ne sont lus que dans `apps/api/src/mail/`.

### 2. Trois emails, en français, sans image distante

Vérification d'adresse (sert l'inscription **et** le changement d'adresse), invitation, réinitialisation de mot de passe. Contraintes de rendu tenues par les gabarits et vérifiées par des tests : aucune ressource distante (une image chargée depuis un tiers révèle l'IP et l'heure d'ouverture du destinataire, et la plupart des clients la bloquent), styles en ligne, tableau de mise en page, variante texte **complète lien compris**, et destination du bouton écrite en clair dessous — un bouton dont on ne peut pas lire la cible a la forme exacte d'un email d'hameçonnage.

### 3. Réinitialisation de mot de passe

- jeton à **usage unique**, expiration **30 minutes** (et non les 60 par défaut) : ce lien vaut une prise de contrôle complète du compte pour qui l'intercepte ;
- `revokeSessionsOnPasswordReset: true` — une réinitialisation signifie souvent « quelqu'un d'autre avait accès » ; laisser vivre ses sessions laisserait cet accès intact ;
- **aucune énumération d'adresses**, garantie côté serveur par better-auth et respectée côté interface : la page de demande passe à l'écran de confirmation dès que la requête aboutit, sans jamais distinguer « adresse connue » de « adresse inconnue ».

### 4. Connexion Google

`GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`, **les deux ou aucune**. Une demi-configuration est traitée comme une absence *et signalée au démarrage* : un `clientId` seul produirait, au premier clic, une exception `CLIENT_ID_AND_SECRET_REQUIRED` au fond de better-auth — une panne visible par l'utilisateur là où l'absence des deux n'escamote qu'un bouton.

**Le front n'a pas sa propre variable.** La page de connexion interroge `GET /auth-providers`, qui dérive la réponse de la configuration réellement chargée. Une variable `NEXT_PUBLIC_GOOGLE_ENABLED` serait une seconde source de vérité, et la panne qui en découle est toujours la même : un bouton affiché vers un fournisseur non configuré.

`prompt: 'select_account'` est forcé. Sans lui, un poste partagé reconnecte silencieusement la dernière session Google du navigateur : l'utilisateur croit se connecter, il entre dans le compte du collègue.

### 5. Liaison de comptes — la configuration exacte, et pourquoi

```ts
account: {
  accountLinking: {
    enabled: true,
    trustedProviders: [],            // volontairement vide
    requireLocalEmailVerified: false // arbitrage, voir ci-dessous
  }
}
```

better-auth refuse la liaison si :

```
   (!fournisseurDeConfiance && !emailVérifiéParLeFournisseur)
|| (requireLocalEmailVerified && !emailVérifiéLocalement)
|| accountLinking désactivé
```

- **`trustedProviders: []`** — vide, ce n'est pas un oubli. Inscrire `"google"` court-circuiterait la première condition et lierait le compte **même si Google annonçait `email_verified: false`**. En le laissant vide, on exige que Google atteste lui-même que l'adresse lui appartient : c'est la preuve de propriété sur laquelle repose toute la liaison. Un test e2e échoue si quelqu'un ajoute `"google"` à la liste en croyant « faciliter » la connexion.
- **`requireLocalEmailVerified: false`** — voir § Risque accepté.

`emailVerified` d'un compte Google suit l'attestation de Google. Comme la liaison et la création ne sont acceptées que sur `email_verified: true`, un compte Google est vérifié — redemander une vérification par email serait exiger deux fois la même preuve.

## Risque accepté — `requireLocalEmailVerified: false`

**Le risque.** Avec la valeur par défaut (`true`), la liaison exigerait que le compte local soit déjà vérifié. En la passant à `false`, on ouvre le scénario dit de *pré-enregistrement* : un attaquant crée un compte mot de passe à l'adresse d'une victime **avant elle** ; quand la victime se connecte par Google, son identité Google se lie au compte de l'attaquant, qui conserve son accès par mot de passe.

**Pourquoi l'accepter quand même.** Ce produit fonctionne sans SMTP configuré — c'est un état documenté et voulu. Dans cette situation, aucun compte n'est jamais vérifié : avec `true`, la liaison ne fonctionnerait **pour personne**, et l'utilisateur légitime serait définitivement enfermé dehors sur sa propre adresse, avec pour seul recours le support. Le choix n'est donc pas entre « sûr » et « pratique », mais entre deux défaillances, dont l'une frappe tout le monde en permanence.

**La parade, et elle est réelle.** Elle n'est pas de refuser la liaison, mais d'empêcher un compte non vérifié d'exister utilement : `AUTH_REQUIRE_EMAIL_VERIFICATION=true`. Un compte pré-enregistré non vérifié devient alors inutilisable, et le scénario s'effondre. C'est précisément ce que S22a rend enfin possible en branchant l'envoi — jusqu'ici ce drapeau ne pouvait pas être activé faute d'email.

**Action de mise en production, amendée en S22m — l'ordre importe.** La consigne d'origine (« activer ce drapeau en même temps que le bloc SMTP ») est trop lâche, et le devient dangereusement maintenant que sept comptes existent dont six non vérifiés : le drapeau à `true` avec un envoi qui *ne marche pas* enferme dehors ces six comptes, sans qu'aucun puisse se délivrer lui-même le lien qui manque — le seul recours serait une intervention en base. La séquence est donc :

1. poser `ZEPTOMAIL_TOKEN`, redémarrer l'API ;
2. vérifier dans les journaux la ligne `Chemin d'envoi des emails : ZeptoMail (…)` ;
3. déclencher un envoi réel (réinitialisation de mot de passe sur une adresse qu'on relève) et **constater l'email reçu** ;
4. alors seulement, passer `AUTH_REQUIRE_EMAIL_VERIFICATION=true` et redémarrer.

Ce drapeau n'est **pas** activé par le lot S22m : c'est une bascule de production, elle appartient au décideur, et elle ne se prend qu'après l'étape 3 (rappel inscrit dans `.env.production.example`).

Note : `requireLocalEmailVerified` est marqué déprécié par better-auth, qui prévoit de rendre la garde inconditionnelle dans une version mineure ultérieure. Ce n'est pas un problème mais un calendrier : le jour où l'option disparaît, `AUTH_REQUIRE_EMAIL_VERIFICATION=true` devra déjà être en place. À surveiller à chaque montée de version.

## Procédure Google Cloud Console

À suivre à la lettre. Compter dix minutes. Aucun paiement, aucune carte bancaire.

> **Note de navigation.** Google a réorganisé cette partie de la console : la configuration
> OAuth vit désormais sous **« Google Auth Platform »**
> (<https://console.cloud.google.com/auth/overview>), découpée en *Branding*, *Audience*,
> *Clients* et *Accès aux données*. Les anciens chemins donnés ci-dessous
> (*API et services → Écran de consentement OAuth* / *Identifiants*) y redirigent, et
> **les valeurs à saisir sont identiques** dans les deux présentations. Correspondance :
> informations sur l'application → *Branding* ; type d'utilisateur et utilisateurs test →
> *Audience* ; champs d'application → *Accès aux données* ; ID client OAuth → *Clients*.

### 1. Projet

1. Ouvrir <https://console.cloud.google.com/>.
2. Sélecteur de projet (barre du haut) → **Nouveau projet**.
3. Nom : `Lalanda`. Organisation : laisser tel quel si aucune. → **Créer**.
4. Vérifier que le sélecteur affiche bien `Lalanda` avant de continuer : toutes les étapes suivantes s'appliquent au projet sélectionné.

### 2. Écran de consentement OAuth

Menu ☰ → **API et services** → **Écran de consentement OAuth**.

1. **Type d'utilisateur : `Externe`.** `Interne` n'est proposé qu'aux comptes Google Workspace et restreindrait la connexion aux seuls membres de votre organisation — ce n'est pas ce qu'on veut pour un produit ouvert. → **Créer**.
2. **Informations sur l'application :**
   - Nom de l'application : `Lalanda`
   - Adresse e-mail d'assistance utilisateur : votre adresse
   - Logo : facultatif. ⚠️ **Téléverser un logo déclenche une vérification Google de plusieurs semaines.** Ne pas en mettre tant que ce n'est pas nécessaire.
3. **Domaine de l'application :**
   - Page d'accueil : `https://app.lalanda.example`
   - Règles de confidentialité : `https://app.lalanda.example/confidentialite`
   - Conditions d'utilisation : `https://app.lalanda.example/conditions`
   - (Remplacer `app.lalanda.example` par le domaine réel de production.)
4. **Domaines autorisés :** ajouter `lalanda.example` (le domaine racine, sans `https://` ni sous-domaine).
5. Adresse e-mail du développeur : votre adresse. → **Enregistrer et continuer**.
6. **Champs d'application (scopes)** → **Ajouter ou supprimer des champs d'application**. Cocher **exactement ces trois** :
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `openid`

   Ce sont les scopes par défaut demandés par better-auth. **N'en ajouter aucun autre** : tout scope supplémentaire (Drive, Agenda, Contacts…) fait basculer l'application en « scopes sensibles » et impose une vérification Google avec justification écrite et audit de sécurité. → **Mettre à jour** → **Enregistrer et continuer**.
7. **Utilisateurs test :** tant que l'application est en mode `Test`, seules les adresses listées ici peuvent se connecter. Ajouter les adresses de l'équipe. → **Enregistrer et continuer**.
8. Relire le récapitulatif → **Revenir au tableau de bord**.

### 3. Identifiants (client OAuth)

Menu ☰ → **API et services** → **Identifiants** → **Créer des identifiants** → **ID client OAuth**.

1. **Type d'application : `Application Web`.** ⚠️ Ne pas choisir « Ordinateur de bureau », « Android » ni « iOS » : ces types ne délivrent pas de `client_secret` utilisable pour le flux serveur d'authorization code, et le flux échouerait.
2. Nom : `Lalanda — API`.
3. **Origines JavaScript autorisées** — les origines qui peuvent initier la requête. Ajouter :
   ```
   http://localhost:3000
   http://localhost:3001
   https://app.lalanda.example
   https://api.lalanda.example
   ```
4. **URI de redirection autorisés** — **le point où 90 % des erreurs se produisent.** Google compare la chaîne **exactement** : le moindre écart de casse, de barre oblique finale ou de schéma produit `Error 400: redirect_uri_mismatch`. Ajouter les deux, telles quelles :
   ```
   http://localhost:3001/auth/callback/google
   https://api.lalanda.example/auth/callback/google
   ```
   - Le chemin est `/auth/callback/google` : `/auth` est le `basePath` de better-auth (voir `apps/api/src/auth/auth.ts` et le montage dans `main.ts`), `callback/<provider>` est sa convention.
   - L'URI pointe vers l'**API** (`API_URL`), pas vers le front. C'est le serveur qui échange le code contre un jeton — le `client_secret` ne doit jamais transiter par un navigateur.
   - **Pas de barre oblique finale.** `…/google/` est une autre URI pour Google.
   - Si `API_URL` change, cette liste doit changer avec lui.
5. → **Créer**. Google affiche l'**ID client** et le **code secret du client**. Le secret n'est réaffichable qu'ici et dans la fiche de l'identifiant : le copier tout de suite.

### 4. Renseigner l'environnement

```bash
GOOGLE_CLIENT_ID=123456789-xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx
```

Dans `.env` en développement, dans `.env.production` (ou les secrets GitHub → Droplet, ADR-0009) en production. **Jamais dans le dépôt.** Redémarrer l'API : le bouton apparaît sur `/login` et `/register`.

**Contrôle en une commande**, avant même d'ouvrir le navigateur :

```bash
curl -s "$API_URL/auth-providers"    # attendu : {"google":true}
```

S'il répond `{"google":false}`, l'une des deux variables manque ou n'a pas été rechargée — un avertissement le dit explicitement dans les journaux de démarrage de l'API. Ce contrôle distingue une erreur de **configuration** (ici) d'une erreur de **déclaration chez Google** (`redirect_uri_mismatch`, qui n'apparaît qu'au clic).

### 5. Passage en production

Écran de consentement OAuth → **Publier l'application**. Tant que l'application reste en mode `Test`, seuls les utilisateurs test peuvent se connecter, et leurs jetons de rafraîchissement expirent au bout de sept jours. Avec les seuls scopes `email`/`profile`/`openid`, la publication est immédiate et **ne déclenche aucune vérification Google**.

## Conséquences

- **Rien ne devient obligatoire.** Sans les sept variables, l'API démarre, le bouton Google ne s'affiche pas, les emails sont journalisés et les opérations métier aboutissent en annonçant honnêtement que rien n'a été délivré. Une suite e2e dédiée retire les sept variables et le vérifie de bout en bout.
- **Le changement d'adresse email devient enfin terminable** par un utilisateur final (page publique `/verification-email`), à condition qu'un chemin d'envoi soit configuré (S22m : ZeptoMail ou SMTP). `notifiedAt` n'est renseigné que si l'envoi a **réellement** abouti : `verificationDelivered` ne ment pas.
- **Un compte perdu devient récupérable.** C'est la fin d'un manque qui rendait chaque oubli de mot de passe définitif.
- **`docs/17` § « Bloqué par l'absence de SMTP » est levé** dans son principe : le blocage n'est plus structurel, il est configurationnel.
- L'invitation continue de renvoyer son jeton dans la réponse de création, même avec SMTP actif : un email peut être classé en indésirable ou refusé par un domaine d'entreprise, et un lien copiable évite de rendre l'invitation dépendante d'une infrastructure qu'on ne maîtrise pas. Le champ `emailDelivered` dit lequel des deux chemins a fonctionné.
- Le `console.log` du jeton d'invitation est supprimé (`docs/17` § Journalisation : aucun secret dans les logs — ce jeton valait une entrée dans l'organisation).

### Limites connues

Écrites ici pour qu'elles ne soient pas redécouvertes en production comme des surprises :

- **Aucune reprise sur échec.** Un envoi qui échoue est journalisé, pas réessayé (option file d'attente écartée ci-dessus, et pas de bascule sur l'autre chemin — voir § 1 bis). Un incident de quelques minutes perd les messages émis pendant sa durée ; l'utilisateur peut redemander un lien, et une invitation reste récupérable par son lien copiable.
- **Aucune observabilité de délivrabilité côté produit** : ni taux d'ouverture, ni retour de rejet (*bounce*). SMTP ne les expose pas. ZeptoMail, lui, tient un journal d'envoi et des webhooks dans sa console — **non consommés par le code** : un rejet se constate donc dans l'interface Zoho, pas dans Lalanda. C'est un gain d'observabilité réel mais manuel, et il ne doit pas être confondu avec une intégration.
- **SPF, DKIM et DMARC sont hors périmètre du code.** Sans ces enregistrements DNS sur le domaine expéditeur, les messages partiront en indésirables quelle que soit la qualité du code (à traiter à la mise en service, docs/24). ZeptoMail impose en plus la **vérification du domaine expéditeur** dans sa console : tant qu'elle n'est pas faite, l'API refuse l'envoi — refus explicite, pas silencieux, mais bloquant.
- **Aucun envoi réel n'a été constaté par ce lot.** Il n'existe pas de jeton ZeptoMail dans cet environnement de développement. Tout ce qui est vérifié l'est hors ligne : la requête émise, les en-têtes, la charge, le traitement des quatre échecs. Que Zoho accepte un envoi reste à établir par l'étape 3 de la séquence ci-dessus.
- **Aucun quota propre aux envois.** `/auth/*` s'appuie sur la limitation de tentatives de better-auth ; rien ne borne spécifiquement le nombre d'emails qu'une même adresse peut faire déclencher. À revoir si le formulaire de réinitialisation devenait un vecteur de nuisance.
- **Un seul fournisseur social.** Microsoft et Apple ne sont pas branchés ; la structure les accepterait sans changement d'architecture.

## Plan de validation

Tests livrés avec le lot, tous sans le moindre envoi réseau :

| Propriété | Test |
| --- | --- |
| Liaison Google d'un compte inscrit par mot de passe, sans second compte | `apps/api/src/__tests__/google-auth.e2e.test.ts` — jeton d'identité signé par une clé RSA locale, JWKS de Google servi depuis un `fetch` détourné : le **vrai** chemin de better-auth est exercé |
| Refus de liaison si Google n'atteste pas l'adresse | idem — échoue si `trustedProviders` cesse d'être vide |
| Jeton de réinitialisation à usage unique | `apps/api/src/__tests__/password-reset.e2e.test.ts` |
| Jeton expiré refusé | idem — le jeton est vieilli en base plutôt que d'attendre 30 min |
| Aucune énumération d'adresses | idem — code **et** corps de réponse comparés entre adresse connue et inconnue |
| Révocation des sessions à la réinitialisation | idem |
| Démarrage sans aucune variable Google ni SMTP | `apps/api/src/__tests__/no-mail-no-google.e2e.test.ts` |
| Repli journal, cache et rotation du transporteur | `apps/api/src/mail/mail.transport.test.ts` (`nodemailer` remplacé par un module factice) |
| Variables toutes optionnelles, port illisible sans effet | `apps/api/src/mail/mail-credentials.provider.test.ts` |
| **S22m** — précédence ZeptoMail > SMTP > journal, expéditeur commun aux deux chemins, préfixe `Zoho-enczapikey` retiré | `apps/api/src/mail/mail-credentials.provider.test.ts` |
| **S22m** — charge ZeptoMail émise : `Zoho-enczapikey`, `from` découpé, `htmlbody` **et** `textbody`, jeton nulle part hors en-tête | `apps/api/src/mail/mail.transport.test.ts` — serveur HTTP local sur `127.0.0.1`, pas un `fetch` détourné |
| **S22m** — les quatre échecs : jeton absent, jeton refusé (401), erreur d'API (400), panne réseau. Aucun ne lève, tous sont journalisés | idem — un test vérifie la ligne de journal ET ce qui n'y figure pas (corps, jeton) |
| **S22m** — le test de connexion ne peut envoyer aucun email : charge `{}`, sans destinataire | `apps/api/src/integrations/connection-tests.test.ts` — rougit si la charge est « complétée » |
| Emails sans ressource distante, lien présent en texte, échappement des saisies | `apps/api/src/mail/mail.templates.test.ts` |
| « Les deux variables Google ou rien » | `apps/api/src/auth/google-config.test.ts` |

## Liens

- ADR-0006 — Authentification : better-auth (promesse Google)
- ADR-0009 — Infrastructure DigitalOcean (gestion des secrets, port 25 bloqué en sortie)
- ADR-0013 — Stockage des secrets d'intégration (fiche `zeptomail`, futur fournisseur d'identifiants d'envoi)
- Zoho ZeptoMail — API d'envoi : <https://www.zoho.com/zeptomail/help/api/email-sending.html>
- `docs/17-SECURITE.md` § Bloqué par l'absence de SMTP
- better-auth — liaison de comptes : <https://www.better-auth.com/docs/concepts/users-accounts#account-linking>
- Google — OAuth 2.0 pour applications web : <https://developers.google.com/identity/protocols/oauth2/web-server>
