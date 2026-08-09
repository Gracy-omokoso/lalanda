// Article « Valider et exporter ».
//
// Sources vérifiées dans le code au moment de la rédaction :
//  - plan figé : apps/api/src/plans/plan.schema.ts (immuabilité, statuts),
//    plans.service.ts (numérotation, empreinte SHA-256, PLAN_UNCHANGED),
//    plans.controller.ts (DRIVERS_OUT_OF_RANGE, SELF_APPROVAL_FORBIDDEN, audit)
//  - séparation des tâches : authz/permissions.ts (sodDecision, soleApprover)
//  - exports : apps/api/src/reports/reports.controller.ts (deux routes seulement,
//    ?planVersion=N), report-html.ts (11 sections, filigrane), report-xlsx.ts
//  - filigrane : billing/entitlements.ts (pdfWatermark true en offre Free)
//
// Deux limites relevées dans le code et écrites telles quelles ici :
//   1. un export tiré d'un plan validé n'est jamais filigrané, même en offre
//      gratuite (le champ watermark n'est pas renseigné dans cette branche) ;
//   2. la feuille « Métadonnées » du fichier Excel ne porte pas le numéro de
//      version du plan — seul le nom du fichier le porte.
// Ne pas « corriger » ces phrases sans corriger d'abord le code.

import type { ArticleAide } from '../types';

