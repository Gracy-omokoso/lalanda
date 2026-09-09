// Tests du questionnaire de cadrage (S23b).
//
// L'assertion centrale de ce fichier est la troisième : AUCUN driver numérique
// n'est posé à partir d'une réponse en texte. C'est elle qui protège la règle
// « le moteur financier est l'unique source de vérité des calculs » (CLAUDE.md).
// Un chiffre deviné à partir d'une phrase libre atterrirait dans un dossier
// bancaire sans que personne ne puisse le distinguer d'un chiffre saisi.

import { describe, expect, it } from 'vitest';

import type { TemplateDriverMeta } from '@/lib/api';

import {
  buildCanvasBlocks,
  buildDriverValues,
  compterCartes,
  nomProjet,
  questionsAffichables,
  QUESTIONS,
  type Reponses,
} from './custom-questionnaire-model';

/** Sous-ensemble des drivers du modèle `custom` touchés par le questionnaire. */
const DRIVERS: TemplateDriverMeta[] = [
  { id: 'ca_moyen_jour', label: "Chiffre d'affaires moyen par jour", type: 'money', min: 0 },
  { id: 'jours_ouverture_mois', label: "Jours d'activité par mois", type: 'number', min: 1, max: 31 },
  { id: 'marge_brute_pct', label: 'Marge brute sur les ventes', type: 'percent', min: 0, max: 1 },
  { id: 'personnel_mois', label: 'Masse salariale mensuelle', type: 'money', min: 0 },
  { id: 'loyer_mois', label: 'Loyer mensuel', type: 'money', min: 0 },
];

/** Un parcours complet et plausible. */
const COMPLET: Reponses = {
  nom_projet: '  Mon activité 2026 ',
  nature_offre: 'Un produit',
  probleme: 'Les clients doivent faire deux heures de route.',
  solution: 'Je vends à dix minutes de chez eux.',
  offre: 'Trois gammes, de la plus courante à la plus technique.',
  clients: 'Les familles du quartier et les artisans.',
  canaux: 'Sur place, et par téléphone.',
  ressources: 'Un local, deux personnes, du matériel.',
  partenaires: 'Un fournisseur principal et un transporteur.',
  couts: 'Les achats, puis les salaires.',
  q_ca_moyen_jour: '450',
  q_jours_ouverture_mois: '24',
  q_marge_brute_pct: '35',
  q_personnel_mois: '900',
  q_loyer_mois: '250',
};

describe('structure du questionnaire', () => {
  it('pose un seul champ par étape et un id unique par question', () => {
    const ids = QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sépare strictement les deux natures de question', () => {
    for (const q of QUESTIONS) {
      if (q.kind === 'nombre') {
        // Une question numérique ne désigne aucun bloc de Canvas.
        expect('bloc' in q).toBe(false);
        expect(q.driverId.length).toBeGreaterThan(0);
      } else if (q.kind === 'texte' || q.kind === 'choix') {
        // Une question en texte ne désigne aucun driver.
        expect('driverId' in q).toBe(false);
        expect(q.bloc.length).toBeGreaterThan(0);
      }
    }
  });

  it('retire du parcours une question dont le driver a disparu du template', () => {
    const sansMarge = DRIVERS.filter((d) => d.id !== 'marge_brute_pct');
    const affichables = questionsAffichables(sansMarge);
    expect(affichables.some((q) => q.kind === 'nombre' && q.driverId === 'marge_brute_pct')).toBe(
      false,
    );
    // Les questions en texte ne dépendent d'aucun driver : elles restent toutes.
    expect(affichables.filter((q) => q.kind === 'texte')).toHaveLength(
      QUESTIONS.filter((q) => q.kind === 'texte').length,
    );
  });
});

