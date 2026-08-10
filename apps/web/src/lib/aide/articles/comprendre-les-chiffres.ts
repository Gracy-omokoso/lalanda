// Article « Comprendre les chiffres » — une section par feuille de résultats.
//
// Sources vérifiées dans le code au moment de la rédaction :
//  - liste et ordre des onglets : apps/web/src/app/(app)/projects/_components/
//    project-plan.tsx (SHEET_LABELS, TAB_ORDER, DEFAUT_TAB = 'ratios')
//  - lignes de chaque feuille : packages/engine/src/templates/*.yaml
//  - bilan / BFR / CAF / seuil / amortissements : packages/engine/src/
//    etats-financiers/index.ts + apps/web/.../etats-financiers-tables.tsx
//  - divergence des deux trésoreries : templates/*.yaml (feuille `tresorerie`,
//    solde mensuel constant) vs etats-financiers/index.ts (flux indirect annuel),
//    et docs/07-PLAN-FINANCIER.md § Limites connues
//  - équilibre du bilan : etats-financiers/index.ts (démonstration + ecart_equilibre),
//    TOLERANCE_EQUILIBRE dans etats-financiers-tables.tsx
//
// ATTENTION en relecture : le compte d'exploitation est MENSUEL, la projection et
// les états financiers sont ANNUELS. C'est la confusion la plus coûteuse pour un
// lecteur non comptable, et la raison d'être de la section « lire-les-periodes ».

import type { ArticleAide } from '../types';

