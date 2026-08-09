// Glossaire du centre d'aide.
//
// Reprend et étend `docs/GLOSSAIRE.md`, en ajoutant à chaque terme ce que ce
// document ne dit pas : le produit calcule-t-il ce chiffre, oui ou non ?
//
// Vérifications faites au moment de la rédaction (statut `non_calcule`) :
//  - VAN / TRI : `npv` et `irr` figurent dans la whitelist du compilateur
//    (packages/engine/src/compiler/formula-refs.ts) mais AUCUN template livré ne
//    les emploie. Rien n'est donc produit.
//  - Scénario : aucun mécanisme de jeu d'hypothèses alternatif. Un projet porte
//    un seul jeu de valeurs.
//  - Dettes fiscales et sociales : le champ existe, sa valeur est constamment 0
//    (packages/engine/src/etats-financiers/index.ts, convention 3).
//  - Point mort et seuil de rentabilité, eux, SONT calculés (feuille `Seuil`) —
//    ne pas les basculer en `non_calcule` par analogie avec VAN et TRI.
//
// Règle : un terme dont le calcul n'existe pas est marqué `non_calcule` et la
// définition le dit en toutes lettres. On ne laisse jamais croire à une
// fonctionnalité par le seul fait de définir le mot.

import type { ArticleAide } from '../types';