export const VALIDER_ET_EXPORTER: ArticleAide = {
  slug: 'valider-et-exporter',
  titre: 'Valider et exporter',
  resume:
    'Figer une version officielle de votre plan, puis produire le PDF et l’Excel que vous déposerez en banque.',
  ordre: 4,
  sections: [
    {
      id: 'figer-un-plan',
      titre: 'Figer un plan',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Tant que vous saisissez, votre projet est un **brouillon** : il change à chaque modification. Valider un plan en fait une **version figée et immuable**, horodatée, avec ses hypothèses, ses résultats, le modèle et le pack pays utilisés, et la version du moteur de calcul. C’est cette version que vous déposez, et à laquelle vous pourrez vous référer plus tard.',
        },
        {
          type: 'liste',
          items: [
            'Les versions sont numérotées **v1, v2, v3…** par projet. Valider à nouveau crée la version suivante ; la précédente passe au statut « remplacée » mais **n’est jamais supprimée ni modifiée**.',
            'Un plan validé conserve une **copie complète des résultats**. Rouvrir une ancienne version ne relance aucun calcul : vous relisez exactement ce que vous aviez déposé, même si le modèle ou la fiscalité ont évolué depuis.',
            'Vous pouvez continuer à modifier vos hypothèses après une validation. Cela ne touche pas le plan figé — cela vous prépare simplement une version suivante.',
          ],
        },
        {
          type: 'note',
          ton: 'info',
          titre: 'Valider deux fois de suite sans rien changer ne crée rien',
          texte:
            'Lalanda compare l’empreinte de vos hypothèses à celle du dernier plan validé. Si rien n’a bougé, la validation est refusée avec un message explicite plutôt que de créer un doublon. Vos versions restent donc lisibles : chacune correspond à une vraie évolution du dossier.',
        },
      ],
    },
    {
      id: 'ce-qui-bloque',
      titre: 'Ce qui peut bloquer une validation',
      blocs: [
        {
          type: 'liste',
          items: [
            '**Une hypothèse hors des bornes autorisées.** Les valeurs impossibles (signalées en rouge à la saisie) sont tolérées dans un brouillon, jamais dans un plan validé. Le message indique combien d’hypothèses sont en cause ; corrigez-les puis recommencez.',
            '**Une erreur de calcul du moteur.** Rare, et signalée avec son code.',
            '**La règle de séparation des tâches.** Si votre organisation compte **au moins deux personnes habilitées à valider**, celle qui a saisi les hypothèses en dernier ne peut pas valider elle-même : quelqu’un d’autre doit le faire. C’est un contrôle standard en environnement financier.',
          ],
        },
        {
          type: 'note',
          ton: 'info',
          titre: 'Si vous êtes seul, vous pouvez valider vos propres chiffres',
          texte:
            'La règle ci-dessus ne s’applique que s’il existe une seconde personne habilitée. Un entrepreneur seul dans son organisation valide son plan sans obstacle — le plan est simplement marqué comme validé par un approbateur unique, ce qui est une information honnête et non une sanction.',
        },
        {
          type: 'paragraphe',
          texte:
            'Les validations de plan et les exports sont **journalisés** : qui, quoi, quand. C’est une trace utile en cas de question ultérieure sur l’origine d’un document.',
        },
      ],
    },
    {
      id: 'exports',
      titre: 'Le PDF et l’Excel',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Deux formats sont produits, et deux seulement. Ils partent du même plan et contiennent les mêmes chiffres ; ils ne servent pas au même usage.',
        },
        {
          type: 'tableau',
          entetes: ['Format', 'Contenu', 'À quoi il sert'],
          lignes: [
            [
              '**PDF**',
              'Page de garde, sommaire, puis onze sections : hypothèses, compte d’exploitation, plan de financement, trésorerie, projection 5 exercices, financement, bilan, capacité d’autofinancement, seuil de rentabilité, amortissements, ratios bancaires. L’avertissement légal du pack pays est repris en fin de document.',
              'Le document que vous déposez et que le chargé d’affaires lit.',
            ],
            [
              '**Excel**',
              'Une feuille « Hypothèses », une feuille par état financier, une feuille « Métadonnées ».',
              'Le fichier qu’un analyste ou votre comptable ouvrira pour vérifier vos calculs.',
            ],
          ],
          legende:
            'Les sections dont la feuille n’existe pas dans votre modèle sont simplement omises du PDF.',
        },
        {
          type: 'note',
          ton: 'info',
          titre: 'L’Excel contient de vraies formules, pas des valeurs mortes',
          texte:
            'Les calculs sont retraduits en formules Excel natives avec les références de cellules correspondantes. Votre interlocuteur peut donc modifier une hypothèse dans le fichier et voir l’ensemble se recalculer — c’est exactement ce qu’un analyste crédit fait pour tester la solidité d’un dossier. Quand une formule ne peut pas être reconstituée, la valeur calculée est écrite à la place.',
        },
        {
          type: 'liste',
          items: [
            'Un export tiré d’un **plan validé** repart intégralement du contenu figé, **sans aucun recalcul**. Le document porte la mention « Plan validé v{N} », et le nom du fichier se termine par `-vN`.',
            'Un export tiré du **brouillon** est recalculé au moment de la demande et porte la mention **« BROUILLON — non validé »**. Ne déposez jamais celui-là.',
            'La génération est immédiate : le fichier est renvoyé directement, il n’y a pas de file d’attente ni de lien à récupérer plus tard.',
          ],
        },
        {
          type: 'note',
          ton: 'attention',
          titre: 'Le filigrane de l’offre gratuite ne s’applique qu’aux brouillons',
          texte:
            'En offre gratuite, le PDF porte un filigrane « Généré avec Lalanda — offre gratuite »… **mais uniquement lorsqu’il est exporté depuis le brouillon**. Un PDF tiré d’un plan validé sort aujourd’hui **sans filigrane, y compris en offre gratuite**. C’est un écart connu du produit ; ne construisez pas votre choix d’offre là-dessus, il sera corrigé.',
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'L’Excel n’indique pas le numéro de version à l’intérieur',
          texte:
            'La feuille « Métadonnées » porte l’organisation, le pays, le projet, le modèle et sa version, la devise, la date de génération et le cadre fiscal — mais **pas le numéro de version du plan validé**. Seul le nom du fichier le porte. Ne renommez donc pas vos fichiers Excel à la légère : c’est votre seul moyen de savoir de quelle version ils viennent.',
        },
      ],
    },
    {
      id: 'ce-qui-nexiste-pas',
      titre: 'Ce qui n’existe pas encore',
      blocs: [
        {
          type: 'note',
          ton: 'limite',
          titre: 'Un seul rapport, deux formats',
          texte:
            'Lalanda produit **le plan financier**, en PDF et en Excel. Il n’y a **pas** d’export Word, **pas** d’export CSV, **pas** de résumé exécutif, de rapport de scénario ni de dossier bancaire configurable. Le PDF ne contient **aucun graphique** : tout est présenté en tableaux. Enfin, l’export du suivi prévisionnel/réalisé n’est pas disponible.',
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'Aucun import',
          texte:
            'Vous ne pouvez pas alimenter Lalanda depuis un fichier Excel ou CSV existant. L’Excel est une **sortie** du produit, jamais une entrée. Vos hypothèses se saisissent dans l’application.',
        },
      ],
    },
  ],
};
