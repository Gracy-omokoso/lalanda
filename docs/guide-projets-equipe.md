# Guide de l'équipe — Projets et Mes tâches dans Lalanda

Une page pour démarrer. Menu de gauche : **RUN › Opérations › Projets** (sous-entrées « Mes
tâches », « Tous les projets » et « Paramètres »).

## 1. Avant de commencer : le bon rôle

La dirigeante invite chaque membre dans **Organisation › Membres › Inviter un membre** (adresse
e-mail et **Rôle**). Après l'envoi, un **lien d'invitation** s'affiche : on peut le copier et
l'envoyer autrement (WhatsApp) si l'e-mail tarde. Le membre crée son compte avec **la même adresse**,
puis accepte l'invitation (bandeau en haut de l'écran, ou le lien).

**Le bon rôle** (depuis la v1.14.0, ADR-0059) : le rôle proposé par défaut est **Salarié**. Un
Salarié **voit les projets, coche ses tâches, commente, en est responsable et saisit son temps** ; il
demande aussi ses congés, déclare ses frais et pointe. Il **ne voit aucune donnée financière** (ni
ventes, ni trésorerie, ni achats, ni comptabilité). Selon la personne :

| Rôle | Pour qui | Projets et tâches |
|---|---|---|
| **Salarié** (défaut) | tout membre du personnel | voit, coche, commente, saisit son temps |
| **Manager / Chef d'équipe** | qui pilote une équipe ou des projets | comme le Salarié, et **crée, règle, archive** des projets |
| **Stagiaire** | stagiaire, apprenti | comme le Salarié, mais **ne s'assigne qu'à lui-même** une tâche (ou la laisse sans responsable) |
| **Invité externe** | client, freelance | voit et fait avancer les projets et les tâches, rien d'autre |
| Commercial, Comptable, Responsable RH, Magasinier, Analyste | selon le métier | travaillent sur les tâches, sans régler les projets |

Créer, archiver ou régler un projet : Propriétaire, Administrateur, Directeur financier et Manager /
Chef d'équipe. Le **Lecteur** voit les projets mais ne peut ni cocher une tâche ni en être
responsable. Les rôles Conseiller, Chef de projet (plans financiers) et Expert-comptable externe
n'ont pas accès aux projets.

**Ajuster une personne** : dans **Organisation › Membres**, « Voir les autorisations » sur sa ligne ;
cochez ou décochez une autorisation, puis cliquez sur **Enregistrer les autorisations** (rien n'est
appliqué avant). À l'invitation, « Personnaliser les autorisations » fait la même chose.

> L'Invité externe ne voit **que les projets où il est ajouté** (personnellement ou par une équipe),
> quelle que soit leur visibilité. Ajoutez-le au projet après avoir accepté son invitation.

## 2. Créer un projet

**Projets › Nouveau projet** : nom, nature (client ou interne), responsable, début, échéance,
description ; pour un projet client, le client, le devis accepté et l'opportunité si votre rôle les
voit. Le projet s'ouvre sur son **Aperçu** ; les onglets **Liste**, **Tableau**, **Chronologie**, **Calendrier**, **Fichiers** donnent les autres vues.

L'accueil **Projets** montre tous les projets : statut (**En bonne voie**, **À risque**, **En
retard**), avancement (tâches terminées), membres, échéance et tâches en retard. Filtres **Mes
projets · Tous · Archivés** et recherche par nom ou client. En haut : projets actifs, tâches en
retard, tâches terminées cette semaine.

- **En retard** : l'échéance du projet est passée avec des tâches ouvertes, ou au moins 3 tâches
  sont en retard et elles font au moins le quart des tâches ouvertes.
- **À risque** : au moins une tâche est en retard, ou l'échéance du projet tombe dans les 7 jours
  avec moins de 75 % des tâches terminées.
- Le même statut s'affiche sur l'accueil et dans l'Aperçu du projet.

## 2 bis. Importer un fichier

Vous avez déjà votre plan dans Excel ? **Projets › Nouveau projet › Importer un fichier** (ou, dans un
projet, onglet **Liste › Importer des tâches**).

