// Fiche 360° et fil chronologique — règles pures (ADR-0040 § 3.1.2, § 3.1.3). ADR-0040 — C8.

import { describe, expect, it } from 'vitest';

import { can, NO_OVERRIDES, ORG_ROLES } from '../../authz/permissions.js';
import {
  decodeTimelineCursor,
  encodeTimelineCursor,
  overviewAccessOf,
  pageOfEvents,
  timelineSourcesOf,
  TIMELINE_SOURCES,
  type TimelineEvent,
} from './crm-overview.model.js';

const ev = (id: string, at: string, type: TimelineEvent['type'] = 'activity.created') =>
  ({
    id,
    type,
    source: 'activity',
    at,
    refId: id,
    title: id,
    by: null,
    details: {},
  }) as TimelineEvent;

describe('droits par section', () => {
  it('suit exactement `sales.read` et `work.read` pour chaque rôle', () => {
    for (const role of ORG_ROLES) {
      expect(overviewAccessOf(role, NO_OVERRIDES), role).toEqual({
        sales: can(role, 'sales.read', NO_OVERRIDES),
        work: can(role, 'work.read', NO_OVERRIDES),
      });
    }
  });

  it('le Commercial et le Lecteur voient ventes et projets', () => {
    expect(overviewAccessOf('sales_rep', NO_OVERRIDES)).toEqual({ sales: true, work: true });
    expect(overviewAccessOf('viewer', NO_OVERRIDES)).toEqual({ sales: true, work: true });
  });

  it('un retrait de `sales.read` (écart ADR-0041) masque les ventes', () => {
    expect(overviewAccessOf('sales_rep', { revokes: ['sales.read'] })).toEqual({
      sales: false,
      work: true,
    });
  });
});

describe('sources du fil', () => {
  it('toutes par défaut ; masquées par droit, signalées', () => {
    expect(timelineSourcesOf(undefined, { sales: true, work: true })).toEqual({
      read: [...TIMELINE_SOURCES],
      hidden: [],
    });
    expect(timelineSourcesOf('', { sales: false, work: false })).toEqual({
      read: ['activity', 'opportunity', 'account'],
      hidden: ['quote', 'invoice', 'receipt', 'project'],
    });
  });

  it('filtre `types`, dédoublonné ; source inconnue : null', () => {
    expect(timelineSourcesOf('invoice, quote,quote', { sales: true, work: true })).toEqual({
      read: ['quote', 'invoice'],
      hidden: [],
    });
    expect(timelineSourcesOf('quote,treasury', { sales: true, work: true })).toBeNull();
    expect(timelineSourcesOf(['quote'], { sales: true, work: true })).toBeNull();
  });
});

describe('curseur et pagination', () => {
  it('aller-retour ; altéré ou illisible : null', () => {
    const c = { at: '2026-10-29T10:00:00.000Z', type: 'quote.sent', id: 'abc' };
    const raw = encodeTimelineCursor(c);
    expect(decodeTimelineCursor(raw)).toEqual(c);
    expect(decodeTimelineCursor(`${raw}x`)).toBeNull();
    expect(decodeTimelineCursor('!!')).toBeNull();
    expect(
      decodeTimelineCursor(Buffer.from('{"t":"hier","k":"a","i":"b"}').toString('base64url')),
    ).toBeNull();
  });

  it('trié par date, type puis identifiant décroissants ; pages sans trou ni doublon', () => {
    const at = '2026-10-29T10:00:00.000Z';
    const events = [
      ev('a', '2026-10-28T10:00:00.000Z'),
      ev('b', at, 'activity.created'),
      ev('c', at, 'activity.done'),
      ev('d', at, 'activity.done'),
      ev('e', '2026-10-30T10:00:00.000Z'),
    ];
    const p1 = pageOfEvents(events, null, 2);
    expect(p1.items.map((e) => e.id)).toEqual(['e', 'd']);
    const p2 = pageOfEvents(events, decodeTimelineCursor(p1.nextCursor!), 2);
    expect(p2.items.map((e) => e.id)).toEqual(['c', 'b']);
    const p3 = pageOfEvents(events, decodeTimelineCursor(p2.nextCursor!), 2);
    expect(p3).toEqual({ items: [events[0]], nextCursor: null });
  });
});
