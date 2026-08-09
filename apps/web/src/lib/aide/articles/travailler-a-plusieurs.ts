// Article « Travailler à plusieurs ».
//
// Sources vérifiées dans le code au moment de la rédaction :
//  - rôles et matrice : apps/api/src/authz/permissions.ts (8 rôles org, 15
//    actions, libellés FR, R1 dernier propriétaire, R2 séparation des tâches,
//    R7 anti-escalade, project_manager NON ATTRIBUABLE)
//  - invitations : apps/api/src/organizations/invitations.controller.ts et
//    invitations.service.ts (TTL 7 jours, rôle viewer par défaut, correspondance
//    d'adresse obligatoire) + apps/web/.../members/_components/invite-panel.tsx
//  - restrictions par projet : permissions.ts (`allow_project` se comporte comme
//    `allow`) — AUCUNE collection d'assignation de projet n'existe.
//
// TROIS LIMITES CRITIQUES écrites ici telles qu'elles sont AUJOURD'HUI :
//   1. aucun envoi d'email n'existe dans le dépôt (aucune dépendance SMTP,
//      aucune variable d'environnement) : l'invitation se transmet par un lien
//      copié à la main. Un développement est en cours en parallèle — ne pas
//      décrire l'état futur ;
//   2. le changement d'adresse email ne peut pas aboutir, pour la même raison,
//      et c'est délibéré (appliquer sans vérification ouvrirait une prise de
//      compte) ;
//   3. les restrictions par projet ne sont pas implémentées : l'isolation réelle
//      est par ORGANISATION.

import type { ArticleAide } from '../types';