1. Téléchargez le **modèle** (Excel ou CSV). L'onglet **Guide** explique chaque colonne ; l'onglet
   **Tâches** montre un exemple (ouverture d'une boutique à Kinshasa). Une ligne par tâche ; seule la
   colonne **Tâche** est obligatoire. Dates en **JJ/MM/AAAA**. Responsable = **adresse e-mail** d'un
   membre. **Dépend de** et **Sous-tâche de** : le **numéro de ligne** du fichier (l'en-tête est la
   ligne 1) ou le nom exact de la tâche. Priorité : Basse, Moyenne, Haute, Urgente. Jalon : Oui/Non.
   Estimation : en heures (1,5 ou 1h30).
2. Choisissez votre fichier : Lalanda affiche un **aperçu** — rien n'est encore créé. Chaque ligne est
   **Prête**, **Corrigée** (par exemple : responsable inconnu → importée sans responsable ; dépendance
   introuvable → ignorée) ou **Écartée** (par exemple : date illisible). Corrigez le fichier et
   choisissez-le de nouveau, ou cochez la case pour importer seulement les lignes valides.
3. **Importer** : tout est créé d'un coup (ou rien, en cas d'incident). Les sections inconnues
   deviennent des colonnes du Tableau, les étiquettes inconnues sont créées. Chaque personne reçoit
   **une seule** notification pour l'ensemble (« 12 tâches vous ont été assignées dans le projet X »),
   par la cloche, l'e-mail ou Slack selon ses réglages — pas une par tâche.

Limites : 2 Mo, 2 000 lignes, pas de macro ni de formule (seules les valeurs sont lues). Seuls ceux qui
peuvent **gérer** les projets créent un projet ou de nouvelles sections et étiquettes.

## 2 ter. Construire avec l'IA

**Projets › Nouveau projet › Construire avec l'IA** : nom, dates de début et **butoir**, **objectif**,
contexte, livrables, contraintes et risques, **équipe** (l'IA ne voit que les prénoms), durée des
sprints (1, 2 ou 3 semaines), niveau de détail. **Proposer un plan**.

L'IA **propose** des jalons, des sprints et des tâches (avec estimation, priorité, dépendances et un
responsable parmi l'équipe choisie). Lalanda vérifie la proposition : les dates viennent du calendrier
des sprints, une date hors de la période est ramenée, une boucle de dépendances est cassée, un
responsable inconnu est retiré — chaque correction est listée. **Relisez** : changez un titre, une
échéance ou un responsable, retirez une tâche, ou **Régénérez** (chaque proposition compte un message
IA dans le quota du mois). Rien n'est créé tant que vous n'avez pas cliqué **Créer le projet**.

Les sprints deviennent des **étiquettes « Sprint 1 », « Sprint 2 »…** : filtrez la Liste ou le
Tableau par étiquette pour voir un sprint. Leurs dates et objectifs sont dans la description du projet.

## 3. Membres d'un projet et visibilité (ADR-0060)

Dans un projet, le bouton **Partager** (en haut à droite) ouvre **Membres et accès** :

- **Qui voit ce projet ?** — **Toute l'organisation** (par défaut : tous ceux qui ont accès aux
  Projets) ou **Membres seulement** (projet **privé**, marqué d'un cadenas « Privé »). Un projet
  privé n'est visible que de ses membres, de son responsable et de la direction (Propriétaire,
  Administrateur) : pour les autres, il **n'existe pas** (ni dans les listes, ni dans la recherche,
  ni dans Mes tâches, le calendrier, les notifications ou le brief du matin).
- **Ajouter une personne** : un membre de l'organisation qui a accès aux Projets.
- **Ajouter une équipe entière** (équipes créées dans **RH › Équipes**) : tous ses membres
  accèdent au projet, **y compris ceux qui rejoindront l'équipe plus tard** ; quitter l'équipe, ou
  retirer l'équipe du projet, retire l'accès.
- Seuls les gestionnaires (Propriétaire, Administrateur, Directeur financier) modifient les membres
  et la visibilité ; chacun voit qui a accès.

Une personne apparaît aussi sur la ligne du projet quand elle en est **responsable** ou qu'on lui
**assigne une tâche**. La visibilité se choisit aussi dans **Nouveau projet**.

## 3 bis. Équipes (RH › Équipes)

