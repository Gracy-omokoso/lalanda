import { describe, expect, it } from 'vitest';

import { assetsAgendaHref, assetsAgendaId } from '../assets/agenda.js';
import { stockAgendaHref, stockAgendaId, STOCK_AGENDA_KIND_LABELS } from './agenda.js';

describe('« Mes tâches » des stocks et des équipements (ADR-0046 § 6.7, lot S7)', () => {
  it('identifiants disjoints et liens relatifs', () => {
    expect(stockAgendaId('count_to_count', 'c1')).toBe('stock:count:c1');
    expect(stockAgendaId('count_to_validate', 'c1')).toBe('stock:validate:c1');
    expect(stockAgendaId('pending_lines')).toBe('stock:pending');
    expect(stockAgendaHref('count_to_validate', 'c1')).toBe('/stocks/inventaires/c1');
    expect(stockAgendaHref('pending_lines')).toBe('/stocks/a-traiter');
    expect(assetsAgendaId('m1')).toBe('assets:maintenance:m1');
    expect(assetsAgendaHref('a1')).toBe('/equipements/a1');
    expect(Object.keys(STOCK_AGENDA_KIND_LABELS)).toHaveLength(3);
  });
});
