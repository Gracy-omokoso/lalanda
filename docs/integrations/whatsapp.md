# Brancher WhatsApp sur Lalanda — guide pour la dirigeante

> Décision : [ADR-0065](../adr/ADR-0065-notifications-projets-par-whatsapp.md). Ce guide ne contient
> aucune clé : elles sont créées chez Meta et ne se recopient qu'à un seul endroit, la console `/admin`
> de Lalanda. Ne les envoyez jamais par e-mail ni par messagerie.

Lalanda envoie les notifications des Projets depuis **un seul numéro WhatsApp « Lalanda »**, commun à
toutes les organisations clientes. Vous le configurez **une fois** pour toute la plateforme. Ensuite,
chaque membre saisit **son** numéro dans Projets › Paramètres › Mes notifications et le confirme par
un code reçu sur WhatsApp.

Comptez une à deux semaines : la vérification de l'entreprise et l'approbation des modèles par Meta
prennent du temps.

## Étape 1 — Créer l'application Meta

1. Ouvrez <https://business.facebook.com> et vérifiez que le **portefeuille Business** de Go freelance
   existe (Paramètres › Infos sur l'entreprise). Sinon, créez-le.
2. Ouvrez <https://developers.facebook.com/apps> › **Créer une app**.
3. Cas d'usage : **Autre** › type **Business** (Entreprise). Nom : `Lalanda`. Portefeuille Business :
   celui de Go freelance. **Créer l'app**.
4. Dans le tableau de bord de l'app, produit **WhatsApp** › **Configurer**. Meta crée un **compte
   WhatsApp Business** rattaché au portefeuille.

## Étape 2 — Le numéro de téléphone

1. **WhatsApp › Configuration de l'API** (« API Setup ») › **Ajouter un numéro de téléphone**.
2. Utilisez un numéro **dédié** à Lalanda (une puce qui n'est **pas** déjà utilisée dans l'application
   WhatsApp ou WhatsApp Business d'un téléphone). Nom affiché : `Lalanda`. Catégorie : logiciel /
   services professionnels.
3. Confirmez le numéro par le code reçu par SMS ou appel.
4. Sur la même page, notez (ce ne sont pas des secrets, mais ne les diffusez pas) :
   - **Identifiant du numéro de téléphone** (« Phone number ID ») ;
   - **Identifiant du compte WhatsApp Business** (« WhatsApp Business Account ID »).

Le numéro de test fourni par Meta ne sert qu'aux essais : il n'écrit qu'à cinq numéros déclarés.

## Étape 3 — Vérification de l'entreprise

1. Portefeuille Business › **Centre de sécurité** › **Vérification de l'entreprise** › **Démarrer**.
2. Fournissez les documents de Go freelance SARLU (RCCM, identification nationale, justificatif
   d'adresse, site web et nom de domaine). Meta répond en quelques jours.
3. Tant que l'entreprise n'est pas vérifiée, Meta limite fortement le nombre de destinataires par jour.

## Étape 4 — Le jeton système permanent

Le jeton temporaire de la page « Configuration de l'API » expire en 24 heures : **ne l'utilisez pas**.

1. Portefeuille Business › **Paramètres** › **Utilisateurs** › **Utilisateurs système** › **Ajouter**.
   Nom : `lalanda-whatsapp`, rôle **Administrateur**.
2. **Ajouter des éléments** : l'app `Lalanda` (contrôle total) et le compte WhatsApp Business (contrôle
   total).
3. **Générer un nouveau jeton** › app `Lalanda` › expiration **Jamais** › cochez exactement les deux
   permissions :
   - `whatsapp_business_messaging` ;
   - `whatsapp_business_management`.
4. Copiez le jeton **une seule fois**, directement dans `/admin` (étape 7). Il ne se réaffiche pas.
5. Dans l'app Meta : **Paramètres de l'app** › **Général** › **Clé secrète** › **Afficher**. Elle sert
   à vérifier les webhooks (étape 7, champ « Clé secrète de l'application Meta »).

## Étape 5 — Soumettre les modèles de message

Hors des 24 heures qui suivent un message de la personne, Meta n'accepte que des **modèles
approuvés**. Lalanda en utilise cinq, en **français** (langue `fr`). Pour chacun :
**WhatsApp Manager** › **Modèles de message** › **Créer un modèle**, puis recopiez **exactement** le
nom, la catégorie, le texte, les exemples et le bouton ci-dessous. Un caractère différent et Meta
refusera l'envoi (`132001`).

Le texte entre `{{ }}` est remplacé par Lalanda à l'envoi ; à la soumission, Meta demande un exemple
pour chaque variable.

### `lalanda_tache_assignee` — catégorie **Utilitaire**

Corps :

```text
Bonjour, une tâche vous a été assignée dans Lalanda.

Tâche : {{1}}
Projet : {{2}}
Organisation : {{3}}

Ouvrez Lalanda pour la consulter.
```

Exemples : `{{1}}` = `#12 Maquette de l’accueil — assignée par Gracy` · `{{2}}` = `Refonte du site`
· `{{3}}` = `Go freelance`.

Pied de page : `Répondez STOP pour ne plus recevoir ces messages.`

Bouton : **Visiter le site web** › texte `Ouvrir dans Lalanda` › URL **dynamique**
`https://app.lalanda.co/{{1}}` › exemple
`projets/6650a1b2c3d4e5f601234567?tache=6650a1b2c3d4e5f601234568`.

### `lalanda_mention` — catégorie **Utilitaire**

Corps :

```text
Bonjour, vous avez été mentionné dans Lalanda.

Sujet : {{1}}
Projet : {{2}}
Organisation : {{3}}

Ouvrez Lalanda pour répondre.
```

Exemples : `{{1}}` = `Gracy vous a mentionné sur #12 Maquette` · `{{2}}` = `Refonte du site` ·
`{{3}}` = `Go freelance`.

Pied de page et bouton : identiques à `lalanda_tache_assignee`.

### `lalanda_echeance_depassee` — catégorie **Utilitaire**

Corps :

```text
Bonjour, l’échéance d’une de vos tâches est dépassée.

Tâche : {{1}}
Projet : {{2}}
Organisation : {{3}}

Ouvrez Lalanda pour la mettre à jour.
```

Exemples : `{{1}}` = `#12 Maquette de l’accueil` · `{{2}}` = `Refonte du site` · `{{3}}` =
`Go freelance`.

Pied de page et bouton : identiques à `lalanda_tache_assignee`.

### `lalanda_notification_projet` — catégorie **Utilitaire**

Pour les autres événements (commentaire, échéance proche, changement de colonne, ajout à un projet,
projet à risque).

Corps :

```text
Bonjour, vous avez une nouvelle notification des Projets dans Lalanda.

Événement : {{1}}
Détail : {{2}}
Projet : {{3}}
Organisation : {{4}}

Ouvrez Lalanda pour en savoir plus.
```

Exemples : `{{1}}` = `Commentaire sur une tâche que je suis` · `{{2}}` =
`Gracy a commenté #12 Maquette` · `{{3}}` = `Refonte du site` · `{{4}}` = `Go freelance`.

Pied de page et bouton : identiques à `lalanda_tache_assignee`.

### `lalanda_code_verification` — catégorie **Authentification**

Meta impose le texte des modèles d'authentification ; vous ne choisissez que les options. Cochez :

- **Ajouter une recommandation de sécurité** ;
- **Ajouter une date d'expiration au code** : **10 minutes** ;
- type de bouton **Copier le code**, texte `Copier le code`.

Le message reçu ressemble à :

```text
*{{1}}* est votre code de vérification. Pour votre sécurité, ne communiquez pas ce code.
```

avec en pied de page `Ce code expire dans 10 minutes.` Exemple : `{{1}}` = `482913`.

Attendez le statut **Approuvé** des cinq modèles avant d'activer l'intégration.

## Étape 6 — Configurer le webhook

1. App Meta › **WhatsApp** › **Configuration** › **Webhook** › **Modifier**.
2. **URL de rappel** : `https://api.lalanda.co/whatsapp/webhook`
3. **Jeton de vérification** : une phrase de votre choix, **16 caractères au moins**, sans espace (par
   exemple générée par un gestionnaire de mots de passe). Gardez-la pour l'étape 7.
4. **Vérifier et enregistrer** : Meta appelle Lalanda, qui répond seulement si le jeton est identique.
   Faites donc l'étape 7 **avant** ce clic (ou recommencez après).
5. **Champs du webhook** › abonnez-vous au champ **`messages`** (statuts de livraison et réponses
   « STOP »).

## Étape 7 — Saisir les valeurs dans `/admin`

1. Connectez-vous à <https://app.lalanda.co/admin> (double authentification, mot de passe redemandé).
2. **Intégrations** › **WhatsApp (numéro Lalanda, Meta)**.
3. Remplissez :

   | Champ dans `/admin` | Valeur | Où la trouver |
   |---|---|---|
   | Identifiant du numéro de téléphone (`phoneNumberId`) | chiffres | étape 2 |
   | Identifiant du compte WhatsApp Business (`businessAccountId`) | chiffres | étape 2 |
   | Version de la Graph API (`apiVersion`) | facultatif (`v24.0` par défaut) | — |
   | Plafond mensuel d'envois par organisation (`monthlyLimitPerOrganization`) | facultatif (1 000 par défaut) | votre choix |
   | Jeton d'accès permanent (`accessToken`) | secret | étape 4 |
   | Clé secrète de l'application Meta (`appSecret`) | secret | étape 4, point 5 |
   | Jeton de vérification du webhook (`verifyToken`) | secret | étape 6, point 3 |

4. **Tester** : Lalanda lit la fiche du numéro chez Meta avec le jeton. **Aucun message n'est envoyé,
   rien n'est facturé.** Enregistrez, puis **activez** l'intégration.
5. Revenez à l'étape 6, point 4.

Les secrets sont chiffrés ; personne ne peut les relire, pas même depuis `/admin` (seuls les 4 derniers
caractères s'affichent).

## Ensuite

- **Chaque membre** : Projets › Paramètres › Mes notifications › bloc **WhatsApp** › saisir son
  numéro (`+243…` proposé) › **Recevoir un code** › saisir le code. La colonne **WhatsApp** s'active :
  par défaut, tâche assignée, mention et échéance dépassée. « STOP » en réponse coupe tout.
- **Coût** : Meta facture chaque conversation (tarif par pays, visible dans WhatsApp Manager ›
  Analyses). Chaque organisation est plafonnée (`monthlyLimitPerOrganization`, codes compris) ;
  au-delà, plus rien ne part jusqu'au mois suivant et l'écran le dit.
- **Jeton refusé** : si Meta refuse le jeton pendant un envoi, l'intégration apparaît **en échec**
  dans `/admin` et WhatsApp est suspendu pour tous. Générez un nouveau jeton (étape 4), saisissez-le
  et **Testez** : les envois reprennent.
- **Tout couper d'urgence** : désactiver l'intégration dans `/admin` (effet en moins d'une minute) ou
  poser `WHATSAPP_ENABLED=false` dans l'environnement de l'API. Plus aucun message ne part ; les
  numéros restent enregistrés et les « STOP » continuent d'être pris en compte.

## Pour l'équipe technique

- Développement : `WHATSAPP_API_BASE_URL=http://127.0.0.1:<port>` branche un faux Meta local (ignoré
  en production). Sous vitest, aucun appel réel ne peut partir.
- Les textes ci-dessus sont ceux de `apps/api/src/whatsapp/whatsapp-templates.ts` ; le test
  `whatsapp.unit.test.ts` vérifie qu'ils sont recopiés ici à l'identique.
