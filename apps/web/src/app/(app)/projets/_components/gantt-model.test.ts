import { ganttRows } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import { oid, tache } from './fixtures.test-helpers';
import {
  HAUTEUR_ENTETE,
  HAUTEUR_LIGNE,
  PX_PAR_JOUR,
  RAYON_JALON,
  barres,
  bornes,
  corpsDates,
  descriptionBarre,
  domaine,
  fleches,
  gesteClavier,
  graduations,
  hauteurGraphique,
  joursDepuisPixels,
  largeurGraphique,
  libelleGeste,
  nouvellesDates,
  phrasesConflits,
  pointsLosange,
  xAujourdhui,
  xJour,
} from './gantt-model';

const A = tache({
  id: oid(1),
  number: 1,
  title: 'Achat',
  rank: 'a',
  startDate: '2026-11-02',
  dueDate: '2026-11-04',
});
const B = tache({
  id: oid(2),
  number: 2,
  title: 'Pose',
  rank: 'b',
  startDate: '2026-11-06',
  dueDate: '2026-11-09',
  blockedBy: [{ taskId: oid(1), type: 'finish_to_start' }],
});
const J = tache({
  id: oid(3),
  number: 3,
  title: 'Livraison',
  rank: 'c',
  isMilestone: true,
  dueDate: '2026-11-09',
  blockedBy: [{ taskId: oid(2), type: 'finish_to_start' }],
});

describe('domaine', () => {
  it('englobe les lignes et aujourd’hui, aligné au lundi (jour)', () => {
    const { rows } = ganttRows([A, B]);
    const d = domaine(rows, '2026-10-29', 'jour');
    expect(d.debut).toBe('2026-10-26'); // 29 oct. − 3 j = 26 oct., un lundi
    expect(d.fin).toBe('2026-11-15'); // 9 nov. + 3 j = 12 nov. → dimanche 15
    expect(d.jours).toBe(21);
    expect(largeurGraphique(d, 'jour')).toBe(21 * PX_PAR_JOUR.jour);
  });

  it('aligné sur des mois entiers (mois)', () => {
    const { rows } = ganttRows([A, B]);
    const d = domaine(rows, '2026-11-03', 'mois');
    expect(d.debut).toBe('2026-10-01');
    expect(d.fin).toBe('2026-11-30');
  });

  it('projet vide : la semaine d’aujourd’hui avec sa marge', () => {
    const d = domaine([], '2026-11-04', 'semaine');
    expect(d.debut).toBe('2026-10-26');
    expect(d.fin).toBe('2026-11-15');
    expect(hauteurGraphique(0)).toBe(HAUTEUR_ENTETE + HAUTEUR_LIGNE);
  });
});

describe('graduations', () => {
  it('jour : un repère par jour, week-ends signalés, mois en majeure', () => {
    const d = { debut: '2026-10-26', fin: '2026-11-08', jours: 14 };
    const g = graduations(d, 'jour');
    expect(g.mineures).toHaveLength(14);
    expect(g.mineures[5]).toMatchObject({ label: '31', weekend: true });
    expect(g.majeures.map((m) => m.label)).toEqual(['octobre 2026', 'novembre 2026']);
    expect(g.majeures[1]!.x).toBe(6 * PX_PAR_JOUR.jour);
  });

  it('semaine : un repère par lundi', () => {
    const g = graduations({ debut: '2026-10-26', fin: '2026-11-15', jours: 21 }, 'semaine');
    expect(g.mineures.map((m) => m.label)).toEqual(['26 oct.', '2 nov.', '9 nov.']);
  });

  it('mois : mois en mineure, années en majeure', () => {
    const g = graduations({ debut: '2026-12-01', fin: '2027-01-31', jours: 62 }, 'mois');
    expect(g.mineures.map((m) => m.label)).toEqual(['décembre', 'janvier']);
    expect(g.majeures.map((m) => m.label)).toEqual(['2026', '2027']);
  });
});

describe('barres et flèches', () => {
  const { rows } = ganttRows([A, B, J]);
  const dom = { debut: '2026-11-02', fin: '2026-11-15', jours: 14 };
  const geo = barres(rows, dom, 'jour');
  const px = PX_PAR_JOUR.jour;

  it('barre début → échéance, bornes incluses', () => {
    expect(geo[0]).toMatchObject({ taskId: A.id, x: 0, largeur: 3 * px, yLigne: HAUTEUR_ENTETE });
    expect(geo[1]).toMatchObject({ taskId: B.id, x: 4 * px, largeur: 4 * px });
  });

  it('losange centré sur le jour de l’échéance', () => {
    const j = geo[2]!;
    expect(j.forme).toBe('milestone');
    const cx = xJour('2026-11-09', dom, 'jour') + px / 2;
    expect(j.x).toBe(cx - RAYON_JALON);
    expect(pointsLosange(j).split(' ')).toHaveLength(4);
  });

  it('flèche à coude simple quand le successeur commence plus loin', () => {
    const f = fleches(rows, geo);
    const ab = f.find((x) => x.de === A.id)!;
    expect(ab.vers).toBe(B.id);
    expect(ab.conflit).toBe(false);
    expect(ab.d).toBe(
      `M ${3 * px} ${geo[0]!.yMilieu} H ${3 * px + 8} V ${geo[1]!.yMilieu} H ${4 * px}`,
    );
  });

  it('conflit : le jalon tombe le jour de l’échéance de son prédécesseur, flèche contournée', () => {
    const f = fleches(rows, geo).find((x) => x.de === B.id)!;
    expect(f.conflit).toBe(true);
    expect(rows[2]!.conflict).toBe(true);
    // Passe entre les deux lignes (bas de la ligne du prédécesseur).
    expect(f.d).toContain(`V ${geo[1]!.yLigne + HAUTEUR_LIGNE}`);
  });

  it('ligne « aujourd’hui » au milieu du jour, absente hors domaine', () => {
    expect(xAujourdhui('2026-11-03', dom, 'jour')).toBe(px + px / 2);
    expect(xAujourdhui('2027-01-01', dom, 'jour')).toBeNull();
  });
});

