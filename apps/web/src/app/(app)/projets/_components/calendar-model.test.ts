import { describe, expect, it } from 'vitest';

import {
  agenda,
  appliquerCorps,
  corpsDeplacement,
  decaler,
  decalageClavier,
  dernierDuMois,
  ecartJours,
  etendue,
  jourSemaine,
  libelleEtendue,
  libelleJour,
  lundiDe,
  optionsEcheance,
  periode,
  placerSemaines,
  sansEcheance,
  nomElement,
} from './calendar-model';
import { oid, tache } from './fixtures.test-helpers';

describe('jours', () => {
  it('rang dans la semaine, lundi = 0', () => {
    expect(jourSemaine('2026-11-02')).toBe(0); // lundi
    expect(jourSemaine('2026-11-08')).toBe(6); // dimanche
    expect(lundiDe('2026-11-08')).toBe('2026-11-02');
    expect(lundiDe('2026-11-02')).toBe('2026-11-02');
  });

  it('écart et fin de mois, années bissextiles comprises', () => {
    expect(ecartJours('2026-10-30', '2026-11-02')).toBe(3);
    expect(ecartJours('2026-11-02', '2026-10-30')).toBe(-3);
    expect(dernierDuMois('2028-02-10')).toBe('2028-02-29');
    expect(dernierDuMois('2026-02-10')).toBe('2026-02-28');
  });

  it('libellé complet, en français', () => {
    expect(libelleJour('2026-11-03')).toBe('mardi 3 nov. 2026');
  });

  it('refuse une date invalide', () => {
    expect(() => jourSemaine('2026-02-30')).toThrow(RangeError);
  });
});

describe('periode', () => {
  it('mois : semaines complètes du lundi au dimanche', () => {
    const p = periode('mois', '2026-11-17');
    expect(p.debut).toBe('2026-10-26');
    expect(p.fin).toBe('2026-12-06');
    expect(p.semaines).toHaveLength(6);
    expect(p.semaines.every((s) => s.length === 7)).toBe(true);
    expect(p.mois).toBe('2026-11');
    expect(p.titre).toBe('novembre 2026');
  });

  it('février 2027 commence un lundi et tient en quatre semaines', () => {
    const p = periode('mois', '2027-02-14');
    expect(p.debut).toBe('2027-02-01');
    expect(p.semaines).toHaveLength(4);
  });

  it('semaine : sept jours, titre lisible, à cheval sur deux années', () => {
    const p = periode('semaine', '2026-12-31');
    expect(p.debut).toBe('2026-12-28');
    expect(p.fin).toBe('2027-01-03');
    expect(p.semaines).toHaveLength(1);
    expect(p.titre).toBe('Semaine du 28 déc. 2026 au 3 janv. 2027');
  });

  it('decaler : mois et semaine, sans débordement du 31', () => {
    expect(decaler('mois', '2026-01-31', 1)).toBe('2026-02-01');
    expect(decaler('mois', '2026-01-15', -1)).toBe('2025-12-01');
    expect(decaler('semaine', '2026-11-03', 1)).toBe('2026-11-10');
  });
});

describe('placerSemaines', () => {
  const semaines = periode('mois', '2026-11-01').semaines;

  it('une tâche à échéance seule occupe son jour', () => {
    const t = tache({ id: oid(1), dueDate: '2026-11-04' });
    const [, s2] = placerSemaines([t], semaines);
    expect(s2!.segments).toEqual([
      expect.objectContaining({ taskId: t.id, colDebut: 2, colFin: 2, ligne: 0, forme: 'tache' }),
    ]);
  });

  it('une tâche datée s’étend du début à l’échéance, coupée par semaine', () => {
    const t = tache({ id: oid(1), startDate: '2026-11-06', dueDate: '2026-11-11' });
    const placees = placerSemaines([t], semaines);
    const s2 = placees[1]!.segments[0]!;
    const s3 = placees[2]!.segments[0]!;
    expect(s2).toMatchObject({ colDebut: 4, colFin: 6, continueApres: true, porteEcheance: false });
    expect(s3).toMatchObject({ colDebut: 0, colFin: 2, continueAvant: true, porteEcheance: true });
  });

  it('un jalon est un losange à son échéance, même avec une date de début résiduelle', () => {
    const j = tache({
      id: oid(2),
      isMilestone: true,
      startDate: '2026-11-01',
      dueDate: '2026-11-05',
    });
    expect(etendue(j)).toEqual({ debut: '2026-11-05', fin: '2026-11-05' });
    const s = placerSemaines([j], semaines)[1]!.segments[0]!;
    expect(s.forme).toBe('jalon');
  });

  it('empile sans chevauchement et compte les tâches masquées au-delà du maximum', () => {
    const ts = [1, 2, 3, 4].map((i) => tache({ id: oid(i), rank: `${i}`, dueDate: '2026-11-04' }));
    const longue = tache({ id: oid(9), startDate: '2026-11-02', dueDate: '2026-11-08' });
    const s = placerSemaines([...ts, longue], semaines, 3)[1]!;
    // La plus longue d'abord (même jour de début absent : lundi < mercredi).
    expect(s.segments[0]).toMatchObject({ taskId: longue.id, ligne: 0 });
    expect(s.segments).toHaveLength(3);
    expect(s.lignes).toBe(3);
    expect(s.masquees[2]).toBe(2);
    expect(s.masquees[0]).toBe(0);
  });

  it('ignore les tâches sans échéance et les liste à part', () => {
    const a = tache({ id: oid(1), startDate: '2026-11-04' });
    const b = tache({ id: oid(2), dueDate: '2026-11-04' });
    expect(placerSemaines([a, b], semaines).flatMap((s) => s.segments)).toHaveLength(1);
    expect(sansEcheance([a, b]).map((t) => t.id)).toEqual([a.id]);
  });
});

