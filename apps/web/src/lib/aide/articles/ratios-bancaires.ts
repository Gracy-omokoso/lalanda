// Article « Les ratios que la banque regarde » — la page la plus utile du site.
//
// Sources vérifiées dans le code au moment de la rédaction :
//  - les 6 ratios à seuil, ids et formules : packages/engine/src/templates/*.yaml,
//    feuille `ratios` (identique dans les 4 templates livrés)
//  - seuils : packages/engine/src/parameter-packs/{cd,ci,sn,ohada-generic}-2026.yaml
//    § « Ratios bancaires attendus » — valeurs IDENTIQUES dans les 4 packs
//  - feu tricolore : statutSeuil() dans packages/engine/src/evaluator/index.ts
//    (tolérance ±10 %) ; libellés OK / Vigilance / Critique dans project-plan.tsx
//  - autonomie financière : etats-financiers/index.ts + evaluator (seuil attaché
//    mais JAMAIS rendu — cf. section `autonomie-financiere`)
//  - VAN / TRI : npv et irr sont dans la whitelist du compilateur
//    (compiler/formula-refs.ts) mais AUCUN template ne les utilise.
//
// Règle de rédaction propre à cet article : chaque ratio dit (1) ce qu'il mesure,
// (2) comment Lalanda le calcule EXACTEMENT — y compris là où ce calcul s'écarte
// de la définition d'un analyste crédit — et (3) les leviers concrets pour
// l'améliorer. Le point (2) n'est pas négociable : un entrepreneur à qui son
// banquier annonce un DSCR différent du nôtre doit pouvoir comprendre pourquoi.

import type { ArticleAide } from '../types';

