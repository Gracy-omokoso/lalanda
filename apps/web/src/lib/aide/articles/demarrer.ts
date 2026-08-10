// Article « Démarrer » — le premier projet, le pays, le modèle, les hypothèses.
//
// Sources vérifiées dans le code au moment de la rédaction :
//  - liste des pays et des modèles : apps/web/src/app/(app)/projects/page.tsx
//  - packs livrés : packages/engine/src/parameter-packs/{cd,ci,sn,ohada-generic}-2026.yaml
//  - étapes du wizard : packages/engine/src/templates/*.yaml (bloc `wizard`)
//    + packages/shared/src/wizard (resolveWizardEtapes), docs/06 § Implémenté (S18c)
//  - auto-save, badge « Valeur suggérée », 3 niveaux de validation : docs/06 § Implémenté

import type { ArticleAide } from '../types';

export const DEMARRER: ArticleAide = {
  slug: 'demarrer',
  titre: 'Démarrer',
  resume:
    'Créer votre premier projet, choisir un pays et un modèle, comprendre les valeurs déjà remplies.',
  ordre: 1,
  sections: [
    {
      id: 'en-trois-etapes',
      titre: 'Votre premier dossier en trois étapes',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Lalanda transforme vos hypothèses de terrain en un prévisionnel complet : compte d’exploitation, trésorerie, plan de financement, bilan et ratios bancaires. Vous n’avez rien à calculer. Vous décrivez votre activité, le moteur produit les états.',
        },
        {
          type: 'etapes',
          items: [
            {
              titre: 'Créer le projet',
              texte:
                'Un projet = un plan financier, dans un pays et un cadre fiscal donnés. Vous choisissez le pays, le cadre fiscal, la devise d’affichage, un modèle sectoriel, et vous nommez le projet.',
            },
            {
              titre: 'Ajuster vos hypothèses',
              texte:
                'Le modèle arrive pré-rempli. Vous parcourez les étapes de saisie et remplacez les valeurs par les vôtres : prix, volumes, salaires, loyer, investissement, apport, emprunt.',
            },
            {
              titre: 'Lire les résultats, puis figer le plan',
              texte:
                'Vous recalculez, vous lisez les [ratios que la banque regarde](/aide/ratios-bancaires), vous corrigez, puis vous [validez et exportez](/aide/valider-et-exporter#figer-un-plan) un PDF et un Excel.',
            },
          ],
        },
        {
          type: 'note',
          ton: 'info',
          titre: 'Comptez une à deux heures pour un premier dossier sérieux',
          texte:
            'Le remplissage prend une trentaine de minutes. Le temps utile est ailleurs : réunir vos vrais chiffres — devis d’équipement, loyer réel, salaires réels, prix pratiqués. Un prévisionnel bâti sur des chiffres approximatifs se voit en rendez-vous bancaire.',
        },
      ],
    },
    {
      id: 'choisir-un-pays',
      titre: 'Choisir un pays et un cadre fiscal',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Le pays détermine le **cadre fiscal** appliqué à votre plan : impôt sur les bénéfices, TVA, charges sociales, et les seuils de ratios que les banques locales attendent. Ces valeurs sont regroupées dans un « pack pays » daté et versionné. Un plan garde le pack avec lequel il a été calculé : une mise à jour fiscale ne réécrit jamais un dossier déjà déposé.',
        },
        {
          type: 'tableau',
          entetes: ['Pack livré', 'Devise principale', 'Référentiel comptable'],
          lignes: [
            ['RDC — 2026', 'USD (affichage secondaire CDF)', 'SYSCOHADA révisé 2017'],
            ['Côte d’Ivoire — 2026', 'XOF', 'SYSCOHADA révisé 2017'],
            ['Sénégal — 2026', 'XOF', 'SYSCOHADA révisé 2017'],
            ['OHADA générique — 2026', 'XOF', 'SYSCOHADA révisé 2017'],
          ],
          legende:
            'Quatre packs sont livrés aujourd’hui. Les autres pays OHADA proposés à la création (Cameroun, Bénin, Togo, Mali, Burkina Faso, Niger, Congo-Brazzaville, Gabon) retombent sur le pack générique.',
        },
        {
          type: 'note',
          ton: 'attention',
          titre: 'Le pack générique porte des valeurs médianes',
          texte:
            'Il sert de solution d’attente pour un pays sans pack dédié. Ses taux ne sont pas ceux de votre administration fiscale : ce sont des valeurs prudentes de zone. Si vous déposez un dossier dans un de ces pays, faites vérifier les taux par un comptable local avant remise.',
        },
        {
          type: 'note',
          ton: 'attention',
          titre: 'Certaines valeurs sont marquées « à confirmer »',
          texte:
            'Chaque pack indique les paramètres qui doivent être revalidés — barèmes indexés sur l’inflation, taxes locales, minimum forfaitaire. La liste s’affiche dans l’étape **Synthèse** de la saisie, avec l’avertissement du pack. Lisez-la avant de déposer un dossier officiel : Lalanda ne remplace pas un expert-comptable agréé.',
        },
        {
          type: 'paragraphe',
          texte:
            'La **devise d’affichage** est choisie à la création. En RDC, l’USD est le choix par défaut, parce que c’est la devise dans laquelle les banques locales instruisent les dossiers d’investissement.',
        },
      ],
    },
    {
      id: 'choisir-un-modele',
      titre: 'Choisir un modèle sectoriel',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'Un modèle sectoriel n’est pas un habillage : il décide **quelles questions on vous pose** et **quelles formules relient vos réponses**. Un restaurant se pilote au couvert et au ratio matière ; une quincaillerie à la rotation de stock et à la marge commerciale. Choisissez le modèle le plus proche de votre activité réelle.',
        },
        {
          type: 'tableau',
          entetes: ['Modèle', 'Hypothèses principales'],
          lignes: [
            [
              'Restaurant',
              'Couverts par jour, jours d’ouverture, ticket moyen, ratio matière (food cost)',
            ],
            [
              'Quincaillerie et négoce',
              'Chiffre d’affaires journalier, marge commerciale, rotation de stock',
            ],
            ['Prestation de services', 'Tarif journalier, taux de facturation, taille de l’équipe'],
            [
              'E-commerce (paiement à la livraison)',
              'Budget publicitaire, taux de livraison effective, panier moyen',
            ],
          ],
          legende:
            'Un cinquième modèle, « Démo (hello-world) », est un modèle minimal de test. Ne l’utilisez pas pour un dossier réel.',
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'On ne change pas de modèle en cours de route',
          texte:
            'Le modèle est fixé à la création du projet et n’est pas modifiable ensuite. Si vous vous êtes trompé, créez un nouveau projet. C’est volontaire : changer de modèle changerait les formules sous des chiffres déjà validés.',
        },
      ],
    },
    {
      id: 'hypotheses-pre-remplies',
      titre: 'Comprendre les valeurs déjà remplies',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'À l’ouverture, tous les champs portent déjà une valeur. Ce sont des **valeurs suggérées**, pas vos chiffres. Elles proviennent de deux endroits : le modèle sectoriel (valeurs de terrain) et le pack pays (taux d’impôt, charges sociales, taux de crédit constaté).',
        },
        {
          type: 'liste',
          items: [
            'Tant qu’un champ porte encore la valeur du modèle, il affiche le badge **Valeur suggérée**. Le badge disparaît dès votre première frappe : une suggestion n’est jamais confondue avec une saisie.',
            'Chaque champ porte une aide permanente sous le champ, qui explique ce qu’on attend et dans quelle unité.',
            'La provenance exacte du cadre (modèle, version, pack pays, année, devise, système comptable) est rappelée dans l’étape **Synthèse**.',
          ],
        },
        {
          type: 'note',
          ton: 'attention',
          titre: 'Remplacez systématiquement les valeurs de financement',
          texte:
            'Investissement, apport, capital emprunté, taux et durée du crédit : les valeurs suggérées sont des ordres de grandeur sectoriels. Ce sont aussi les champs qui pilotent les ratios que la banque regarde en premier. Un dossier déposé avec l’apport par défaut est un dossier qui ne parle pas de vous.',
        },
        {
          type: 'exemple',
          titre: 'Ordre de grandeur — restaurant urbain, exercice 1',
          lignes: [
            { libelle: 'Couverts par jour', valeur: '60' },
            { libelle: 'Jours d’ouverture par mois', valeur: '26' },
            { libelle: 'Ticket moyen', valeur: '12 USD' },
            { libelle: 'Chiffre d’affaires annuel qui en découle', valeur: '≈ 224 600 USD' },
          ],
          conclusion:
            'Trois hypothèses suffisent à produire le chiffre d’affaires. C’est aussi pourquoi une erreur sur le ticket moyen se propage à tout le dossier : vérifiez d’abord ces trois-là.',
        },
      ],
    },
    {
      id: 'saisir-ses-hypotheses',
      titre: 'Parcourir la saisie',
      blocs: [
        {
          type: 'paragraphe',
          texte:
            'La saisie est découpée en étapes, dans l’ordre où l’on construit un prévisionnel. Pour le modèle restaurant : chiffre d’affaires, coûts variables, charges fixes et personnel, investissement et financement, fiscalité, puis synthèse. Les autres modèles suivent le même principe, avec les étapes propres à leur activité.',
        },
        {
          type: 'liste',
          items: [
            '**Vos saisies sont enregistrées automatiquement**, sans bouton. L’état est annoncé en haut de la saisie : « Enregistrement… », puis « Enregistré à 14:32:07 ». Si vous quittez la page pendant un enregistrement, le navigateur vous prévient.',
            '**Trois niveaux de signalement.** Rouge : la valeur est impossible (vide, texte, hors des bornes admises) — elle bloque la validation et l’export, jamais la sauvegarde. Orange : la valeur est inhabituelle mais acceptée. Gris : une explication.',
            '**Le calcul est différé.** Il ne se relance pas à chaque frappe. Dès que vos hypothèses divergent du dernier calcul, un bandeau « Résultats obsolètes » et un bouton « Recalculer » apparaissent au-dessus des résultats.',
            'Les résultats, les exports et la liste des plans validés restent accessibles depuis n’importe quelle étape.',
          ],
        },
        {
          type: 'note',
          ton: 'limite',
          titre: 'Ce que la saisie ne fait pas encore',
          texte:
            'Elle ne reprend pas automatiquement à la dernière étape consultée, ne permet pas de marquer une étape « à revoir », d’y attacher un commentaire ou de l’assigner à quelqu’un, ni d’importer vos hypothèses depuis un fichier. Ces éléments sont prévus, ils ne sont pas livrés.',
        },
        {
          type: 'paragraphe',
          texte:
            'Une fois la saisie faite, passez à [la lecture des états financiers](/aide/comprendre-les-chiffres) puis aux [ratios bancaires](/aide/ratios-bancaires).',
        },
      ],
    },
  ],
};
