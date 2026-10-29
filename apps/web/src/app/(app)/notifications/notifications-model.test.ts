import { NOTIFICATION_KINDS, type NotificationView } from '@lalanda/shared/notifications';
import { describe, expect, it } from 'vitest';

import {
  LIBELLES_TYPES,
  NOTIFICATIONS_HREF,
  TAILLE_PANNEAU,
  ajouterPage,
  basculerTypeCoupe,
  compteurApresLecture,
  dateRelative,
  doitInterroger,
  lienSur,
  marquerLue,
  nomAccessibleCloche,
  pastilleCompteur,
  toutMarquerLu,
} from './notifications-model';

const n = (id: string, readAt: string | null = null): NotificationView => ({
  id,
  kind: 'work.task_assigned',
  source: { module: 'work', entityType: 'task', entityId: 't' },
  title: `Notification ${id}`,
  href: '/projets/p?tache=t',
  actorUserId: null,
  readAt,
  createdAt: '2026-10-29T08:00:00.000Z',
});

describe('notifications — modèle de la cloche et de la page', () => {
  it('pastille : rien à zéro, plafonnée à 99+', () => {
    expect(pastilleCompteur(0)).toBeNull();
    expect(pastilleCompteur(-1)).toBeNull();
    expect(pastilleCompteur(7)).toBe('7');
    expect(pastilleCompteur(99)).toBe('99');
    expect(pastilleCompteur(100)).toBe('99+');
  });

  it('le compteur est dit dans le nom accessible', () => {
    expect(nomAccessibleCloche(0)).toBe('Notifications — aucune non lue');
    expect(nomAccessibleCloche(1)).toBe('Notifications — 1 non lue');
    expect(nomAccessibleCloche(4)).toBe('Notifications — 4 non lues');
    expect(nomAccessibleCloche(250)).toBe('Notifications — plus de 99 non lues');
  });

  it('panneau des 20 dernières', () => {
    expect(TAILLE_PANNEAU).toBe(20);
  });

  it('chaque type a un libellé français', () => {
    for (const k of NOTIFICATION_KINDS) expect(LIBELLES_TYPES[k].label.length).toBeGreaterThan(0);
  });

  it('lien : un chemin relatif passe, une URL absolue retombe sur la page', () => {
    expect(lienSur('/projets/a?tache=b')).toBe('/projets/a?tache=b');
    expect(lienSur('https://evil.example')).toBe(NOTIFICATIONS_HREF);
    expect(lienSur('//evil.example')).toBe(NOTIFICATIONS_HREF);
    expect(lienSur('javascript:alert(1)')).toBe(NOTIFICATIONS_HREF);
  });

  it('date relative', () => {
    const now = new Date('2026-10-29T12:00:00.000Z');
    expect(dateRelative('2026-10-29T11:59:30.000Z', now)).toBe('à l’instant');
    expect(dateRelative('2026-10-29T11:45:00.000Z', now)).toBe('il y a 15 min');
    expect(dateRelative('2026-10-29T09:00:00.000Z', now)).toBe('il y a 3 h');
    expect(dateRelative('2026-10-28T09:00:00.000Z', now)).toBe('hier');
    expect(dateRelative('2026-10-25T12:00:00.000Z', now)).toBe('il y a 4 jours');
    expect(dateRelative('2026-10-01T12:00:00.000Z', now)).toMatch(/^1 oct\.?$/);
    expect(dateRelative('2025-10-01T12:00:00.000Z', now)).toMatch(/2025/);
    expect(dateRelative('pas une date', now)).toBe('');
  });

  it('marquages locaux : une lue garde sa date, le compteur ne descend pas deux fois', () => {
    const items = [n('a'), n('b', '2026-10-29T09:00:00.000Z')];
    const apres = marquerLue(items, 'a', '2026-10-29T10:00:00.000Z');
    expect(apres[0]!.readAt).toBe('2026-10-29T10:00:00.000Z');
    expect(marquerLue(apres, 'b', 'x')[1]!.readAt).toBe('2026-10-29T09:00:00.000Z');
    expect(compteurApresLecture(3, items, 'a')).toBe(2);
    expect(compteurApresLecture(3, items, 'b')).toBe(3);
    expect(compteurApresLecture(0, items, 'a')).toBe(0);
    expect(toutMarquerLu(items, 'z').every((x) => x.readAt !== null)).toBe(true);
  });

  it('pages : pas de doublon', () => {
    expect(ajouterPage([n('a'), n('b')], [n('b'), n('c')]).map((x) => x.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('types coupés : bascule, ordre canonique', () => {
    expect(basculerTypeCoupe([], 'work.mentioned')).toEqual(['work.mentioned']);
    expect(basculerTypeCoupe(['work.mentioned'], 'work.mentioned')).toEqual([]);
    expect(basculerTypeCoupe(['work.task_overdue'], 'work.task_assigned')).toEqual([
      'work.task_assigned',
      'work.task_overdue',
    ]);
  });

  it('interrogation seulement onglet visible', () => {
    expect(doitInterroger('visible')).toBe(true);
    expect(doitInterroger(undefined)).toBe(true);
    expect(doitInterroger('hidden')).toBe(false);
  });
});
