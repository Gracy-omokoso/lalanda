import { describe, expect, it } from 'vitest';

import { normalizeWhatsAppPhone } from '../work/whatsapp.js';
import { formatPhoneE123, normalizePhoneE164, splitE164, storedPhone } from './index.js';

describe('normalizePhoneE164 — stockage UIT-T E.164 (ADR-0075)', () => {
  it('une seule forme pour toutes les saisies d’un même numéro congolais', () => {
    for (const s of [
      '+243812345678',
      '+243 81 234 5678',
      '+243-81-234-5678',
      '+243.81.234.5678',
      '00243812345678',
      '00243 81 234 5678',
      '0812345678',
      '081 234 5678',
      '812345678',
      '+243 (0)81 234 5678',
      '+243 0812345678',
    ]) {
      expect(normalizePhoneE164(s), s).toBe('+243812345678');
    }
  });

  it('numéros étrangers en forme internationale', () => {
    expect(normalizePhoneE164('+33 6 12 34 56 78')).toBe('+33612345678');
    expect(normalizePhoneE164('+1 (555) 010-0199')).toBe('+15550100199');
    expect(normalizePhoneE164('0032 2 123 45 67')).toBe('+3221234567');
  });

  it('non reconnaissable : null (la valeur sera gardée telle quelle)', () => {
    for (const s of [
      '',
      '   ',
      'Standard, poste 12',
      '+243 81 234 567', // huit chiffres après +243
      '+243 81 234 56789', // dix chiffres
      '+243 012345678', // premier chiffre nul
      '1234567', // chiffres nus d'un pays inconnu
      '+0123456789',
      '+12345',
      '+1234567890123456', // seize chiffres
      '0812345678 poste 4',
    ]) {
      expect(normalizePhoneE164(s), s).toBeNull();
    }
    expect(normalizePhoneE164(null)).toBeNull();
    expect(normalizePhoneE164(undefined)).toBeNull();
  });

  it('sans indicatif par défaut, une saisie nationale n’est pas devinée', () => {
    expect(normalizePhoneE164('0812345678', { defaultCountryCode: null })).toBeNull();
    expect(normalizePhoneE164('+243812345678', { defaultCountryCode: null })).toBe('+243812345678');
    expect(normalizePhoneE164('0612345678', { defaultCountryCode: '+33' })).toBe('+33612345678');
  });

  it('d’accord avec la normalisation de WhatsApp sur les numéros qu’elle accepte', () => {
    for (const s of ['+243 81 234 5612', '0812345612', '00243812345612', '+33 6 12 34 56 78']) {
      expect(normalizePhoneE164(s)).toBe(normalizeWhatsAppPhone(s));
    }
  });

  it('idempotente', () => {
    for (const s of ['0812345678', '+33 6 12 34 56 78', '+1 555 010 0199']) {
      const once = normalizePhoneE164(s)!;
      expect(normalizePhoneE164(once)).toBe(once);
    }
  });
});

describe('splitE164', () => {
  it('découpe l’indicatif à 1, 2 ou 3 chiffres', () => {
    expect(splitE164('+15550100199')).toEqual({ countryCode: '1', national: '5550100199' });
    expect(splitE164('+33612345678')).toEqual({ countryCode: '33', national: '612345678' });
    expect(splitE164('+243812345678')).toEqual({ countryCode: '243', national: '812345678' });
    expect(splitE164('+250788123456')).toEqual({ countryCode: '250', national: '788123456' });
    expect(splitE164('243812345678')).toBeNull();
  });
});

describe('formatPhoneE123 — affichage international UIT-T E.123 (ADR-0075)', () => {
  it('RDC : indicatif puis groupes 2-3-4', () => {
    expect(formatPhoneE123('+243812345678')).toBe('+243 81 234 5678');
    expect(formatPhoneE123('0812345678')).toBe('+243 81 234 5678');
    expect(formatPhoneE123('+243 800 000 001')).toBe('+243 80 000 0001');
  });

  it('autres pays : groupes de trois, jamais un chiffre seul en fin', () => {
    expect(formatPhoneE123('+33612345678')).toBe('+33 612 345 678');
    expect(formatPhoneE123('+15550100199')).toBe('+1 555 010 0199');
    expect(formatPhoneE123('+3221234567')).toBe('+32 212 345 67');
    expect(formatPhoneE123('+250788123456')).toBe('+250 788 123 456');
  });

  it('valeur non reconnaissable rendue telle quelle ; vide → chaîne vide', () => {
    expect(formatPhoneE123('Standard, poste 12')).toBe('Standard, poste 12');
    expect(formatPhoneE123('  +243 81 234 567 ')).toBe('+243 81 234 567');
    expect(formatPhoneE123(null)).toBe('');
    expect(formatPhoneE123(undefined)).toBe('');
    expect(formatPhoneE123('   ')).toBe('');
  });

  it('sans indicatif par défaut, un numéro national reste tel quel', () => {
    expect(formatPhoneE123('0812345678', { defaultCountryCode: null })).toBe('0812345678');
    expect(formatPhoneE123('00243812345678', { defaultCountryCode: null })).toBe(
      '+243 81 234 5678',
    );
  });
});

describe('storedPhone — valeur à enregistrer', () => {
  it('E.164 si reconnaissable, sinon la saisie ; null reste null', () => {
    expect(storedPhone('+243 81 234 5678')).toBe('+243812345678');
    expect(storedPhone('Standard')).toBe('Standard');
    expect(storedPhone('1234567')).toBe('1234567');
    expect(storedPhone(null)).toBeNull();
  });
});