export const GLOSSAIRE: ArticleAide = {
  slug: 'glossaire',
  titre: 'Glossaire',
  resume:
    'Le vocabulaire du prévisionnel expliqué en français courant, avec pour chaque terme ce que Lalanda calcule — ou ne calcule pas.',
  ordre: 7,
  sections: [
    {
      id: 'comment-lire',
      titre: 'Comment lire ce glossaire',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Chaque terme porte une étiquette qui dit son statut dans le produit. **Calculé par Lalanda** : le chiffre existe, vous le trouverez dans les résultats. **Notion** : le mot est utile pour comprendre, mais ne correspond pas à une ligne affichée telle quelle. **Non calculé aujourd’hui** : le terme est courant en finance, et Lalanda ne le produit pas — ne l’annoncez pas dans un dossier au motif que vous utilisez l’outil.',
        },
      ],
    },
    {
      id: 'chiffres-calcules',
      titre: 'Les chiffres que Lalanda calcule',
      blocs: [
        {
          type: 'glossaire',
          entrees: [
            {
              terme: 'Amortissement',
              statut: 'calcule',
              definition:
                'Étalement comptable du coût d’un équipement sur sa durée d’usage, au lieu de le passer en charge en une seule fois. La **dotation aux amortissements** est la part imputée à un exercice donné.',
              ou: 'Onglet **Amortissements**, année par année. Voir [la feuille Amortissements](/aide/comprendre-les-chiffres#amortissements).',
            },
            {
              terme: 'Apport personnel',
              statut: 'calcule',
              definition:
                'L’argent que vous engagez vous-même, par opposition à ce que vous empruntez. Lalanda en calcule le ratio sur le total de vos besoins ; le seuil attendu est de 25 %.',
              ou: 'Voir [le ratio d’apport](/aide/ratios-bancaires#apport).',
            },
            {
              terme: 'Autonomie financière',
              statut: 'calcule',
              definition:
                'Part de l’entreprise financée par vos capitaux propres plutôt que par vos dettes. Calculée pour chaque exercice, elle est affichée **sans feu tricolore** : comparez-la vous-même au seuil de 30 %.',
              ou: 'Bloc « Contrôle » de l’onglet **Bilan**. Voir [autonomie financière](/aide/ratios-bancaires#autonomie-financiere).',
            },
            {
              terme: 'BFR — besoin en fonds de roulement',
              statut: 'calcule',
              definition:
                'L’argent immobilisé en permanence par le fonctionnement de l’activité : vos stocks et ce que vos clients vous doivent, moins ce que vous devez à vos fournisseurs. C’est de la trésorerie que vous devez avancer avant d’encaisser.',
              ou: 'Onglet **BFR**, avec sa variation annuelle et son équivalent en jours de chiffre d’affaires. Voir [le BFR](/aide/comprendre-les-chiffres#bfr).',
            },
            {
              terme: 'CAF — capacité d’autofinancement',
              statut: 'calcule',
              definition:
                'L’argent que l’activité dégage réellement sur un exercice : le résultat net auquel on rajoute les dotations aux amortissements, puisque celles-ci ne sortent pas de votre caisse. C’est là-dedans que se prend le remboursement du crédit.',
              ou: 'Onglet **CAF**. Voir [la CAF](/aide/comprendre-les-chiffres#caf).',
            },
            {
              terme: 'Délai de récupération',
              statut: 'calcule',
              definition:
                'Le nombre d’années au bout duquel l’investissement est considéré comme remboursé. Seuil attendu : 5 ans. **Attention** : Lalanda le calcule comme capital emprunté ÷ résultat de la première année, ce qui n’est pas la définition la plus courante.',
              ou: 'Voir [le délai de récupération](/aide/ratios-bancaires#payback).',
            },
            {
              terme: 'DSCR',
              statut: 'calcule',
              definition:
                'Capacité à couvrir le service de la dette : ce que l’activité dégage sur l’année, rapporté à ce que vous devez rembourser cette année-là. Le ratio décisif d’un crédit d’investissement. Seuil attendu : 1,25.',
              ou: 'Voir [le DSCR](/aide/ratios-bancaires#dscr), y compris pourquoi le calcul de votre banquier donnera un chiffre plus bas.',
            },
            {
              terme: 'EBE — excédent brut d’exploitation',
              statut: 'calcule',
              definition:
                'Ce que dégage l’exploitation avant impôt, avant amortissements et avant intérêts d’emprunt. Le juge de paix de l’activité : s’il est négatif, aucun montage financier ne sauvera le dossier.',
              ou: 'Onglet **Compte d’exploitation**, et ratio **Marge EBE**.',
            },
            {
              terme: 'Marge de sécurité',
              statut: 'calcule',
              definition:
                'De combien votre chiffre d’affaires peut baisser avant de repasser sous le seuil de rentabilité. Votre coussin en cas de mauvaise année.',
              ou: 'Onglet **Seuil**. Voir [seuil de rentabilité et point mort](/aide/comprendre-les-chiffres#seuil-rentabilite).',
            },
            {
              terme: 'Marge nette',
              statut: 'calcule',
              definition:
                'Le résultat net rapporté au chiffre d’affaires : ce qui reste réellement une fois l’impôt payé. Seuil attendu : 5 %.',
              ou: 'Voir [les marges](/aide/ratios-bancaires#marges).',
            },
            {
              terme: 'Point mort',
              statut: 'calcule',
              definition:
                'Le moment de l’exercice où vous atteignez le seuil de rentabilité, exprimé en mois. Un point mort à 9 mois signifie que vous travaillez neuf mois pour couvrir vos charges et gagnez de l’argent les trois derniers.',
              ou: 'Onglet **Seuil**, pour chacun des cinq exercices.',
            },
            {
              terme: 'Seuil de rentabilité',
              statut: 'calcule',
              definition:
                'Le niveau de chiffre d’affaires à partir duquel vous ne perdez plus d’argent : charges fixes divisées par le taux de marge sur coûts variables.',
              ou: 'Onglet **Seuil**.',
            },
            {
              terme: 'Service de la dette',
              statut: 'calcule',
              definition:
                'La somme de ce que vous remboursez à la banque sur une année, capital et intérêts confondus. C’est le dénominateur du DSCR.',
              ou: 'Onglet **Financement**.',
            },
            {
              terme: 'Trésorerie minimale',
              statut: 'calcule',
              definition:
                'Le point le plus bas de votre caisse au cours de la première année. Doit rester positif : une trésorerie négative à un seul mois suffit à faire refuser un dossier. **Calculée sur une vue simplifiée et optimiste.**',
              ou: 'Voir [la trésorerie minimale](/aide/ratios-bancaires#tresorerie-mini) et [pourquoi les deux trésoreries diffèrent](/aide/comprendre-les-chiffres#deux-tresoreries).',
            },
            {
              terme: 'Valeur nette comptable',
              statut: 'calcule',
              definition:
                'Ce que vaut un équipement dans vos comptes après déduction des amortissements déjà pratiqués.',
              ou: 'Onglet **Amortissements**.',
            },
          ],
        },
      ],
    },
    {
      id: 'notions',
      titre: 'Les notions à connaître',
      blocs: [
        {
          type: 'glossaire',
          entrees: [
            {
              terme: 'Canvas',
              statut: 'concept',
              definition:
                'Le Business Model Canvas : une description de votre modèle économique en neuf blocs — clients, proposition de valeur, canaux, ressources, revenus, coûts. C’est du texte qui accompagne le dossier, pas un calcul.',
              ou: 'Onglet **Canvas** du projet.',
            },
            {
              terme: 'Charges fixes',
              statut: 'concept',
              definition:
                'Ce que vous payez que vous vendiez ou non : loyer, salaires, abonnements. Par opposition aux **charges variables**, qui suivent les ventes — matières, marchandises, livraison.',
              ou: 'Onglet **Compte d’exploitation**. Note : dans les projections, les charges fixes suivent le chiffre d’affaires, ce qui **sous-estime** votre rentabilité future.',
            },
            {
              terme: 'Immobilisation',
              statut: 'concept',
              definition:
                'Un bien durable acheté pour l’activité — véhicule, four, mobilier, aménagement. On ne le passe pas en charge d’un coup : on l’amortit.',
              ou: 'Onglets **Amortissements** et **Bilan**.',
            },
            {
              terme: 'Moteur',
              statut: 'concept',
              definition:
                'Le composant qui calcule vos résultats. Il est déterministe : les mêmes hypothèses produisent toujours exactement les mêmes chiffres. C’est lui, et lui seul, qui fait autorité sur les montants affichés et exportés.',
            },
            {
              terme: 'Pack pays',
              statut: 'concept',
              definition:
                'L’ensemble daté et versionné des règles d’un pays : impôt sur les bénéfices, TVA, charges sociales, taux de crédit constatés, seuils de ratios. Un plan garde le pack avec lequel il a été calculé — une mise à jour fiscale ne réécrit jamais un dossier déjà déposé.',
              ou: 'Choisi à la création du projet. Voir [choisir un pays](/aide/demarrer#choisir-un-pays).',
            },
            {
              terme: 'Plan validé',
              statut: 'concept',
              definition:
                'Une version figée et immuable de votre prévisionnel, numérotée v1, v2, v3… C’est elle que vous déposez, et elle sert de référence au suivi du réalisé.',
              ou: 'Voir [figer un plan](/aide/valider-et-exporter#figer-un-plan).',
            },
            {
              terme: 'Prévisionnel',
              statut: 'concept',
              definition:
                'Les valeurs estimées avant d’avoir observé quoi que ce soit. C’est ce que produit Lalanda à partir de vos hypothèses.',
            },
            {
              terme: 'Projection actualisée',
              statut: 'concept',
              definition:
                'Votre meilleure estimation d’atterrissage aujourd’hui : le réalisé des mois déjà clôturés, complété par le prévu pour les mois restants. À ne pas confondre avec le prévisionnel, qui reste figé.',
              ou: 'Onglet **Réalisé**. Voir [la projection actualisée](/aide/suivre-son-activite#projection-actualisee).',
            },
            {
              terme: 'Réalisé',
              statut: 'concept',
              definition:
                'Les chiffres effectivement observés, que vous saisissez mois par mois pour les comparer au plan validé.',
              ou: 'Voir [suivre son activité](/aide/suivre-son-activite).',
            },
            {
              terme: 'SYSCOHADA',
              statut: 'concept',
              definition:
                'Le référentiel comptable commun aux pays de l’OHADA, dans sa version révisée de 2017. C’est le plan de comptes selon lequel vos états financiers sont présentés — donc celui que votre banquier et votre comptable connaissent.',
            },
          ],
        },
      ],
    },
    {
      id: 'non-calcules',
      titre: 'Les termes que Lalanda ne calcule pas',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Ces notions reviennent souvent dans les discussions de financement. Elles sont définies ici pour que vous compreniez votre interlocuteur — **pas** parce que Lalanda les produit.',
        },
        {
          type: 'glossaire',
          entrees: [
            {
              terme: 'VAN — valeur actualisée nette',
              statut: 'non_calcule',
              definition:
                'Ce que vaut aujourd’hui l’ensemble des flux futurs d’un investissement, une fois ramenés à leur valeur présente. **Lalanda ne la calcule pas** : vous ne la trouverez dans aucun écran ni aucun export.',
            },
            {
              terme: 'TRI — taux de rentabilité interne',
              statut: 'non_calcule',
              definition:
                'Le taux de rendement annuel que dégage un investissement sur sa durée. **Lalanda ne le calcule pas.**',
            },
            {
              terme: 'ROI — retour sur investissement',
              statut: 'non_calcule',
              definition:
                'Le gain rapporté à la somme investie. **Lalanda ne le calcule pas.** L’indicateur disponible qui s’en rapproche le plus est le [délai de récupération](/aide/ratios-bancaires#payback).',
            },
            {
              terme: 'Ratio d’endettement',
              statut: 'non_calcule',
              definition:
                'Le poids des dettes dans le financement de l’entreprise. **Lalanda ne le calcule pas.** L’indicateur de structure disponible est l’**autonomie financière**, qui en est le miroir.',
            },
            {
              terme: 'Scénario',
              statut: 'non_calcule',
              definition:
                'Un jeu d’hypothèses alternatif — prudent, ambitieux — permettant de comparer plusieurs trajectoires. **Non disponible** : un projet porte un seul jeu d’hypothèses. Pour comparer deux montages, créez deux projets.',
            },
            {
              terme: 'Dettes fiscales et sociales',
              statut: 'non_calcule',
              definition:
                'Ce que vous devez au fisc et aux organismes sociaux à la clôture. La ligne existe au bilan mais **reste à zéro** : le modèle suppose que vous payez comptant. C’est une hypothèse prudente — un décalage réel améliorerait votre trésorerie affichée.',
              ou: 'Onglets **Bilan** et **BFR**.',
            },
          ],
        },
      ],
    },
  ],
};
