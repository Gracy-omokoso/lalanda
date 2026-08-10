// Règle de placement horizontal de l'infobulle.
//
// Seule la logique pure est testée : le rendu React n'a pas d'environnement DOM
// dans ce paquet (voir `vitest.config.ts`). C'est justement pour ça que le
// calcul vit dans une fonction séparée — une bulle qui sort de l'écran à 375 px
// est un bug qu'on doit pouvoir attraper sans navigateur.

import { describe, expect, it } from 'vitest';

import { decalageInfobulle, MARGE_ECRAN } from './infobulle';

describe('decalageInfobulle', () => {
  it('ne décale rien quand la position centrée tient déjà', () => {
    expect(
      decalageInfobulle({ centreDeclencheur: 640, largeurBulle: 272, largeurFenetre: 1280 }),
    ).toBe(0);
  });

  it('repousse vers la droite un déclencheur trop proche du bord gauche', () => {
    // Centrée, la bulle commencerait à 20 - 136 = -116 : hors écran.
    const d = decalageInfobulle({
      centreDeclencheur: 20,
      largeurBulle: 272,
      largeurFenetre: 375,
    });
    expect(20 - 272 / 2 + d).toBe(MARGE_ECRAN);
  });

  it('ramène vers la gauche un déclencheur trop proche du bord droit', () => {
    // 375 px : le cas mobile de la consigne.
    const largeurBulle = 272;
    const d = decalageInfobulle({
      centreDeclencheur: 350,
      largeurBulle,
      largeurFenetre: 375,
    });
    const gauche = 350 - largeurBulle / 2 + d;
    expect(gauche).toBe(375 - MARGE_ECRAN - largeurBulle);
    expect(gauche + largeurBulle).toBeLessThanOrEqual(375 - MARGE_ECRAN);
  });

  it('colle au bord gauche quand la bulle est plus large que la fenêtre', () => {
    // Cas dégénéré : la borne haute passe sous la borne basse. On privilégie le
    // début du texte plutôt qu'un centrage qui couperait les deux côtés.
    const d = decalageInfobulle({
      centreDeclencheur: 150,
      largeurBulle: 400,
      largeurFenetre: 320,
    });
    expect(150 - 400 / 2 + d).toBe(MARGE_ECRAN);
  });

  it('respecte une marge explicite', () => {
    const d = decalageInfobulle({
      centreDeclencheur: 10,
      largeurBulle: 200,
      largeurFenetre: 375,
      marge: 40,
    });
    expect(10 - 100 + d).toBe(40);
  });

  it('renvoie un entier — un décalage sous-pixel fait baver le texte', () => {
    const d = decalageInfobulle({
      centreDeclencheur: 17.3,
      largeurBulle: 271.5,
      largeurFenetre: 375,
    });
    expect(Number.isInteger(d)).toBe(true);
  });
});