describe('gestes', () => {
  it('pixels → jours entiers, sans −0', () => {
    expect(joursDepuisPixels(47, 'jour')).toBe(1);
    expect(joursDepuisPixels(-5, 'jour')).toBe(0);
    expect(Object.is(joursDepuisPixels(-5, 'jour'), -0)).toBe(false);
    expect(joursDepuisPixels(-52, 'mois')).toBe(-13);
  });

  it('déplacer conserve la durée', () => {
    expect(nouvellesDates(A, 'deplacer', 2)).toEqual({
      startDate: '2026-11-04',
      dueDate: '2026-11-06',
    });
  });

  it('étirer l’échéance, sans jamais passer avant le début', () => {
    expect(nouvellesDates(A, 'fin', 3)).toEqual({ startDate: '2026-11-02', dueDate: '2026-11-07' });
    expect(nouvellesDates(A, 'fin', -10)).toEqual({
      startDate: '2026-11-02',
      dueDate: '2026-11-02',
    });
  });

  it('étirer le début, sans dépasser l’échéance', () => {
    expect(nouvellesDates(A, 'debut', -1)).toEqual({
      startDate: '2026-11-01',
      dueDate: '2026-11-04',
    });
    expect(nouvellesDates(A, 'debut', 9)).toEqual({
      startDate: '2026-11-04',
      dueDate: '2026-11-04',
    });
  });

  it('tâche à échéance seule : étirer le début pose une date de début', () => {
    const t = tache({ id: oid(7), dueDate: '2026-11-04' });
    expect(nouvellesDates(t, 'debut', -2)).toEqual({
      startDate: '2026-11-02',
      dueDate: '2026-11-04',
    });
    expect(nouvellesDates(t, 'debut', 1)).toEqual({ startDate: null, dueDate: '2026-11-04' });
    expect(nouvellesDates(t, 'deplacer', 1)).toEqual({ startDate: null, dueDate: '2026-11-05' });
  });

  it('un jalon ne fait que se déplacer, sans date de début', () => {
    expect(nouvellesDates(J, 'fin', 2)).toEqual({ startDate: null, dueDate: '2026-11-11' });
    expect(gesteClavier('ArrowRight', { shift: true, alt: false }, true)).toEqual({
      mode: 'deplacer',
      delta: 1,
    });
  });

  it('corps du PATCH : seulement ce qui change', () => {
    expect(corpsDates(A, nouvellesDates(A, 'fin', 1))).toEqual({
      expectedRevision: A.revision,
      dueDate: '2026-11-05',
    });
    expect(corpsDates(A, nouvellesDates(A, 'deplacer', 0))).toBeNull();
  });

  it('clavier : flèches, Maj, Alt', () => {
    expect(gesteClavier('ArrowLeft', { shift: false, alt: false }, false)).toEqual({
      mode: 'deplacer',
      delta: -1,
    });
    expect(gesteClavier('ArrowRight', { shift: true, alt: false }, false)?.mode).toBe('fin');
    expect(gesteClavier('ArrowLeft', { shift: false, alt: true }, false)?.mode).toBe('debut');
    expect(gesteClavier('Enter', { shift: false, alt: false }, false)).toBeNull();
    expect(libelleGeste('fin', 2)).toBe('Échéance : +2 jours');
    expect(libelleGeste('deplacer', -1)).toBe('Déplacement : −1 jour');
  });

  it('bornes : tâche à début seul, sans date', () => {
    expect(bornes({ startDate: '2026-11-02', dueDate: null, isMilestone: false })).toEqual({
      start: '2026-11-02',
      end: '2026-11-02',
    });
    expect(bornes({ startDate: null, dueDate: null, isMilestone: false })).toBeNull();
  });
});

describe('textes', () => {
  it('conflit en phrase', () => {
    expect(phrasesConflits([A, B, J])).toEqual([
      {
        taskId: J.id,
        texte:
          '#3 Livraison commence le 9 nov., sans attendre la fin de #2 Pose (échéance le 9 nov.).',
      },
    ]);
  });

  it('description d’une barre', () => {
    const { rows } = ganttRows([A, B, J]);
    expect(descriptionBarre(A, rows[0]!)).toBe('#1 Achat, du 2 nov. 2026 au 4 nov. 2026');
    expect(descriptionBarre(J, rows[2]!)).toBe(
      '#3 Livraison, jalon le 9 nov. 2026, conflit de dates avec un prédécesseur',
    );
  });
});