Une **équipe** regroupe des personnes qui travaillent ensemble, **au-delà des services** (ex. « Équipe
chantier » : un poseur, un commercial, la responsable des achats). **RH › Équipes › Nouvelle
équipe** : nom, description, responsable (il fait partie de l'équipe), puis **Ajouter un membre**.
Les responsables RH et la direction gèrent les équipes ; ceux qui lisent les dossiers RH les
consultent. La fiche dit à combien de projets l'équipe est ajoutée.

**Le responsable d'une équipe valide son équipe** (ADR-0066) : il voit dans **RH › Mon espace ›
Absences à valider** et **Frais à valider** (et dans Mes tâches) les demandes d'absence, notes de
frais et avances de frais des membres de son équipe, et les valide à l'étape « manager » — comme le
manager inscrit sur leur fiche. L'étape RH ou comptable suivante reste nécessaire si votre
organisation l'a prévue. Il ne valide jamais ses propres demandes, ne voit pas les dossiers de ses
membres, ni les avances sur salaire. Retiré de l'équipe, il ne voit plus rien.
*À savoir* : l'étape « manager » n'existe que si la fiche du collaborateur a un manager renseigné
(RH › Collaborateurs) ; sinon la demande va directement aux RH.

## 4. Créer, assigner et cocher une tâche

1. Dans l'onglet **Liste** (ou **Tableau**), **« + Ajouter une tâche »** en bas d'une section :
   tapez le titre, **Entrée** — le champ reste ouvert pour enchaîner la suivante, **Échap** le ferme.
2. Cliquez la ligne (ailleurs que sur le titre, qui se modifie sur place) ou **Détails** : le
   panneau de la tâche s'ouvre à droite. Choisissez le **Responsable**, l'**Échéance**,
   la **Priorité**, une description. Chaque champ s'enregistre dès qu'on le change (pas de bouton
   « Enregistrer »).
3. Le responsable reçoit une **notification** (cloche en haut à droite) qui ouvre la tâche.
   Le sélecteur ne propose que les personnes **qui voient le projet**. Dans un projet privé, un
   gestionnaire qui assigne quelqu'un hors du projet l'**ajoute aux membres** (il est prévenu) ;
   les autres voient « N personnes ne voient pas ce projet » et demandent l'ajout. Un **Stagiaire**
   ne voit que « Moi » : il prend une tâche libre ou la rend, mais ne la donne pas à un collègue.
4. Pour terminer : cochez la tâche (dans le projet, ou d'un clic sur le **cercle** dans Mes tâches).

## 5. Commenter et mentionner

Dans le panneau de la tâche, zone **« Écrire un commentaire… »** : tapez **@** puis choisissez le
membre dans la liste, écrivez, puis **Commenter**. La personne mentionnée reçoit une notification ;
les abonnés de la tâche (son créateur, ceux qui ont commenté) sont prévenus aussi.

## 6. Mes tâches

**Mes tâches** rassemble les tâches qui vous sont assignées, tous projets confondus, en
**En retard · Aujourd'hui · Cette semaine** (jusqu'à dimanche) **· Plus tard · Sans échéance**.

- Un clic sur le **cercle** termine la tâche ; un clic sur la ligne l'ouvre.
- **« ＋ Ajouter une tâche… »** en haut : titre, projet, échéance facultative — la tâche vous est
  assignée.
- Onglets **Liste · Calendrier · Temps** : le calendrier pose vos tâches sur leur échéance ; l'onglet
  Temps montre votre semaine (temps saisi, absences, jours fériés), en lecture.
- Y figurent aussi les relances du CRM et les validations qui vous attendent (achats, absences…),
  chacune avec sa pastille.

## 7. Saisir son temps

Dans le panneau d'une tâche, section **Temps passé** : **Jour**, **Durée** (par exemple `1h30`),
**Note** facultative, puis **Saisir**. Pas de jour futur. Le total s'affiche sur la tâche et dans
l'onglet **Temps** de Mes tâches.

## 8. Paramètres (Projets › Paramètres, ADR-0061)

**Mes notifications** (chacun pour soi) : pour chaque événement — tâche assignée, mention,
commentaire sur une tâche suivie, échéance proche, échéance dépassée, statut d'une de mes tâches
changé, ajout à un projet, projet passé à risque — **Cloche** oui/non et **E-mail** oui/non. Par
défaut : cloche partout ; e-mail pour l'assignation, la mention et l'échéance dépassée.
**Résumé quotidien par e-mail** : vos tâches en retard, du jour et proches, à l'heure choisie
(Kinshasa), une fois par jour, les jours ouvrés seulement si vous le cochez.

**Comportement des projets** (gestionnaires) : qui peut créer un projet (la direction le peut
toujours), visibilité et vue par défaut (Aperçu, Liste ou Tableau) des nouveaux projets, **jours
ouvrés** (l'« échéance proche » compte des jours ouvrés : un vendredi, « 1 jour » atteint le lundi),
délai d'échéance proche, **archivage automatique** des projets terminés après N jours (ou jamais),
modification et suppression des commentaires des autres par les gestionnaires, affichage des
numéros de tâche (#12) — sur le Tableau, le panneau, la **Chronologie** et le **Calendrier**.

## 8 bis. Slack (ADR-0064)

Les notifications des Projets peuvent aussi arriver **dans Slack**, en message privé du bot
« Lalanda ».

- **Connecter** (Propriétaire ou Administrateur) : Projets › Paramètres › onglet **Slack** ›
  **Connecter Slack**, choisir l'espace Slack de l'organisation, **Autoriser**. L'écran affiche
  l'espace connecté, qui l'a connecté et quand. **Déconnecter** coupe tout et révoque l'accès. Si
  l'onglet dit « Slack n'est pas encore disponible », l'application Slack de la plateforme n'est pas
  encore configurée : rien ne change pour la cloche et l'e-mail.
- **Mes notifications** : une colonne **Slack** apparaît une fois l'organisation connectée. Par
  défaut : tâche assignée et mention. Le résumé quotidien reste par e-mail.
- Vous êtes retrouvé dans Slack **par votre adresse e-mail Lalanda** ; avec une autre adresse dans
  Slack, vous ne recevez rien.
- **Canal d'un projet** (gestionnaires) : Réglages du projet › **Canal Slack** › choisir un canal
  public (ou coller son identifiant `C…`) › **Publier dans ce canal**. Le canal reçoit les tâches
  assignées et déplacées et l'alerte « projet à risque ». Pour un projet **privé**, il faut cocher
  la confirmation : tout le canal verra ses événements.
- **« À reconnecter »** : Slack a retiré l'accès ; le Propriétaire clique **Reconnecter Slack**.

Pour la dirigeante (création de l'application Slack, identifiants à saisir dans `/admin`) :
[docs/integrations/slack.md](integrations/slack.md).

## 8 ter. WhatsApp (ADR-0065)

Les notifications importantes des Projets peuvent arriver **sur WhatsApp**, depuis le numéro
« Lalanda ».

- **Votre numéro** : Projets › Paramètres › **Mes notifications** › bloc **WhatsApp** › saisissez votre
  numéro (`+243 81 …` ; un numéro commençant par `0` est compris) › **Recevoir un code** › saisissez le
  code à 6 chiffres reçu sur WhatsApp › **Vérifier**. Le code vaut 10 minutes ; 5 essais ; 3 codes par
  heure au plus.
- **Votre numéro reste privé** : aucun autre membre, ni le Propriétaire, ne le voit.
- **Quels messages** : une fois le numéro vérifié, la colonne **WhatsApp** s'active. Par défaut :
  tâche assignée, mention, échéance dépassée. Vous ne recevez jamais vos propres gestes, ni rien
  d'un projet que vous ne voyez pas. Le résumé quotidien reste par e-mail.
- **Tout arrêter** : répondez **STOP** (ou **ARRET**) à un message de Lalanda, ou **Retirer mon
  numéro**. Pour reprendre après un STOP, redemandez un code.
- **« À vérifier »** : WhatsApp n'a pas pu remettre un message à ce numéro ; vérifiez-le et
  redemandez un code.
- **Plafond atteint** : l'organisation a envoyé son quota de messages WhatsApp du mois ; la cloche
  et l'e-mail continuent.
- Si le bloc dit « WhatsApp n'est pas encore disponible », la plateforme n'est pas encore branchée :
  rien ne change pour vos autres notifications.

Pour la dirigeante (compte Meta, modèles à faire approuver, valeurs à saisir dans `/admin`) :
[docs/integrations/whatsapp.md](integrations/whatsapp.md).

## 9. Couleur des cartes (post-it)

Dans le panneau d'une tâche, ligne **Couleur** : 8 teintes pastel (jaune, abricot, rose, lilas,
bleu, menthe, vert, gris) ou **Aucune**. La carte du **Tableau** prend la couleur (fond et liseré) ;
la **Liste** montre une petite pastille. Les teintes restent lisibles en Lalanda, Lagune et Ébène.

## Bon à savoir

- Les rappels « échéance proche » et « en retard » arrivent dans la cloche, et par e-mail si vous
  l'avez choisi (« échéance dépassée » : e-mail activé par défaut).
- Archiver un projet le retire des listes et de Mes tâches ; on le retrouve sous **Archivés**.