describe('préremplissage du Canvas', () => {
  it('remplit les blocs BMC attendus, un par question en texte', () => {
    const blocs = buildCanvasBlocks(COMPLET);

    // Les trois questions « problème / solution / offre » alimentent le même bloc,
    // dans l'ordre du parcours.
    expect(blocs.proposition_valeur.map((c) => c.texte)).toEqual([
      'Les clients doivent faire deux heures de route.',
      'Je vends à dix minutes de chez eux.',
      'Trois gammes, de la plus courante à la plus technique.',
    ]);
    expect(blocs.proposition_valeur.map((c) => c.ordre)).toEqual([0, 1, 2]);

    expect(blocs.segments_clients[0]?.texte).toBe('Les familles du quartier et les artisans.');
    expect(blocs.canaux[0]?.texte).toBe('Sur place, et par téléphone.');
    expect(blocs.ressources_cles[0]?.texte).toBe('Un local, deux personnes, du matériel.');
    expect(blocs.partenaires_cles[0]?.texte).toBe('Un fournisseur principal et un transporteur.');
    expect(blocs.couts[0]?.texte).toBe('Les achats, puis les salaires.');
    expect(blocs.revenus[0]?.texte).toBe('Nature de l’offre : Un produit');

    // Les deux blocs non couverts restent vides — ils se remplissent dans l'écran
    // Canvas. Un bloc vide est une invitation, pas une perte.
    expect(blocs.relations_clients).toEqual([]);
    expect(blocs.activites_cles).toEqual([]);
  });

  it('produit les neuf blocs même sans aucune réponse', () => {
    const blocs = buildCanvasBlocks({});
    // L'API refuse un PUT partiel : un bloc omis serait une erreur 400.
    expect(Object.keys(blocs)).toHaveLength(9);
    expect(compterCartes(blocs)).toBe(0);
  });

  it('donne des ids de cartes stables et conformes au format de l’API', () => {
    const a = buildCanvasBlocks(COMPLET);
    const b = buildCanvasBlocks(COMPLET);
    expect(a.proposition_valeur.map((c) => c.id)).toEqual(b.proposition_valeur.map((c) => c.id));
    for (const carte of a.proposition_valeur) {
      expect(carte.id).toMatch(/^[a-z0-9][a-z0-9_-]*$/i);
    }
  });

  it('tronque une réponse trop longue à la limite de l’API', () => {
    const blocs = buildCanvasBlocks({ probleme: 'x'.repeat(900) });
    expect(blocs.proposition_valeur[0]?.texte).toHaveLength(500);
  });

  it('n’écrit aucune carte pour une réponse vide ou faite d’espaces', () => {
    const blocs = buildCanvasBlocks({ probleme: '   ', solution: '' });
    expect(compterCartes(blocs)).toBe(0);
  });

  it('nettoie le nom du projet', () => {
    expect(nomProjet(COMPLET)).toBe('Mon activité 2026');
    expect(nomProjet({})).toBe('');
  });
});

describe('préremplissage des drivers', () => {
  it('pose les drivers des réponses numériques, pourcentage converti en fraction', () => {
    expect(buildDriverValues(COMPLET, DRIVERS)).toEqual({
      ca_moyen_jour: 450,
      jours_ouverture_mois: 24,
      marge_brute_pct: 0.35, // saisi en points, stocké en fraction — comme l'assistant
      personnel_mois: 900,
      loyer_mois: 250,
    });
  });

  // ══ L'ASSERTION QUI PROTÈGE LA RÈGLE ═════════════════════════
  it('ne pose AUCUN driver à partir d’une réponse en texte, même truffée de chiffres', () => {
    const piege: Reponses = {
      nom_projet: 'Budget 12000 USD',
      nature_offre: 'Un produit à 15 000',
      probleme: 'Mon coût de revient tourne autour de 12 000 par mois.',
      solution: 'Je vise 500 de chiffre d’affaires par jour, 26 jours sur 30.',
      offre: 'Une marge de 35 % environ, parfois 40 %.',
      clients: '3000 familles.',
      canaux: '2 points de vente.',
      ressources: 'Un local à 300 de loyer et 900 de salaires.',
      partenaires: '4 fournisseurs.',
      couts: 'Environ 5460 d’achats par mois.',
    };
    // Aucune question numérique n'a été répondue : aucun driver ne doit sortir.
    expect(buildDriverValues(piege, DRIVERS)).toEqual({});
  });

  it('ne pose rien pour une réponse vide ou illisible — le défaut du modèle s’applique', () => {
    const partiel: Reponses = {
      q_ca_moyen_jour: '450',
      q_jours_ouverture_mois: '',
      q_marge_brute_pct: '   ',
      q_personnel_mois: 'beaucoup',
      q_loyer_mois: '-',
    };
    expect(buildDriverValues(partiel, DRIVERS)).toEqual({ ca_moyen_jour: 450 });
  });

  it('accepte la virgule décimale, comme l’assistant', () => {
    expect(buildDriverValues({ q_ca_moyen_jour: '450,50' }, DRIVERS)).toEqual({
      ca_moyen_jour: 450.5,
    });
  });

  it('pose une valeur hors bornes plutôt que de la faire disparaître', () => {
    // Elle s'affichera en erreur bloquante dans l'assistant, où l'utilisateur la
    // voit et la corrige. L'écarter en silence lui ferait croire qu'il l'a saisie.
    expect(buildDriverValues({ q_jours_ouverture_mois: '45' }, DRIVERS)).toEqual({
      jours_ouverture_mois: 45,
    });
  });

  it('ignore une question dont le driver n’existe plus dans le template', () => {
    const sansLoyer = DRIVERS.filter((d) => d.id !== 'loyer_mois');
    const valeurs = buildDriverValues(COMPLET, sansLoyer);
    expect(valeurs.loyer_mois).toBeUndefined();
    expect(valeurs.ca_moyen_jour).toBe(450);
  });
});

