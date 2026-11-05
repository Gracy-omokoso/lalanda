# Brancher Slack sur Lalanda — guide pour la dirigeante

> Décision : [ADR-0064](../adr/ADR-0064-notifications-projets-par-slack.md). Ce guide ne contient
> aucune clé : elles sont créées par Slack et ne se recopient qu'à un seul endroit, la console
> `/admin` de Lalanda.

Il y a **deux étapes**, faites par deux personnes différentes :

1. **Une seule fois pour toute la plateforme** (vous, en super-administratrice) : créer l'application
   Slack « Lalanda » et coller ses identifiants dans `/admin`.
2. **Une fois par organisation cliente** (son Propriétaire ou son Administrateur) : connecter **son**
   espace Slack depuis Projets › Paramètres › Slack.

## Étape 1 — Créer l'application Slack « Lalanda » (une seule fois)

1. Ouvrez <https://api.slack.com/apps> en étant connectée à un espace Slack de Go freelance.
2. **Create New App** › **From a manifest** › choisissez l'espace › onglet **YAML**.
3. Collez le contenu de [`slack-app-manifest.yml`](slack-app-manifest.yml) tel quel, puis **Next** ›
   **Create**.
4. Slack peut afficher « URL didn't respond » à côté de l'adresse des événements : c'est normal tant que
   l'étape 2 ci-dessous n'est pas faite. Revenez dans **Event Subscriptions** après l'étape 2 et cliquez
   **Retry** : la case doit passer à **Verified**.
5. Page **Basic Information**, section **App Credentials**, notez (sans les envoyer par e-mail ni
   messagerie) :
   - **Client ID** ;
   - **Client Secret** (bouton **Show**) ;
   - **Signing Secret** (bouton **Show**).
6. Page **Manage Distribution** : cochez les quatre vérifications puis **Activate Public
   Distribution**. Sans cela, seul votre propre espace Slack pourrait installer l'application.

## Étape 2 — Saisir les identifiants dans Lalanda (une seule fois)

1. Connectez-vous à <https://app.lalanda.co/admin> (double authentification et mot de passe redemandé).
2. **Intégrations** › **Slack (application Lalanda)**.
3. Remplissez :

   | Champ dans `/admin` | Valeur à coller (page Basic Information de Slack) |
   |---|---|
   | Identifiant client (`clientId`) | Client ID |
   | Secret client (`clientSecret`) | Client Secret |
   | Secret de signature (`signingSecret`) | Signing Secret |

4. **Tester** : Lalanda vérifie les identifiants auprès de Slack sans rien installer. Enregistrez,
   puis **activez** l'intégration.
5. Retournez à l'étape 1, point 4 (**Retry** sur l'adresse des événements).

Les secrets sont chiffrés ; personne ne peut les relire, pas même depuis `/admin` (seuls les 4 derniers
caractères s'affichent). Pour les changer : en générer de nouveaux chez Slack (**Regenerate**) et les
ressaisir.

**Tout couper d'urgence** : désactiver l'intégration Slack dans `/admin` (effet en moins d'une
minute), ou poser `SLACK_ENABLED=false` dans l'environnement de l'API. Plus aucun message ne part ; les
connexions des organisations restent enregistrées et reprennent quand on rallume.

## Étape 3 — Connecter l'espace Slack d'une organisation

Réservé au **Propriétaire** et à l'**Administrateur** de l'organisation.

1. Lalanda › **Projets** › **Paramètres** › onglet **Slack**.
2. **Connecter Slack** : Slack s'ouvre, choisissez l'espace de **votre** organisation (en haut à
   droite), vérifiez les autorisations demandées, **Autoriser**.
3. Vous revenez sur l'écran : « Espace Slack connecté », avec le nom de l'espace, qui l'a connecté et
   quand.
4. Chaque membre règle ensuite la colonne **Slack** dans **Mes notifications** (par défaut : tâche
   assignée et mention).
5. Facultatif, par projet : **Réglages** du projet › **Canal Slack** › choisir un canal public ›
   **Publier dans ce canal**. Pour un projet **privé**, une case de confirmation est obligatoire : tout
   le canal verra ses événements.

Un membre est retrouvé dans Slack **par son adresse e-mail Lalanda**. S'il utilise une autre adresse
dans Slack, il ne reçoit rien (le compteur « introuvable » de l'onglet Slack augmente).

**« À reconnecter »** : Slack a retiré l'accès (application désinstallée, jeton révoqué). Cliquez
**Reconnecter Slack**. **Déconnecter** révoque l'accès et efface le jeton.

## En développement

Aucun appel réel à Slack dans les tests. Pour essayer à la main, un faux Slack local peut être branché
par `SLACK_API_BASE_URL=http://127.0.0.1:<port>/api` (ignoré en production).
