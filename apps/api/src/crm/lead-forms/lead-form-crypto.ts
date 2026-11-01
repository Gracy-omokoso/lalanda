// Jeton, ticket de remplissage et empreinte d'IP du formulaire public —
// ADR-0048 O3, O4 et § 7.
//
// Clés DISTINCTES dérivées d'`AUTH_SECRET` par HKDF, chacune avec son étiquette
// (motif de `branding/brand-asset-url.ts`) : un ticket ne vaut pas empreinte,
// et ni l'un ni l'autre ne vaut jeton de logo ou d'avatar.

import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  LEAD_FORM_MIN_FILL_MS,
  LEAD_FORM_TICKET_MAX_AGE_MS,
  LEAD_FORM_TOKEN_PATTERN,
} from '@lalanda/shared/crm';

function key(label: string): Buffer {
  const racine = process.env['AUTH_SECRET'];
  if (!racine) throw new Error('AUTH_SECRET absente : formulaire public indisponible.');
  return Buffer.from(hkdfSync('sha256', racine, label, 'v1', 32));
}

/** Jeton du lien public : 24 octets aléatoires, 32 caractères base64url. */
export function newLeadFormToken(): string {
  return randomBytes(24).toString('base64url');
}

export function isLeadFormToken(value: unknown): value is string {
  return typeof value === 'string' && LEAD_FORM_TOKEN_PATTERN.test(value);
}

/**
 * Empreinte salée d'une adresse IP (32 hexadécimaux). Relie deux envois d'une
 * même source, ne permet jamais de retrouver l'adresse.
 */
export function leadFormIpHash(ip: string | null | undefined): string {
  return createHmac('sha256', key('lalanda/lead-form-ip'))
    .update(ip && ip.length > 0 ? ip : 'unknown')
    .digest('hex')
    .slice(0, 32);
}

function seal(payload: string): string {
  return createHmac('sha256', key('lalanda/lead-form-ticket')).update(payload).digest('base64url');
}

/** Ticket `<formId>.<émisÀ ms>.<sceau>`, rendu avec la configuration publique. */
export function mintLeadFormTicket(formId: string, nowMs: number = Date.now()): string {
  const payload = `${formId}.${Math.floor(nowMs)}`;
  return `${payload}.${seal(payload)}`;
}

export type TicketCheck = 'ok' | 'invalid' | 'too_fast';

/** Vérifie le ticket : authentique, de CE formulaire, ni trop tôt ni trop tard. */
export function checkLeadFormTicket(
  ticket: string,
  formId: string,
  nowMs: number = Date.now(),
): TicketCheck {
  const parts = ticket.split('.');
  if (parts.length !== 3) return 'invalid';
  const [id, issuedRaw, signature] = parts as [string, string, string];
  if (id !== formId || !/^\d{1,15}$/.test(issuedRaw)) return 'invalid';
  const expected = Buffer.from(seal(`${id}.${issuedRaw}`));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return 'invalid';
  }
  const age = nowMs - Number(issuedRaw);
  if (age > LEAD_FORM_TICKET_MAX_AGE_MS || age < -60_000) return 'invalid';
  if (age < LEAD_FORM_MIN_FILL_MS) return 'too_fast';
  return 'ok';
}
