// Article « Suivre son activité » (prévisionnel vs réalisé).
//
// Sources vérifiées dans le code au moment de la rédaction :
//  - apps/api/src/actuals/actual-period.schema.ts (périodes, statuts open/closed,
//    exercices 1-5 et mois 1-12 RELATIFS, journal de réouverture)
//  - apps/api/src/actuals/actuals.controller.ts (routes, NO_APPROVED_PLAN,
//    réouverture exigeant period.close ET plan.approve)
//  - apps/api/src/actuals/variance.ts (convention annuel/12, raisons de
//    non-comparabilité, sens déduit de l'identifiant, projection actualisée)
//  - apps/web/src/app/(app)/projects/[id]/realise/page.tsx + actuals-panel.tsx
//  - limites : docs/08-PREVISIONNEL-REALISE.md § Limites
//
// ATTENTION : docs/08 et docs/22 décrivent encore une réouverture réservée au
// propriétaire (403 REOPEN_OWNER_ONLY). Ce code n'existe plus. La règle réelle
// est vérifiée dans actuals.controller.ts : propriétaire OU directeur financier.

import type { ArticleAide } from '../types';

export const SUIVRE_SON_ACTIVITE: ArticleAide = {
  slug: 'suivre-son-activite',
  titre: 'Suivre son activité',
  resume:
    'Saisir vos chiffres réels mois par mois, les comparer au plan validé, et voir où vous atterrirez en fin d’exercice.',
  ordre: 5,
  sections: [
    {
      id: 'a-quoi-ca-sert',
      titre: 'Pourquoi comparer le réel au prévu',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Un prévisionnel déposé et jamais rouvert ne sert qu’une fois. Le suivi transforme votre plan en outil de pilotage : chaque mois, vous saisissez ce qui s’est réellement passé, et Lalanda vous montre l’écart avec ce que vous aviez annoncé.',
        },
        {
          type: 'paragraphe',
          texte:
            'C’est aussi ce qui vous donne de la crédibilité pour le crédit suivant. Un entrepreneur capable de montrer qu’il tient ses prévisions à 10 % près sur douze mois n’a pas le même dossier qu’un porteur de projet sans historique.',
        },
        {
          type: 'paragraphe',
          texte:
            'Le suivi se trouve dans l’onglet **Réalisé** de votre projet, à côté de l’onglet **Plan**.',
        },
      ],
    },
    {
      id: 'saisir-le-realise',
      titre: 'Saisir vos chiffres réels',
      blocs: [
        {
          type: 'liste',
          items: [
            'Vous saisissez **par mois**, ligne par ligne, sur une grille qui reprend les lignes de votre compte d’exploitation.',
            'Les périodes sont repérées par **exercice (1 à 5) et mois (1 à 12)** — ce sont des repères **relatifs au démarrage** de votre projet, pas des dates du calendrier. Le mois 1 de l’exercice 1 est votre premier mois d’activité, quelle que soit la date réelle.',
            'Une période se **clôture** quand elle est complète. Une période clôturée peut être **rouverte**, et chaque réouverture est journalisée — on sait toujours qui a rouvert quoi et quand.',
            'La projection actualisée ne prend en compte que les périodes **clôturées** : une saisie en cours ne fausse pas vos prévisions.',
          ],
        },
        {
          type: 'note',
          ton: 'attention',
          titre: 'Il faut un plan validé avant de pouvoir comparer',
          texte:
            'La référence de comparaison est votre **dernier plan validé**. Sans plan validé, la saisie est possible mais les écarts ne s’affichent pas : Lalanda vous le dit explicitement plutôt que d’inventer une référence. Voir [figer un plan](/aide/valider-et-exporter#figer-un-plan).',
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'La saisie est entièrement manuelle',
          texte:
            'Il n’y a **aucun import** : ni relevé bancaire, ni fichier CSV ou Excel, ni connexion à un service de paiement mobile, ni rapprochement automatique. Vous saisissez des montants agrégés par mois et par ligne. Prévoyez le temps correspondant dans votre routine mensuelle.',
        },
      ],
    },
    {
      id: 'lire-les-ecarts',
      titre: 'Lire les écarts',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Pour chaque ligne et chaque mois, Lalanda affiche le prévu, le réalisé et l’écart, en valeur et en pourcentage, ainsi que le cumul depuis le début de l’exercice.',
        },
        {
          type: 'note',
          ton: 'attention',
          titre: 'Le prévu mensuel est un douzième de l’annuel',
          texte:
            'Le montant de référence d’un mois est **la base annuelle divisée par douze**. Aucune saisonnalité n’est modélisée. Si votre activité a des hautes et des basses saisons — et c’est le cas de presque toutes —, un écart mensuel important peut n’être qu’un effet de calendrier. **Regardez le cumul depuis le début de l’exercice** plutôt que le mois isolé : c’est lui qui a du sens.',
        },
        {
          type: 'paragraphe',
          texte:
            'Lalanda ne fabrique jamais un écart qu’il ne peut pas calculer. Quand une comparaison est impossible, il le dit et en donne la raison : la ligne n’existe pas dans le plan validé, elle n’appartient pas au compte d’exploitation, l’exercice n’est pas publié dans le plan, ou la période n’a simplement pas été saisie.',
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'Au-delà de l’exercice 1, la comparaison est très partielle',
          texte:
            'Le plan ne publie, pour les exercices 2 à 5, que le **chiffre d’affaires** et le **résultat net** annuels. Toutes les autres lignes du compte d’exploitation — coûts variables, charges, marges — sont donc marquées non comparables passé la première année. Le suivi détaillé est réellement exploitable sur l’exercice 1.',
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'Les soldes sont saisis, pas recalculés',
          texte:
            'Les lignes de solde (marge, excédent brut d’exploitation, résultat) sont **saisies par vous** et non déduites des lignes du dessus. Lalanda signale une incohérence lorsqu’une simple addition ne tombe pas juste, mais il ne corrige rien à votre place. Le sens de l’écart — favorable ou défavorable — est déduit de la nature de la ligne, ce qui reste une heuristique.',
        },
      ],
    },
    {
      id: 'projection-actualisee',
      titre: 'La projection actualisée',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'À partir de vos périodes clôturées, Lalanda recompose une estimation de fin d’exercice : le **réalisé** des mois déjà clos, plus le **prévu** pour les mois restants. C’est votre atterrissage probable, mis à jour à chaque clôture.',
        },
        {
          type: 'paragraphe',
          texte:
            'Deux chiffres à ne pas confondre : le **prévisionnel** est ce que vous aviez annoncé et qui reste figé dans le plan validé ; la **projection actualisée** est votre meilleure estimation d’aujourd’hui. Le premier engage votre dossier, le second guide vos décisions.',
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'Le suivi ne vous alerte pas',
          texte:
            'Aucune alerte automatique n’est produite : ni trésorerie passant sous son minimum, ni marge qui se dégrade, ni écart qui dépasse un seuil. Vous ne serez pas prévenu — c’est à vous d’ouvrir l’onglet **Réalisé** régulièrement. Il n’est pas non plus possible d’attacher un commentaire, un responsable ou une action à un écart, ni de tracer la source d’un chiffre saisi.',
        },
      ],
    },
    {
      id: 'qui-peut-quoi',
      titre: 'Qui peut saisir et clôturer',
      blocs: [
        {
          type: 'liste',
          items: [
            '**Saisir le réalisé** : propriétaire, administrateur, directeur financier et comptable.',
            '**Clôturer une période** : propriétaire et directeur financier. Un **comptable** le peut aussi, mais seulement si cette autorisation lui a été accordée explicitement sur son compte.',
            '**Rouvrir une période clôturée** : propriétaire et directeur financier uniquement — c’est un geste qui modifie une donnée déjà arrêtée.',
          ],
        },
        {
          type: 'paragraphe',
          texte:
            'Le détail des rôles et de ce que chacun peut faire est dans [travailler à plusieurs](/aide/travailler-a-plusieurs#roles).',
        },
      ],
    },
  ],
};