export const TRAVAILLER_A_PLUSIEURS: ArticleAide = {
  slug: 'travailler-a-plusieurs',
  titre: 'Travailler à plusieurs',
  resume:
    'Inviter un associé, un comptable ou un conseiller, et choisir ce que chacun peut voir et faire.',
  ordre: 6,
  sections: [
    {
      id: 'organisation',
      titre: 'L’organisation, votre espace de travail',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Tous vos projets appartiennent à une **organisation**. C’est elle qui porte les membres, les droits et l’abonnement. Un projet n’existe jamais tout seul : il est toujours dans une organisation, et c’est la frontière qui protège vos données — un membre d’une autre organisation ne peut rien voir de la vôtre.',
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'La cloison est l’organisation, pas le projet',
          texte:
            'Il n’est **pas possible aujourd’hui de limiter un membre à certains projets**. Toute personne que vous invitez voit **tous les projets de l’organisation**, dans la limite de ce que son rôle autorise. Si vous devez réellement cloisonner deux dossiers — par exemple deux associés différents sur deux affaires —, **créez deux organisations distinctes**. C’est aujourd’hui le seul moyen.',
        },
      ],
    },
    {
      id: 'inviter',
      titre: 'Inviter quelqu’un',
      blocs: [
        {
          type: 'note',
          ton: 'limite',
          titre: 'L’invitation ne part pas par email : vous transmettez le lien vous-même',
          texte:
            'Aucun service d’envoi d’emails n’est branché sur Lalanda à ce jour. Quand vous créez une invitation, **aucun message n’est envoyé**. L’application affiche un **lien d’invitation** que vous devez copier et transmettre vous-même — par WhatsApp, SMS ou votre propre messagerie. Ce n’est pas une panne : c’est l’état actuel du produit.',
        },
        {
          type: 'etapes',
          items: [
            {
              titre: 'Créez l’invitation',
              texte:
                'Depuis l’espace **Membres**, indiquez l’adresse email de la personne et choisissez son rôle. Le rôle proposé par défaut est **Lecteur**, le moins permissif — c’est volontaire.',
            },
            {
              titre: 'Copiez le lien affiché et envoyez-le',
              texte:
                'Le lien apparaît immédiatement après la création. Transmettez-le à la personne concernée par le moyen de votre choix. Le lien est **valable 7 jours**.',
            },
            {
              titre: 'La personne crée son compte, puis ouvre le lien',
              texte:
                'Elle doit s’inscrire **avec exactement l’adresse email que vous avez saisie**. Si les adresses diffèrent, l’invitation est refusée. Une fois connectée, elle ouvre le lien et rejoint l’organisation.',
            },
          ],
        },
        {
          type: 'note',
          ton: 'info',
          titre: 'Si la personne a déjà un compte, le lien est même inutile',
          texte:
            'Un utilisateur déjà inscrit avec la bonne adresse voit apparaître un bandeau « invitation en attente » dans son tableau de bord, avec un bouton pour accepter. C’est le chemin le plus simple : demandez-lui de créer son compte d’abord, puis créez l’invitation.',
        },
        {
          type: 'liste',
          items: [
            'Une invitation expire au bout de **7 jours**. Passé ce délai, créez-en une nouvelle.',
            'Vous pouvez **révoquer** une invitation tant qu’elle n’a pas été acceptée.',
            'Il ne peut y avoir qu’**une seule invitation en attente** par adresse et par organisation.',
            'Seuls le **propriétaire** et les **administrateurs** peuvent inviter et consulter la liste des membres.',
          ],
        },
      ],
    },
    {
      id: 'roles',
      titre: 'Les rôles et ce que chacun peut faire',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Sept rôles sont attribuables. Choisissez le moins permissif qui permette à la personne de faire son travail — vous pourrez toujours l’élargir ensuite.',
        },
        {
          type: 'tableau',
          entetes: ['Rôle', 'Ce qu’il peut faire', 'Pour qui'],
          lignes: [
            [
              '**Propriétaire**',
              'Tout, y compris la facturation et la validation des plans.',
              'Vous, le dirigeant.',
            ],
            [
              '**Administrateur**',
              'Gère l’organisation, les membres et les projets, saisit et calcule. **Ne peut pas valider un plan, clôturer une période, ni gérer la facturation.**',
              'Un associé qui gère l’outil au quotidien.',
            ],
            [
              '**Directeur financier**',
              'Saisit, calcule, **valide les plans**, clôture et rouvre les périodes, exporte. Ne gère ni l’organisation, ni les invitations, ni la facturation.',
              'Le responsable financier.',
            ],
            [
              '**Comptable**',
              'Consulte, saisit le **réalisé**, exporte. Ne saisit pas d’hypothèses, ne calcule pas, ne valide pas. Peut clôturer les périodes si vous l’y autorisez explicitement.',
              'Votre comptable externe.',
            ],
            [
              '**Analyste**',
              'Consulte, saisit les hypothèses, calcule, exporte. **Ne valide pas** et ne saisit pas de réalisé.',
              'Un collaborateur qui construit le prévisionnel.',
            ],
            [
              '**Conseiller**',
              'Consultation seule — et **sans export de fichier**.',
              'Un mentor, un incubateur, un banquier à qui vous montrez le dossier en ligne.',
            ],
            [
              '**Lecteur**',
              'Consultation seule.',
              'Toute personne qui doit seulement être informée.',
            ],
          ],
          legende:
            'Le rôle **Conseiller** n’a délibérément pas le droit d’export : il peut tout consulter dans l’application, mais ne peut pas emporter un fichier. C’est le rôle à donner à un intervenant extérieur.',
        },
        {
          type: 'note',
          ton: 'info',
          titre: 'Vous ne pouvez pas donner un droit que vous n’avez pas',
          texte:
            'On ne peut attribuer qu’un rôle dont les droits sont inclus dans les siens. Conséquence concrète : un **administrateur ne peut pas nommer un directeur financier ni un comptable**, parce que ces rôles détiennent des droits — validation, clôture — qu’il n’a pas lui-même. Seul le propriétaire le peut.',
        },
        {
          type: 'note',
          ton: 'info',
          titre: 'Une organisation garde toujours un propriétaire',
          texte:
            'Le dernier propriétaire ne peut ni être rétrogradé, ni être retiré. Pour transmettre une organisation, nommez d’abord le nouveau propriétaire, puis changez votre propre rôle.',
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'Un rôle « Chef de projet » figure dans le modèle mais n’est pas attribuable',
          texte:
            'Il n’aurait de sens que restreint à certains projets — ce qui n’existe pas encore. Plutôt que de proposer un rôle qui ne restreindrait rien, il est bloqué à l’attribution.',
        },
      ],
    },
    {
      id: 'validation-a-plusieurs',
      titre: 'La validation à quatre yeux',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Dès que votre organisation compte **au moins deux personnes habilitées à valider un plan**, celle qui a saisi les hypothèses en dernier ne peut plus valider elle-même : une autre doit le faire. C’est un contrôle classique en environnement financier, qui évite qu’une même personne produise et approuve un document engageant.',
        },
        {
          type: 'paragraphe',
          texte:
            'Si vous êtes **seul** habilité, vous validez vos propres chiffres sans obstacle ; le plan est simplement marqué comme approuvé par un approbateur unique. Voir [ce qui bloque une validation](/aide/valider-et-exporter#ce-qui-bloque).',
        },
      ],
    },
    {
      id: 'compte-et-email',
      titre: 'Votre compte et votre adresse email',
      blocs: [
        {
          type: 'note',
          ton: 'limite',
          titre: 'Le changement d’adresse email ne peut pas aboutir aujourd’hui',
          texte:
            'Vous pouvez demander à changer l’adresse de votre compte, mais la demande **ne pourra pas être menée à son terme** : la confirmation passe par un email de vérification, et aucun service d’envoi n’est branché. L’application vous le dit avant et après la saisie. **Votre adresse actuelle reste inchangée** et vous pouvez annuler la demande à tout moment.',
        },
        {
          type: 'paragraphe',
          texte:
            'Ce blocage est **volontaire**. Appliquer un changement d’adresse sans vérifier que la nouvelle boîte appartient bien à son titulaire ouvrirait un chemin de prise de contrôle du compte. Mieux vaut une fonction qui refuse honnêtement qu’une fonction dangereuse.',
        },
        {
          type: 'note',
          ton: 'attention',
          titre: 'Choisissez bien votre adresse à l’inscription',
          texte:
            'Puisqu’elle ne pourra pas être modifiée avant la mise en service des emails, inscrivez-vous avec une adresse durable, à laquelle vous garderez accès. Pour la même raison, aucune **notification** n’est envoyée par Lalanda aujourd’hui : ni invitation, ni alerte, ni rappel. Tout se passe dans l’application.',
        },
      ],
    },
  ],
};
