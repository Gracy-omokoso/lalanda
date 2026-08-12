// Tests du garde-fou numérique (S24a).
//
// La règle vérifiée ici est celle de `CLAUDE.md` : « le moteur financier est
// l'unique source de vérité des calculs ». Un chiffre qui n'en vient pas ne doit
// jamais atteindre l'écran, quelle que soit la qualité de la phrase qui le porte.

import { describe, expect, it } from 'vitest';

import {
  canoniseTokenFr,
  chiffresNonAutorises,
  construireChiffresAutorises,
  nombreCanonique,
  tokensNumeriques,
  type SourceChiffree,
} from './lala-nombres.js';

describe('nombreCanonique', () => {
  it('rogne les zéros de queue et neutralise le bruit flottant', () => {
    expect(nombreCanonique(18.5)).toBe('18.5');
    expect(nombreCanonique(19)).toBe('19');
    expect(nombreCanonique(0.1 + 0.2)).toBe('0.3');
    expect(nombreCanonique(-0)).toBe('0');
  });

  it('refuse ce qui ne se cite pas dans une phrase', () => {
    expect(nombreCanonique(Number.NaN)).toBeNull();
    expect(nombreCanonique(Number.POSITIVE_INFINITY)).toBeNull();
    expect(nombreCanonique(1e20)).toBeNull();
  });
});

describe('canoniseTokenFr — lecture française', () => {
  it('la virgule est décimale, l’espace est un séparateur de milliers', () => {
    expect(canoniseTokenFr('18,5')).toBe('18.5');
    expect(canoniseTokenFr('1 234,56')).toBe('1234.56');
    // Espace insécable puis fine insécable : les deux sorties possibles d'Intl.
    expect(canoniseTokenFr('1 234')).toBe('1234');
    expect(canoniseTokenFr('1 234 567')).toBe('1234567');
  });

  it('le point est tranché par la taille du groupe qui le suit', () => {
    // Valeur brute du moteur recopiée telle quelle.
    expect(canoniseTokenFr('0.185')).toBe('0.185');
    // Séparateur de milliers à l'anglo-saxonne.
    expect(canoniseTokenFr('1.234.567')).toBe('1234567');
    expect(canoniseTokenFr('12.5')).toBe('12.5');
  });

  it('refuse un fragment ambigu plutôt que de deviner', () => {
    expect(canoniseTokenFr('1,2,3')).toBeNull();
    expect(canoniseTokenFr('')).toBeNull();
  });
});

describe('tokensNumeriques', () => {
  it('s’arrête au premier caractère non numérique', () => {
    expect(tokensNumeriques('sur 12 mois, soit 1 234,56 USD')).toEqual(new Set(['12', '1234.56']));
  });

  it('un texte sans chiffre ne rend rien', () => {
    expect(tokensNumeriques('Votre marge se dégrade.')).toEqual(new Set());
  });
});

// ─── Le cœur du garde-fou ────────────────────────────────────────────────────

/** Une ligne de ratio telle que le moteur la produit, avec son rendu affiché. */
const DSCR: SourceChiffree = {
  valeur: 0.82,
  valeurAffichee: '0,82',
  label: 'DSCR (couverture du service de la dette)',
  seuil: { valeur: 1.25, valeurAffichee: '1,25' },
};

describe('construireChiffresAutorises', () => {
  it('autorise la valeur, le seuil, leurs rendus et le zéro', () => {
    const a = construireChiffresAutorises([DSCR]);
    expect(a.has('0.82')).toBe(true);
    expect(a.has('1.25')).toBe(true);
    expect(a.has('0')).toBe(true);
  });

  it('autorise les deux écritures d’un pourcentage (fraction et points)', () => {
    const marge: SourceChiffree = {
      valeur: 0.185,
      valeurAffichee: '18,5 %',
      label: 'Marge nette',
    };
    const a = construireChiffresAutorises([marge]);
    expect(a.has('0.185')).toBe(true);
    expect(a.has('18.5')).toBe(true);
  });

  it('autorise la magnitude d’une valeur négative', () => {
    const perte: SourceChiffree = {
      valeur: -1500,
      valeurAffichee: '-1 500 USD',
      label: 'Résultat net mensuel',
    };
    const a = construireChiffresAutorises([perte]);
    expect(a.has('1500')).toBe(true);
  });

  it('autorise les nombres déjà présents dans un libellé du moteur', () => {
    const ligne: SourceChiffree = {
      valeur: 42000,
      valeurAffichee: '42 000 USD',
      label: 'Chiffre d’affaires — exercice 3',
    };
    const a = construireChiffresAutorises([ligne]);
    expect(a.has('3')).toBe(true);
  });

  it('autorise les nombres d’une réserve de portée injectée dans le prompt', () => {
    const a = construireChiffresAutorises(
      [DSCR],
      ['Vue mensuelle simplifiée de l’année 1, sur 12 mois.'],
    );
    expect(a.has('12')).toBe(true);
    expect(a.has('1')).toBe(true);
  });
});

describe('chiffresNonAutorises — une interprétation ne cite que le moteur', () => {
  const autorises = construireChiffresAutorises([DSCR]);

  it('accepte une interprétation qui recopie la valeur et le seuil', () => {
    const texte =
      'Votre DSCR ressort à 0,82 alors que la banque attend au moins 1,25 : ' +
      'les flux dégagés ne couvrent pas encore l’échéance de prêt.';
    expect(chiffresNonAutorises(texte, autorises)).toEqual([]);
  });

  it('REJETTE un chiffre absent du moteur, même plausible', () => {
    // 0,95 n'a jamais été calculé : c'est une projection inventée par le modèle.
    const texte = 'Avec un différé de six mois, votre DSCR remonterait à 0,95.';
    expect(chiffresNonAutorises(texte, autorises)).toEqual(['0,95']);
  });

  it('REJETTE un montant recomposé à partir de deux lignes', () => {
    // 2,07 = 0,82 + 1,25. Recomposer, c'est calculer : interdit.
    const texte = 'L’écart cumulé atteint 2,07 points de couverture.';
    expect(chiffresNonAutorises(texte, autorises)).toEqual(['2,07']);
  });

  it('REJETTE un fragment numérique illisible plutôt que de le laisser passer', () => {
    expect(chiffresNonAutorises('Un ratio de 1,2,3 points.', autorises)).toEqual(['1,2,3']);
  });

  it('tolère le zéro comme repère de signe', () => {
    expect(chiffresNonAutorises('Le solde reste au-dessus de 0.', autorises)).toEqual([]);
  });

  it('une phrase sans chiffre passe toujours', () => {
    expect(chiffresNonAutorises('Ce ratio est en zone rouge.', autorises)).toEqual([]);
  });
});