describe('abandon en cours de route', () => {
  it('conserve tout ce qui a été répondu jusque-là, sans rien inventer', () => {
    // L'utilisateur s'arrête après la question « à qui vendez-vous ».
    const interrompu: Reponses = {
      nom_projet: 'Mon activité 2026',
      nature_offre: 'Un service',
      probleme: 'Les clients doivent faire deux heures de route.',
      solution: 'Je vends à dix minutes de chez eux.',
      clients: 'Les familles du quartier.',
    };
    const blocs = buildCanvasBlocks(interrompu);

    expect(nomProjet(interrompu)).toBe('Mon activité 2026');
    expect(compterCartes(blocs)).toBe(4);
    expect(blocs.proposition_valeur.map((c) => c.texte)).toEqual([
      'Les clients doivent faire deux heures de route.',
      'Je vends à dix minutes de chez eux.',
    ]);
    // « offre » a été passée : sa carte n'existe pas, et l'ordre des suivantes se
    // resserre — pas de trou, pas de carte fantôme.
    expect(blocs.proposition_valeur.map((c) => c.ordre)).toEqual([0, 1]);
    expect(blocs.segments_clients[0]?.texte).toBe('Les familles du quartier.');
    // Aucune question numérique atteinte : le plan financier part des défauts.
    expect(buildDriverValues(interrompu, DRIVERS)).toEqual({});
  });

  it('supporte un abandon dès la première question', () => {
    expect(compterCartes(buildCanvasBlocks({ nom_projet: 'Essai' }))).toBe(0);
    expect(buildDriverValues({ nom_projet: 'Essai' }, DRIVERS)).toEqual({});
  });
});

describe('retour en arrière', () => {
  it('ne dépend que des réponses : revenir puis repartir ne change rien', () => {
    // Les sorties sont des fonctions pures des réponses. Le composant conserve
    // l'état des réponses en remontant, donc corriger une étape déjà passée est
    // exactement équivalent à l'avoir saisie ainsi du premier coup.
    const corrige: Reponses = { ...COMPLET, clients: 'Les artisans uniquement.', q_ca_moyen_jour: '600' };
    expect(buildCanvasBlocks(corrige).segments_clients[0]?.texte).toBe('Les artisans uniquement.');
    expect(buildDriverValues(corrige, DRIVERS).ca_moyen_jour).toBe(600);
    // Les autres réponses sont intactes.
    expect(buildCanvasBlocks(corrige).canaux[0]?.texte).toBe(
      buildCanvasBlocks(COMPLET).canaux[0]?.texte,
    );
    expect(buildDriverValues(corrige, DRIVERS).loyer_mois).toBe(250);
  });
});
