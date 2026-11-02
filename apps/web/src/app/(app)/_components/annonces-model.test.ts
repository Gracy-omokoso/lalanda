import { describe, expect, it } from 'vitest';

import type { MyAnnouncementView } from '@/lib/announcements-api';

import {
  annoncesBanniere,
  annoncesCloche,
  annoncesNonLues,
  fermerAnnonce,
  libelleAutresAnnonces,
  marquerAnnonceLue,
} from './annonces-model';

const MAINTENANT = new Date('2026-11-02T10:00:00.000Z');
const A = (id: string, startsAt: string, extra: Partial<MyAnnouncementView> = {}) =>
  ({
    id,
    kind: 'platform.announcement',
    title: `Annonce ${id}`,
    body: 'Texte',
    startsAt,
    expiresAt: '2026-12-01T00:00:00.000Z',
    readAt: null,
    dismissedAt: null,
    ...extra,
  }) satisfies MyAnnouncementView;

const LISTE = [
  A('ancienne', '2026-10-01T00:00:00.000Z'),
  A('recente', '2026-11-01T00:00:00.000Z'),
  A('fermee', '2026-10-20T00:00:00.000Z', {
    readAt: '2026-10-21T00:00:00.000Z',
    dismissedAt: '2026-10-21T00:00:00.000Z',
  }),
  A('expiree', '2026-09-01T00:00:00.000Z', { expiresAt: '2026-10-01T00:00:00.000Z' }),
];

describe('annonces du destinataire (ADR-0053 § 6.6)', () => {
  it('la bannière montre les non fermées en cours, la plus récente d’abord', () => {
    expect(annoncesBanniere(LISTE, MAINTENANT).map((a) => a.id)).toEqual(['recente', 'ancienne']);
  });

  it('la cloche garde les fermées jusqu’à l’échéance', () => {
    expect(annoncesCloche(LISTE, MAINTENANT).map((a) => a.id)).toEqual([
      'recente',
      'fermee',
      'ancienne',
    ]);
  });

  it('compte les non lues sans doublon', () => {
    expect(annoncesNonLues([...LISTE, LISTE[0]!])).toBe(3);
  });

  it('lire et fermer sont idempotents', () => {
    const lue = marquerAnnonceLue(LISTE, 'recente', 'T1');
    expect(lue.find((a) => a.id === 'recente')!.readAt).toBe('T1');
    expect(marquerAnnonceLue(lue, 'recente', 'T2').find((a) => a.id === 'recente')!.readAt).toBe(
      'T1',
    );
    const fermee = fermerAnnonce(lue, 'recente', 'T3');
    expect(fermee.find((a) => a.id === 'recente')).toMatchObject({
      readAt: 'T1',
      dismissedAt: 'T3',
    });
    expect(
      fermerAnnonce(fermee, 'recente', 'T4').find((a) => a.id === 'recente')!.dismissedAt,
    ).toBe('T3');
  });

  it('libellé des annonces restantes', () => {
    expect(libelleAutresAnnonces(0)).toBeNull();
    expect(libelleAutresAnnonces(1)).toBe('1 autre annonce dans la cloche.');
    expect(libelleAutresAnnonces(3)).toBe('3 autres annonces dans la cloche.');
  });
});