export const RATIOS_BANCAIRES: ArticleAide = {
  slug: 'ratios-bancaires',
  titre: 'Les ratios que la banque regarde',
  resume:
    'Les six indicateurs qui décident de votre dossier : ce que chacun mesure, comment Lalanda le calcule, et quoi faire quand il est au rouge.',
  ordre: 3,
  sections: [
    {
      id: 'a-quoi-ca-sert',
      titre: 'Pourquoi ces six chiffres décident de tout',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Un chargé d’affaires reçoit beaucoup de dossiers et dispose de peu de temps. Il ne lit pas votre prévisionnel ligne à ligne : il vérifie une poignée de ratios, et c’est sur eux qu’il décide de creuser ou de refuser. Lalanda calcule exactement ces ratios-là et vous les montre avec un feu tricolore, avant que la banque ne le fasse.',
        },
        {
          type: 'paragraphe',
          texte:
            'Vous n’avez pas besoin d’être comptable pour vous en servir. Chaque ratio répond à une question simple, et chacun se corrige avec des leviers concrets — décrits plus bas, ratio par ratio.',
        },
        {
          type: 'tableau',
          entetes: ['Le ratio', 'La question à laquelle il répond', 'Seuil attendu'],
          lignes: [
            [
              '[DSCR](/aide/ratios-bancaires#dscr)',
              'Votre activité dégage-t-elle assez pour rembourser le crédit ?',
              '≥ 1,25',
            ],
            [
              '[Apport personnel](/aide/ratios-bancaires#apport)',
              'Mettez-vous assez de votre propre argent ?',
              '≥ 25 %',
            ],
            [
              '[Trésorerie minimale](/aide/ratios-bancaires#tresorerie-mini)',
              'Allez-vous manquer de liquidités en cours d’année ?',
              '≥ 0',
            ],
            [
              '[Délai de récupération](/aide/ratios-bancaires#payback)',
              'En combien de temps l’investissement est-il remboursé ?',
              '≤ 5 ans',
            ],
            [
              '[Marge EBE](/aide/ratios-bancaires#marges)',
              'L’activité est-elle rentable en elle-même ?',
              '≥ 10 %',
            ],
            [
              '[Marge nette](/aide/ratios-bancaires#marges)',
              'Reste-t-il quelque chose une fois l’impôt payé ?',
              '≥ 5 %',
            ],
          ],
          legende:
            'Ces seuils proviennent du pack pays de votre projet. Ils sont **aujourd’hui identiques dans les quatre packs livrés** (RDC, Côte d’Ivoire, Sénégal, OHADA générique) : seule la fiscalité change d’un pays à l’autre, pas les attentes de ratios.',
        },
      ],
    },
    {
      id: 'comment-lire',
      titre: 'Lire les feux tricolores',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Chaque ratio porte une pastille de couleur et un libellé. Le libellé compte autant que la couleur : ne vous fiez jamais à la couleur seule, et sachez que la bande orange est étroite.',
        },
        {
          type: 'tableau',
          entetes: ['Pastille', 'Libellé', 'Ce que ça veut dire'],
          lignes: [
            ['Verte', '**OK**', 'Le seuil est respecté.'],
            [
              'Orange',
              '**Vigilance**',
              'Vous êtes à moins de 10 % du seuil, du mauvais côté. Défendable en rendez-vous, mais il faudra l’expliquer.',
            ],
            [
              'Rouge',
              '**Critique**',
              'Vous êtes à plus de 10 % du seuil. En l’état, le dossier sera refusé sur ce point.',
            ],
          ],
          legende:
            'La zone orange fait exactement 10 % autour du seuil. Exemple : pour un délai de récupération dont le maximum est 5 ans, 5 ans et moins est vert, jusqu’à 5,5 ans est orange, au-delà rouge.',
        },
        {
          type: 'liste',
          items: [
            'Le **bandeau de ratios** reste affiché en haut des résultats quel que soit l’onglet ouvert : vous voyez l’effet de vos corrections sans changer de page.',
            'Le détail — valeur, seuil, sens de comparaison — est dans l’onglet **Ratios bancaires**, qui est aussi l’onglet ouvert par défaut.',
            'Survolez une pastille du bandeau pour lire le seuil exact appliqué.',
          ],
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'Un cas où l’orange n’apparaît jamais',
          texte:
            'La **trésorerie minimale** a pour seuil zéro. Comme la bande orange se calcule en pourcentage du seuil, 10 % de zéro vaut zéro : ce ratio est donc **soit vert, soit rouge**, sans état intermédiaire. C’est cohérent avec la réalité bancaire — une trésorerie négative, même d’un dollar, est un signal d’alerte.',
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'Les montants des ratios sont affichés en dollars',
          texte:
            'Dans l’onglet **Ratios bancaires**, les valeurs monétaires sont libellées en USD quelle que soit la devise d’affichage choisie pour le projet. Les ratios en pourcentage et les ratios sans unité ne sont pas concernés. Si votre projet est en XOF, lisez le montant de trésorerie minimale dans l’onglet **Trésorerie mensuelle** plutôt que dans celui des ratios.',
        },
      ],
    },
    {
      id: 'dscr',
      titre: 'DSCR — la couverture du service de la dette',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'C’est **le** ratio du crédit d’investissement. Il répond à une seule question : ce que votre activité dégage chaque année couvre-t-il ce que vous devez rembourser cette année-là ? Un DSCR de 1,4 signifie que vous dégagez 1,4 fois votre échéance annuelle — il vous reste 40 % de marge en cas de mauvaise année.',
        },
        {
          type: 'liste',
          items: [
            'En dessous de **1**, vous ne remboursez pas : le dossier est refusé sans discussion.',
            'Entre **1 et 1,25**, la banque considère qu’il n’y a aucun coussin. Ce n’est pas finançable en l’état.',
            'À partir de **1,25**, le dossier passe le premier filtre. Au-delà de **1,5**, vous êtes confortable.',
          ],
        },
        {
          type: 'note',
          ton: 'attention',
          titre: 'Le DSCR de Lalanda est plus optimiste que celui de votre banquier',
          texte:
            'Lalanda calcule **excédent brut d’exploitation × 12 ÷ service annuel de la dette**. L’EBE est pris **avant impôt, avant amortissements et avant intérêts**. Beaucoup d’analystes crédit utilisent au numérateur la **capacité d’autofinancement**, c’est-à-dire un résultat déjà diminué de l’impôt et des intérêts. Leur chiffre sera donc **plus bas que le nôtre**, parfois nettement. Prenez-vous une marge : viser 1,4 ou 1,5 dans Lalanda est plus prudent que viser tout juste 1,25.',
        },
        {
          type: 'exemple',
          titre: 'Restaurant à Kinshasa — un DSCR qui ne passe pas',
          lignes: [
            { libelle: 'EBE annuel (3 868 USD × 12)', valeur: '46 400 USD' },
            { libelle: 'Emprunt', valeur: '150 000 USD' },
            { libelle: 'Taux et durée', valeur: '14 % sur 5 ans' },
            { libelle: 'Mensualité', valeur: '3 490 USD' },
            { libelle: 'Service annuel de la dette', valeur: '41 900 USD' },
            { libelle: 'DSCR', valeur: '1,11 — Critique' },
          ],
          conclusion:
            'Même activité, même emprunt, **durée portée à 7 ans** : la mensualité tombe à 2 811 USD, le service annuel à 33 700 USD, et le DSCR remonte à **1,38 — OK**. Le projet n’a pas changé ; son montage, si.',
        },
        {
          type: 'paragraphe',
          texte: '**Comment améliorer votre DSCR, du levier le plus facile au plus difficile :**',
        },
        {
          type: 'liste',
          ordonnee: true,
          items: [
            '**Allonger la durée du crédit.** C’est le levier le plus puissant et le plus immédiat, comme ci-dessus. Il coûte plus d’intérêts au total, mais c’est lui qui rend le dossier finançable.',
            '**Négocier le taux.** En RDC, un crédit d’investissement en USD se situe autour de 14 %, et autour de 21 % en francs congolais. Un financement bonifié type **PADMPME** descend vers 9,5 % : sur le même emprunt de 150 000 USD sur 5 ans, cela fait passer le service annuel de 41 900 à 37 800 USD.',
            '**Augmenter votre apport pour emprunter moins.** Chaque dollar d’apport supplémentaire est un dollar de moins à rembourser — et cela améliore simultanément votre [ratio d’apport](/aide/ratios-bancaires#apport).',
            '**Réduire l’investissement de départ.** Matériel d’occasion, aménagement échelonné, équipement loué plutôt qu’acheté : tout ce qui sort du plan de financement allège l’emprunt.',
            '**Augmenter l’EBE.** C’est le vrai travail de fond : monter les prix, augmenter les volumes, faire baisser le ratio matière, renégocier le loyer. Voir [les marges](/aide/ratios-bancaires#marges).',
          ],
        },
      ],
    },
    {
      id: 'apport',
      titre: 'Apport personnel — votre part du risque',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'La banque veut voir que vous engagez votre propre argent. Un porteur de projet qui ne met rien transfère tout le risque au prêteur, et c’est rédhibitoire quel que soit le reste du dossier.',
        },
        {
          type: 'paragraphe',
          texte:
            'Lalanda calcule **apport ÷ total des besoins**, où le total des besoins additionne les **investissements** et le **besoin en fonds de roulement de démarrage**. Le seuil est de **25 %**.',
        },
        {
          type: 'note',
          ton: 'attention',
          titre: 'Certains guichets exigent davantage',
          texte:
            'En RDC, le **PADMPME** demande **30 %** d’apport, soit cinq points de plus que le seuil générique appliqué par Lalanda. Un ratio vert à 26 % dans l’outil peut donc être insuffisant pour ce guichet précis. Vérifiez l’exigence du financeur que vous visez avant de figer votre montage.',
        },
        {
          type: 'paragraphe',
          texte: '**Comment améliorer votre ratio d’apport :**',
        },
        {
          type: 'liste',
          ordonnee: true,
          items: [
            '**Valorisez vos apports en nature.** Un véhicule, un local, du matériel déjà possédé et affecté à l’activité comptent comme apport dès lors qu’ils sont évaluables et justifiables. Beaucoup d’entrepreneurs les oublient et se sous-estiment.',
            '**Mobilisez un apport familial ou un associé.** Un associé qui entre au capital augmente l’apport ; un prêt d’un proche, non — c’est de la dette.',
            '**Réduisez les besoins plutôt que d’augmenter l’apport.** Le ratio est une division : baisser le dénominateur produit le même effet. Un investissement mieux dimensionné améliore ce ratio sans qu’un franc de plus sorte de votre poche.',
            '**Étalez le projet en deux phases.** Financez un périmètre réduit maintenant, la seconde tranche une fois l’activité en marche et l’historique bancaire constitué.',
          ],
        },
      ],
    },
    {
      id: 'tresorerie-mini',
      titre: 'Trésorerie minimale — le point bas de l’année',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Ce ratio regarde le moment de la première année où votre caisse est au plus bas. Il doit rester **positif**. Une seule trésorerie négative, à un seul mois, suffit à faire retoquer un dossier : la banque vérifie systématiquement ce point, parce que c’est là que se déclenchent les défauts de paiement.',
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'Ce ratio repose sur une vue simplifiée et optimiste',
          texte:
            'Il est calculé sur la [trésorerie mensuelle](/aide/comprendre-les-chiffres#tresorerie-mensuelle), qui **ignore la variation du besoin en fonds de roulement** et suppose un solde mensuel **constant** toute l’année. De plus, le minimum n’est pas cherché sur les douze mois : il compare **l’ouverture et la fin du douzième mois**, ce qui est exact seulement parce que la trajectoire est supposée linéaire. Votre trésorerie réelle sera plus basse que celle-ci, surtout si vos clients paient à crédit ou si votre activité est saisonnière. Un ratio tout juste vert n’est pas rassurant.',
        },
        {
          type: 'paragraphe',
          texte: '**Comment redresser une trésorerie minimale négative :**',
        },
        {
          type: 'liste',
          ordonnee: true,
          items: [
            '**Financez plus large au départ.** Le point bas se joue surtout à l’ouverture : apport plus emprunt, moins l’investissement et le besoin en fonds de roulement. Emprunter un peu plus pour ne pas démarrer à sec est un arbitrage que les banquiers comprennent — encore faut-il l’avoir demandé dès le début.',
            '**Allongez la durée du crédit.** Une mensualité plus faible améliore le solde de chaque mois, donc le point bas. Le même levier redresse le [DSCR](/aide/ratios-bancaires#dscr).',
            '**Raccourcissez le délai de paiement de vos clients.** Passer de 60 à 30 jours libère un mois de chiffre d’affaires. C’est le levier le plus rentable, et il ne coûte rien à négocier.',
            '**Réduisez vos stocks de démarrage.** Un stock trop large immobilise du cash sans rien produire tant qu’il n’est pas vendu.',
            '**Négociez un délai fournisseur.** Payer à 30 jours au lieu du comptant décale une sortie sans changer votre activité.',
          ],
        },
      ],
    },
    {
      id: 'payback',
      titre: 'Délai de récupération de l’investissement',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Combien d’années faut-il pour que le projet ait « remboursé » ce qu’on y a mis. Le seuil est de **5 ans**. Au-delà de cinq ans, le dossier est jugé long ; **au-delà de sept ans, il est généralement retoqué**, parce que l’horizon dépasse la durée de vie prévisible du matériel financé.',
        },
        {
          type: 'note',
          ton: 'attention',
          titre: 'Ce ratio n’est pas le payback classique',
          texte:
            'Lalanda calcule **capital emprunté ÷ résultat net de la première année**. Deux écarts avec la définition usuelle : le numérateur retient l’**emprunt** et non l’investissement total, et le dénominateur est un résultat **avant amortissements et avant intérêts**, figé sur la première année sans tenir compte de la croissance. Le chiffre est donc indicatif. Un analyste qui refera le calcul à sa manière trouvera autre chose.',
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'L’unité n’est pas affichée à l’écran',
          texte:
            'La valeur est un nombre d’**années**, mais l’interface affiche « seuil ≤ 5 » sans préciser l’unité. Lisez « 5 ans ».',
        },
        {
          type: 'paragraphe',
          texte: '**Comment raccourcir le délai de récupération :**',
        },
        {
          type: 'liste',
          ordonnee: true,
          items: [
            '**Emprunter moins** — le numérateur baisse directement. Apport plus élevé, investissement mieux calibré.',
            '**Améliorer le résultat de la première année.** C’est le dénominateur, et c’est aussi ce qui porte tous les autres ratios. Attention toutefois : gonfler artificiellement l’année 1 pour verdir ce ratio se retourne contre vous en rendez-vous, où on vous demandera de justifier vos hypothèses de démarrage.',
            '**Étaler l’investissement.** Ce qui n’est pas financé maintenant ne pèse pas sur ce ratio maintenant.',
          ],
        },
      ],
    },
    {
      id: 'marges',
      titre: 'Marge EBE et marge nette — la rentabilité de fond',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Les deux marges disent si votre métier est rentable indépendamment de la façon dont il est financé. Aucun montage ne rattrape une activité qui perd de l’argent : si ces deux ratios sont rouges, ce n’est pas le dossier qu’il faut retoucher, c’est le modèle économique.',
        },
        {
          type: 'tableau',
          entetes: ['Ratio', 'Calcul', 'Seuil', 'Ce qu’il révèle'],
          lignes: [
            [
              '**Marge EBE**',
              'Excédent brut d’exploitation ÷ chiffre d’affaires',
              '≥ 10 %',
              'La rentabilité de l’exploitation elle-même, avant impôt, amortissements et intérêts.',
            ],
            [
              '**Marge nette**',
              'Résultat net ÷ chiffre d’affaires',
              '≥ 5 %',
              'Ce qui reste réellement une fois l’impôt sur les bénéfices payé.',
            ],
          ],
          legende:
            'Les deux sont calculées sur le compte d’exploitation **mensuel**. Comme toutes les lignes sont proportionnelles, le pourcentage est le même en base annuelle.',
        },
        {
          type: 'note',
          ton: 'info',
          titre: 'L’écart entre les deux marges, c’est l’impôt',
          texte:
            'En RDC, l’impôt sur les bénéfices est de **30 %**. Une marge EBE de 10 % ne laisse donc pas 10 % de marge nette. Si votre marge EBE est tout juste au seuil, votre marge nette sera mécaniquement sous le sien : il faut travailler l’EBE, pas la marge nette.',
        },
        {
          type: 'paragraphe',
          texte: '**Comment améliorer vos marges :**',
        },
        {
          type: 'liste',
          ordonnee: true,
          items: [
            '**Monter les prix.** C’est le levier le plus puissant et le plus sous-utilisé. Sur un ticket moyen de 12 USD, passer à 12,60 USD (+5 %) augmente l’EBE bien plus que 5 %, parce que les coûts variables ne suivent qu’en partie et que les charges fixes ne bougent pas.',
            '**Faire baisser le ratio de coûts variables.** Pour un restaurant, le coût matière : renégocier les achats, revoir les portions, réduire les pertes, retravailler la carte vers les plats à meilleure marge. Pour un négoce, la marge commerciale par famille de produits.',
            '**Attaquer les charges fixes une par une.** Loyer, énergie, abonnements, sous-traitance. Un loyer renégocié à la baisse améliore l’EBE tous les mois, sans effort commercial.',
            '**Augmenter le volume sans augmenter les charges fixes.** Des couverts en plus dans la même salle, avec la même équipe, tombent presque entièrement en EBE.',
            '**Vérifier le poids de la masse salariale.** C’est souvent le premier poste. Le bon calibrage se juge en pourcentage du chiffre d’affaires, pas en valeur absolue.',
          ],
        },
      ],
    },
    {
      id: 'autonomie-financiere',
      titre: 'Autonomie financière',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'L’autonomie financière rapporte vos **capitaux propres au total du bilan** : c’est la part de l’entreprise financée par vous plutôt que par vos créanciers. Elle est calculée pour chacun des cinq exercices et affichée dans le bloc « Contrôle » de l’onglet **Bilan**. Le seuil de référence est de **30 %**.',
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'Ce ratio n’a pas de feu tricolore à l’écran',
          texte:
            'Contrairement aux six ratios précédents, l’autonomie financière est affichée **sans pastille de couleur** et sans rappel du seuil, dans l’interface comme dans le PDF. Comparez-la vous-même à 30 %. Le pourcentage progresse naturellement d’année en année à mesure que vous remboursez le crédit et accumulez des résultats : c’est le premier exercice qui est déterminant.',
        },
      ],
    },
    {
      id: 'ce-qui-nest-pas-calcule',
      titre: 'Ce que Lalanda ne calcule pas',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Ces indicateurs sont classiques en analyse d’investissement et vous pourriez les attendre. Ils ne sont **pas** produits aujourd’hui : ne les cherchez pas dans les résultats, et ne les annoncez pas dans un dossier au motif que vous utilisez Lalanda.',
        },
        {
          type: 'liste',
          items: [
            '**VAN** (valeur actualisée nette) — non calculée.',
            '**TRI** (taux de rentabilité interne) — non calculé.',
            '**ROI** et **ratio d’endettement** — non calculés. L’autonomie financière est l’indicateur de structure disponible.',
            '**Scénarios** prudent et ambitieux — non disponibles : un projet porte un seul jeu d’hypothèses. Pour comparer deux montages, créez deux projets.',
          ],
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'Les seuils ne varient pas encore selon le pays',
          texte:
            'Les quatre packs pays livrés portent aujourd’hui **les mêmes sept valeurs de seuils**. Seule la fiscalité — impôt sur les bénéfices, TVA, charges sociales — diffère réellement d’un pays à l’autre. Trois de ces seuils (marge EBE, marge nette, délai de récupération) sont d’ailleurs marqués « à confirmer » dans les packs : ce sont des standards d’analyse crédit, pas des règles publiées par une banque nommée.',
        },
      ],
    },
    {
      id: 'avant-le-rendez-vous',
      titre: 'Avant votre rendez-vous bancaire',
      blocs: [
        {
          type: 'liste',
          ordonnee: true,
          items: [
            '**Aucun ratio au rouge.** Un seul suffit à faire refuser le dossier. S’il en reste un, préparez l’explication plutôt que de la découvrir en séance.',
            '**Sachez citer vos trois chiffres de tête** : chiffre d’affaires annuel, EBE annuel, mensualité de crédit. Un porteur qui doit ouvrir son classeur pour les retrouver inquiète.',
            '**Anticipez le DSCR recalculé.** Votre interlocuteur trouvera probablement un chiffre inférieur au nôtre, pour les raisons expliquées [plus haut](/aide/ratios-bancaires#dscr). Sachez à quoi ressemble votre dossier avec un DSCR calculé sur la capacité d’autofinancement.',
            '**Citez la trésorerie du bilan**, pas celle de la feuille mensuelle, qui est optimiste. Voir [pourquoi les deux diffèrent](/aide/comprendre-les-chiffres#deux-tresoreries).',
            '**Apportez vos justificatifs.** Devis d’équipement, bail, relevés, factures fournisseurs. Le prévisionnel n’a de valeur que si ses hypothèses sont sourçables.',
            '**Déposez un plan validé, pas un brouillon.** Voir [valider et exporter](/aide/valider-et-exporter#figer-un-plan).',
          ],
        },
        {
          type: 'note',
          ton: 'attention',
          titre: 'Lalanda ne remplace pas un expert-comptable',
          texte:
            'L’outil produit un prévisionnel cohérent et conforme au plan de comptes SYSCOHADA, à partir de vos hypothèses. Il ne vérifie pas que vos hypothèses sont réalistes, ne connaît pas votre situation fiscale particulière, et n’engage personne. Pour un dossier significatif, faites relire vos chiffres par un professionnel agréé avant de les déposer.',
        },
      ],
    },
  ],
};