describe('agenda', () => {
  it('range par jour d’échéance, jalons en tête, terminées en fin', () => {
    const a = tache({ id: oid(1), dueDate: '2026-11-04', done: true });
    const b = tache({ id: oid(2), dueDate: '2026-11-04' });
    const c = tache({ id: oid(3), dueDate: '2026-11-04', isMilestone: true });
    const d = tache({ id: oid(4), dueDate: '2026-11-02' });
    const hors = tache({ id: oid(5), dueDate: '2026-12-25' });
    const r = agenda([a, b, c, d, hors], '2026-11-01', '2026-11-30');
    expect(r.map((j) => j.jour)).toEqual(['2026-11-02', '2026-11-04']);
    expect(r[1]!.taches.map((t) => t.id)).toEqual([c.id, b.id, a.id]);
  });
});

describe('corpsDeplacement', () => {
  it('pose l’échéance seule pour une tâche sans début', () => {
    const t = tache({ id: oid(1), dueDate: '2026-11-04', revision: 3 });
    expect(corpsDeplacement(t, '2026-11-06')).toEqual({
      dueDate: '2026-11-06',
      expectedRevision: 3,
    });
  });

  it('glisse en bloc une tâche datée (même durée)', () => {
    const t = tache({ id: oid(1), startDate: '2026-11-02', dueDate: '2026-11-04', revision: 2 });
    expect(corpsDeplacement(t, '2026-10-30')).toEqual({
      startDate: '2026-10-28',
      dueDate: '2026-10-30',
      expectedRevision: 2,
    });
  });

  it('jamais de date de début pour un jalon', () => {
    const j = tache({ id: oid(1), isMilestone: true, dueDate: '2026-11-04' });
    expect(corpsDeplacement(j, '2026-11-05')).not.toHaveProperty('startDate');
  });

  it('rien à faire : même jour, pas d’échéance, date invalide', () => {
    expect(corpsDeplacement(tache({ id: oid(1), dueDate: '2026-11-04' }), '2026-11-04')).toBeNull();
    expect(corpsDeplacement(tache({ id: oid(1) }), '2026-11-04')).toBeNull();
    expect(corpsDeplacement(tache({ id: oid(1), dueDate: '2026-11-04' }), '2026-13-01')).toBeNull();
  });

  it('appliquerCorps : copie optimiste', () => {
    const t = tache({ id: oid(1), startDate: '2026-11-02', dueDate: '2026-11-04' });
    const c = corpsDeplacement(t, '2026-11-05')!;
    expect(appliquerCorps(t, c)).toMatchObject({ startDate: '2026-11-03', dueDate: '2026-11-05' });
  });
});

describe('menu et clavier', () => {
  it('options du menu « Déplacer l’échéance »', () => {
    const t = tache({ id: oid(1), dueDate: '2026-11-04' });
    const o = optionsEcheance(t, '2026-10-29');
    expect(o.map((x) => x.jour)).toEqual([
      '2026-11-03',
      '2026-11-05',
      '2026-10-28',
      '2026-11-11',
      '2026-10-29',
    ]);
    expect(o[1]!.label).toBe('Le lendemain (5 nov.)');
    expect(optionsEcheance(t, '2026-11-04').some((x) => x.id === 'auj')).toBe(false);
    // Aujourd'hui = la veille : pas de doublon dans le menu.
    expect(optionsEcheance(t, '2026-11-03').filter((x) => x.jour === '2026-11-03')).toHaveLength(1);
    expect(optionsEcheance(tache({ id: oid(2) }), '2026-11-04')).toEqual([]);
  });

  it('flèches : un jour ou une semaine', () => {
    expect(decalageClavier('ArrowLeft')).toBe(-1);
    expect(decalageClavier('ArrowDown')).toBe(7);
    expect(decalageClavier('Enter')).toBeNull();
  });

  it('libellé d’étendue', () => {
    expect(
      libelleEtendue(tache({ id: oid(1), startDate: '2026-11-03', dueDate: '2026-11-07' })),
    ).toBe('du 3 nov. au 7 nov.');
    expect(libelleEtendue(tache({ id: oid(1), dueDate: '2026-11-07' }))).toBe('7 nov.');
    expect(libelleEtendue(tache({ id: oid(1) }))).toBe('Sans échéance');
  });
});

describe('relances du CRM dans le calendrier (ADR-0040 — C4)', () => {
  it('nomme une tâche par son numéro, une relance par son étiquette', () => {
    expect(nomElement({ number: 12, title: 'Livrer' })).toBe('#12 Livrer');
    expect(nomElement({ number: 0, title: 'Rappeler ACME', etiquette: 'Relance' })).toBe(
      'Relance « Rappeler ACME »',
    );
  });
});