export const COMPRENDRE_LES_CHIFFRES: ArticleAide = {
  slug: 'comprendre-les-chiffres',
  titre: 'Comprendre les chiffres',
  resume:
    'Ce que contient chaque feuille de résultats, dans quelle unité de temps la lire, et où les chiffres se recoupent.',
  ordre: 2,
  sections: [
    {
      id: 'ou-lire-les-resultats',
      titre: 'Où lire les résultats',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Une fois vos hypothèses saisies et le calcul lancé, les résultats s’affichent dans l’onglet **Plan** du projet, répartis en onglets — un par feuille. L’onglet ouvert par défaut est **Ratios bancaires**, parce que c’est celui qui répond à la question « est-ce que mon dossier tient ? ».',
        },
        {
          type: 'liste',
          items: [
            'L’onglet affiché est inscrit dans l’adresse de la page (`?tab=…`). Vous pouvez donc envoyer à quelqu’un un lien qui ouvre directement la bonne feuille.',
            'Un **bandeau de ratios** reste visible en haut de l’écran quel que soit l’onglet ouvert : il rappelle les indicateurs qui portent un seuil, avec leur feu tricolore.',
            'Le calcul n’est pas relancé à chaque frappe. Quand vos hypothèses ont changé depuis le dernier calcul, un bandeau **« Résultats obsolètes »** et un bouton **Recalculer** apparaissent : les chiffres affichés sont alors ceux d’avant votre modification.',
          ],
        },
        {
          type: 'note',
          ton: 'info',
          titre: 'Commencez par les ratios, finissez par le bilan',
          texte:
            'Les [ratios bancaires](/aide/ratios-bancaires) vous disent en dix secondes si le dossier est défendable. Les autres feuilles servent à comprendre **pourquoi**, puis à corriger. Le bilan, lui, est la pièce que le chargé d’affaires ouvrira pour vérifier que l’ensemble est cohérent.',
        },
      ],
    },
    {
      id: 'lire-les-periodes',
      titre: 'Mensuel ou annuel : la confusion à éviter',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Toutes les feuilles ne parlent pas de la même durée. C’est la première source d’incompréhension, et elle donne des écarts d’un facteur douze. Vérifiez toujours l’unité de temps avant de comparer deux chiffres.',
        },
        {
          type: 'tableau',
          entetes: ['Feuille', 'Période couverte'],
          lignes: [
            ['Compte d’exploitation', '**Un mois type**, en rythme de croisière'],
            ['Trésorerie mensuelle', 'Des jalons de la **première année** seulement'],
            ['Financement', 'Mensualité, puis service annuel de la dette'],
            ['Plan de financement', 'Montants **ponctuels** au démarrage (pas une période)'],
            ['Projection 5 exercices', '**Cinq exercices annuels**'],
            ['Bilan', 'Ouverture, puis clôture de **chacun des 5 exercices**'],
            ['BFR, CAF, Seuil, Amortissements', '**Cinq exercices annuels**'],
          ],
          legende:
            'Le compte d’exploitation est mensuel ; la projection et les états financiers sont annuels. Un résultat net de 3 900 USD au compte d’exploitation n’est pas comparable à un résultat de 46 800 USD en projection — c’est le même chiffre, exprimé sur douze mois.',
        },
        {
          type: 'note',
          ton: 'attention',
          titre: 'Trois « résultats nets » différents coexistent',
          texte:
            'Le résultat net du **compte d’exploitation** est mensuel et se calcule **avant** dotations aux amortissements et **avant** intérêts d’emprunt. Le résultat des **projections** est annuel, sur la même base. Seul le résultat porté au **bilan** et à la **CAF** est le résultat comptable complet, après amortissements et après intérêts. C’est celui-là qu’un comptable regardera. Les trois sont justes ; ils ne répondent pas à la même question.',
        },
      ],
    },
    {
      id: 'compte-exploitation',
      titre: 'Compte d’exploitation',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'La feuille qui dit si l’activité gagne de l’argent, **avant** de se demander comment elle est financée. Elle décrit un mois type en rythme de croisière : le chiffre d’affaires, ce qu’il coûte à produire, ce qu’il reste.',
        },
        {
          type: 'liste',
          items: [
            '**Chiffre d’affaires** — ce que vous encaissez de vos clients sur le mois, issu de vos hypothèses de volume et de prix.',
            '**Coûts variables** — ce qui augmente mécaniquement avec les ventes. Selon votre modèle : coût matière pour un restaurant, coût d’achat des marchandises vendues pour un négoce, marchandises, livraison et publicité pour l’e-commerce. Une prestation de services n’en a pas.',
            '**Marge** (sur matière, brute, ou après coûts variables selon le modèle) — ce qui reste des ventes pour payer les charges fixes.',
            '**Charges opérationnelles** — loyer, salaires, énergie, ce qui tombe que vous vendiez ou non.',
            '**Excédent brut d’exploitation (EBE)** — la marge moins les charges opérationnelles. C’est le vrai juge de paix de l’activité : positif, votre métier crée de la valeur ; négatif, aucun montage financier ne le rattrapera.',
            '**Impôt sur les bénéfices**, puis **Résultat net mensuel**, mis en évidence en bas de la feuille.',
          ],
        },
        {
          type: 'exemple',
          titre: 'Restaurant urbain — un mois type',
          lignes: [
            { libelle: 'Chiffre d’affaires', valeur: '18 720 USD' },
            { libelle: 'Coût matière (35 %)', valeur: '−6 552 USD' },
            { libelle: 'Marge sur matière', valeur: '12 168 USD' },
            { libelle: 'Charges opérationnelles', valeur: '−8 300 USD' },
            { libelle: 'Excédent brut d’exploitation', valeur: '3 868 USD' },
          ],
          conclusion:
            'L’EBE mensuel est ce dans quoi la banque ira puiser votre mensualité de crédit. S’il ne la couvre pas confortablement, le [DSCR](/aide/ratios-bancaires#dscr) passera au rouge.',
        },
      ],
    },
    {
      id: 'tresorerie-mensuelle',
      titre: 'Trésorerie mensuelle',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Le compte d’exploitation dit si vous gagnez de l’argent. La trésorerie dit s’il vous en reste **en caisse**. Une entreprise rentable qui tombe à court de liquidités ferme quand même : c’est la feuille à regarder juste après les ratios.',
        },
        {
          type: 'liste',
          items: [
            '**Trésorerie à l’ouverture (M0)** — votre apport plus l’emprunt, moins l’investissement initial et moins le besoin en fonds de roulement de démarrage. C’est ce qui reste en caisse le jour où vous ouvrez.',
            '**Solde mensuel opérationnel** — le résultat net du mois moins la mensualité de crédit.',
            'Des **points d’étape** dans l’année : fin de mois 1, 3, 6, 9 et 12 (le modèle restaurant ajoute le mois 2).',
            '**Trésorerie minimale sur les 12 mois** — le point bas de l’année. C’est lui qui porte un seuil et un feu tricolore.',
          ],
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'Cette feuille est une vue simplifiée, et elle diverge du bilan',
          texte:
            'Le solde mensuel est supposé **constant** toute l’année : aucune saisonnalité n’est modélisée, et la feuille n’affiche pas les douze mois mais cinq à six jalons. Surtout, elle **ignore la variation du besoin en fonds de roulement** — l’argent immobilisé quand vos créances clients et vos stocks augmentent. Elle est donc **optimiste**. La trésorerie du [bilan](/aide/comprendre-les-chiffres#bilan), elle, est calculée par un tableau de flux qui déduit cette variation.',
        },
        {
          type: 'note',
          ton: 'attention',
          titre: 'En cas d’écart, la trésorerie du bilan fait foi',
          texte:
            'Les deux vues ne coïncident qu’à l’ouverture, et l’écart se creuse à mesure que le délai de paiement de vos clients s’allonge. Si votre chargé d’affaires vous interroge sur votre trésorerie de fin d’exercice, citez celle du bilan. Le détail des différences est expliqué à la section [Pourquoi les deux trésoreries diffèrent](/aide/comprendre-les-chiffres#deux-tresoreries).',
        },
      ],
    },
    {
      id: 'financement',
      titre: 'Financement',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Le coût de votre crédit, calculé à partir du capital emprunté, du taux et de la durée que vous avez saisis. Trois lignes : la **mensualité constante** que vous paierez, le **service annuel de la dette** (la somme des douze mensualités), et une **estimation des intérêts de la première année**.',
        },
        {
          type: 'paragraphe',
          texte:
            'Le service annuel de la dette est le dénominateur du [DSCR](/aide/ratios-bancaires#dscr). C’est donc la ligne à faire bouger — en allongeant la durée, en réduisant le capital emprunté, ou en augmentant votre apport — quand ce ratio ne passe pas.',
        },
      ],
    },
    {
      id: 'plan-financement',
      titre: 'Plan de financement',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'La pièce qui répond à la question « de combien avez-vous besoin, et d’où vient l’argent ? ». Elle ne couvre pas une période : ce sont les montants du démarrage, mis face à face.',
        },
        {
          type: 'tableau',
          entetes: ['Besoins', 'Ressources'],
          lignes: [
            ['Investissements (équipement, aménagement)', 'Apport personnel'],
            ['BFR — trésorerie de sécurité du démarrage', 'Emprunt bancaire'],
            ['**TOTAL BESOINS**', '**TOTAL RESSOURCES**'],
          ],
          legende:
            'Une dernière ligne calcule l’**écart (ressources − besoins)**. Négatif, votre montage ne finance pas votre projet : il manque de l’argent quelque part, et un banquier le verra immédiatement.',
        },
        {
          type: 'note',
          ton: 'info',
          titre: 'N’oubliez pas le besoin en fonds de roulement dans vos besoins',
          texte:
            'L’erreur classique du premier dossier est de n’emprunter que le montant de l’équipement. Il faut aussi financer les premiers stocks, les premiers salaires et l’attente des paiements clients. Cette ligne est là pour ça.',
        },
      ],
    },
    {
      id: 'projection',
      titre: 'Projection 5 exercices',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Le chiffre d’affaires et le résultat net de chacun des cinq exercices, plus les résultats cumulés à trois et cinq ans. C’est l’horizon standard d’un dossier de crédit d’investissement.',
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'Ce que la projection ne modélise pas',
          texte:
            'Les charges dites « fixes » suivent le chiffre d’affaires : il n’y a **pas d’effet de levier opérationnel** modélisé, alors qu’en réalité un loyer ne double pas quand les ventes doublent. Aucun **investissement de renouvellement** n’est prévu non plus : sur cinq ans, votre équipement s’amortit jusqu’à une valeur quasi nulle sans jamais être remplacé. Enfin, les **scénarios alternatifs** (prudent, ambitieux) ne sont pas disponibles — un projet porte un seul jeu d’hypothèses.',
        },
      ],
    },
    {
      id: 'bilan',
      titre: 'Bilan',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'La photographie de ce que l’entreprise **possède** (l’actif) et de ce qu’elle **doit** (le passif), à l’ouverture puis à la clôture de chacun des cinq exercices. Les deux colonnes sont toujours égales — c’est la définition même d’un bilan.',
        },
        {
          type: 'tableau',
          entetes: ['Actif — ce que vous avez', 'Passif — d’où ça vient'],
          lignes: [
            ['Immobilisations brutes, moins amortissements cumulés', 'Capital apporté'],
            ['= Actif immobilisé net', 'Résultats cumulés'],
            ['Stocks, créances clients (= actif circulant)', '= Capitaux propres'],
            ['Trésorerie', 'Dettes financières, fournisseurs, fiscales et sociales'],
            ['**TOTAL ACTIF**', '**TOTAL PASSIF**'],
          ],
        },
        {
          type: 'liste',
          items: [
            'Le bilan est équilibré **par construction**, sans poste d’ajustement : aucun chiffre n’est bricolé pour faire tomber juste.',
            'Une ligne **Écart actif − passif** affiche ce contrôle. Elle doit être nulle. Si l’écart dépasse la tolérance d’arrondi, un message rouge vous demande de ne pas déposer le dossier et de signaler l’anomalie.',
            'Une ligne **Autonomie financière** rapporte vos capitaux propres au total du bilan — c’est la part de l’entreprise qui vous appartient vraiment. Elle est affichée sans feu tricolore : [comparez-la vous-même au seuil de 30 %](/aide/ratios-bancaires#autonomie-financiere).',
          ],
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'Simplifications assumées du bilan',
          texte:
            'Les **dettes fiscales et sociales sont laissées à zéro** : le modèle suppose que vous payez comptant, ce qui est prudent (un décalage réel améliorerait votre trésorerie). Les **dettes fournisseurs** ne portent que sur les achats variables. L’**économie d’impôt** procurée par les amortissements et les intérêts n’est pas modélisée — là encore, hypothèse prudente. Enfin, l’année compte **360 jours** pour tous les calculs de délais.',
        },
      ],
    },
    {
      id: 'deux-tresoreries',
      titre: 'Pourquoi les deux trésoreries diffèrent',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Le produit affiche deux trésoreries qui ne donnent pas le même chiffre. Ce n’est pas une erreur de calcul : ce sont deux méthodes, dont une simplifiée. Autant le savoir avant qu’un banquier ne le remarque.',
        },
        {
          type: 'tableau',
          entetes: ['', 'Trésorerie mensuelle', 'Trésorerie du bilan'],
          lignes: [
            ['Variation du besoin en fonds de roulement', 'Ignorée', 'Déduite'],
            ['Intérêts d’emprunt', 'Décaissés, mais pas passés en charge', 'Déduits du résultat'],
            ['Amortissements', 'Non déduits', 'Déduits, puis réintégrés via la CAF'],
            ['Remboursement du crédit', 'Mensualité entière', 'Capital seul'],
            ['Période', 'Jalons de l’année 1', 'Clôture de chaque exercice'],
          ],
          legende:
            'Les deux vues partent du même point à l’ouverture, puis s’écartent. **La trésorerie de clôture qui fait foi est celle du bilan.**',
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'Cette divergence est connue et assumée',
          texte:
            'Unifier les deux vues suppose de mensualiser l’ensemble du modèle — un chantier qui n’est pas livré. En attendant, servez-vous de la trésorerie mensuelle pour repérer un point bas dans l’année, et du bilan pour tout chiffre communiqué à un tiers.',
        },
      ],
    },
    {
      id: 'bfr',
      titre: 'BFR — besoin en fonds de roulement',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Le BFR est l’argent immobilisé par le simple fonctionnement de votre activité : vous achetez et stockez avant de vendre, vous vendez avant d’être payé, pendant que vos fournisseurs vous accordent un délai. La différence est de l’argent que vous devez avancer en permanence.',
        },
        {
          type: 'liste',
          items: [
            'Stocks **+** créances clients **−** dettes fournisseurs **−** dettes fiscales et sociales = **BFR**.',
            'La **variation du BFR** d’un exercice à l’autre est ce qui ponctionne réellement votre trésorerie. Une croissance rapide consomme du cash : c’est contre-intuitif, et c’est ce qui tue le plus d’entreprises rentables.',
            'Le **BFR en jours de chiffre d’affaires** ramène le montant à une durée, plus parlante pour comparer.',
          ],
        },
        {
          type: 'note',
          ton: 'info',
          titre: 'Le levier le plus rapide sur le BFR est le délai client',
          texte:
            'Réduire de 60 à 30 jours le délai de paiement accordé à vos clients libère immédiatement un mois de chiffre d’affaires en trésorerie. C’est presque toujours plus efficace, et moins coûteux, que d’aller chercher un découvert.',
        },
      ],
    },
    {
      id: 'caf',
      titre: 'CAF — capacité d’autofinancement',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'La CAF est l’argent que l’activité dégage réellement sur un exercice : le **résultat net** auquel on **rajoute les dotations aux amortissements**. On les rajoute parce qu’un amortissement est une charge comptable qui ne sort pas de votre caisse — la machine a été payée au départ, pas chaque année.',
        },
        {
          type: 'paragraphe',
          texte:
            'C’est la ligne que votre banquier lit en premier, parce que c’est là-dedans que se prend le remboursement de votre crédit. La feuille affiche aussi la **CAF cumulée** sur les cinq exercices.',
        },
      ],
    },
    {
      id: 'seuil-rentabilite',
      titre: 'Seuil de rentabilité et point mort',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Le **seuil de rentabilité** est le chiffre d’affaires à partir duquel vous ne perdez plus d’argent. Le **point mort**, affiché en mois, est le moment de l’exercice où vous l’atteignez. La feuille les calcule pour chacun des cinq exercices.',
        },
        {
          type: 'liste',
          items: [
            'Chiffre d’affaires **−** charges variables = **marge sur coûts variables**, exprimée aussi en **taux**.',
            'Charges fixes **÷** taux de marge sur coûts variables = **seuil de rentabilité**.',
            'La **marge de sécurité** mesure de combien votre chiffre d’affaires peut baisser avant de repasser sous ce seuil. C’est votre coussin en cas de mauvaise année.',
          ],
        },
        {
          type: 'exemple',
          titre: 'Lecture — quincaillerie de quartier, exercice 1',
          lignes: [
            { libelle: 'Chiffre d’affaires prévu', valeur: '180 000 USD' },
            { libelle: 'Seuil de rentabilité', valeur: '146 000 USD' },
            { libelle: 'Marge de sécurité', valeur: '≈ 19 %' },
            { libelle: 'Point mort', valeur: '≈ 9,7 mois' },
          ],
          conclusion:
            'Vous pouvez perdre 19 % de vos ventes avant de basculer dans le rouge. En dessous de 10 % de marge de sécurité, un banquier considérera le dossier comme tendu.',
        },
      ],
    },
    {
      id: 'amortissements',
      titre: 'Amortissements',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Amortir, c’est étaler comptablement le coût d’un équipement sur sa durée d’usage au lieu de le passer en charge en une fois. La feuille détaille, pour chaque immobilisation, la **dotation de chaque année** et la **valeur nette comptable** restante à la fin de chacune des cinq années.',
        },
        {
          type: 'note',
          ton: 'attention',
          titre: 'Investissements et base amortissable doivent concorder',
          texte:
            'Si le montant total des investissements que vous avez saisi diffère de la base amortissable déclarée, un message rouge apparaît en permanence sur l’écran des résultats, avec un lien pour corriger. Ne déposez pas un dossier dans cet état : c’est une incohérence qu’un analyste repère tout de suite.',
        },
      ],
    },
  ],
};
