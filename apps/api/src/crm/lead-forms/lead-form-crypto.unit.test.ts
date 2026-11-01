// Ticket de remplissage et empreinte d'IP (ADR-0048 § 6, § 7).

import { beforeAll, describe, expect, it } from 'vitest';

import {
  checkLeadFormTicket,
  isLeadFormToken,
  leadFormIpHash,
  mintLeadFormTicket,
  newLeadFormToken,
} from './lead-form-crypto.js';

const FORM = '64b7f0c2a1b2c3d4e5f60718';

beforeAll(() => {
  process.env['AUTH_SECRET'] ??= 'x'.repeat(40);
});

describe('formulaire public — jeton', () => {
  it('32 caractères base64url, jamais deux fois le même', () => {
    const a = newLeadFormToken();
    expect(isLeadFormToken(a)).toBe(true);
    expect(a).not.toBe(newLeadFormToken());
    expect(isLeadFormToken('court')).toBe(false);
  });
});

describe('formulaire public — ticket', () => {
  const t0 = 1_700_000_000_000;
  it('accepté après 3 s, refusé avant, expiré après 2 h', () => {
    const t = mintLeadFormTicket(FORM, t0);
    expect(checkLeadFormTicket(t, FORM, t0 + 2_999)).toBe('too_fast');
    expect(checkLeadFormTicket(t, FORM, t0 + 3_000)).toBe('ok');
    expect(checkLeadFormTicket(t, FORM, t0 + 2 * 3600_000 + 1)).toBe('invalid');
  });
  it('refusé pour un autre formulaire, un sceau ou un instant falsifiés', () => {
    const t = mintLeadFormTicket(FORM, t0);
    expect(checkLeadFormTicket(t, 'a'.repeat(24), t0 + 5_000)).toBe('invalid');
    const [id, , sig] = t.split('.');
    expect(checkLeadFormTicket(`${id}.${t0 - 10_000}.${sig}`, FORM, t0 + 5_000)).toBe('invalid');
    expect(checkLeadFormTicket('n.importe.quoi', FORM, t0)).toBe('invalid');
  });
});

describe('formulaire public — empreinte d’IP', () => {
  it('stable, distincte par adresse, sans l’adresse en clair', () => {
    const h = leadFormIpHash('203.0.113.7');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).toBe(leadFormIpHash('203.0.113.7'));
    expect(h).not.toBe(leadFormIpHash('203.0.113.8'));
    expect(h).not.toContain('203');
  });
});
