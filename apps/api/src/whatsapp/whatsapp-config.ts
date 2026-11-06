// Réglages de l'intégration WhatsApp — ADR-0065 § 1, § 6, § 7 et § 9. Fonctions pures,
// partagées par le client HTTP, le service et le test de connexion de `/admin`.

import { WHATSAPP_DEFAULT_MONTHLY_LIMIT } from '@lalanda/shared/work';

/** Origine de la Graph API de Meta. */
export const WHATSAPP_GRAPH_BASE = 'https://graph.facebook.com';

/** Version de la Graph API quand `/admin` n'en fixe pas. */
export const WHATSAPP_DEFAULT_API_VERSION = 'v24.0';

/** Plafond mensuel maximal accepté (garde-fou contre une saisie aberrante). */
export const WHATSAPP_MAX_MONTHLY_LIMIT = 1_000_000;

/**
 * Origine de la Graph API. `WHATSAPP_API_BASE_URL` permet de brancher un faux Meta
 * LOCAL en développement (captures d'écran, essais à la main) ; elle est IGNORÉE en
 * production et hors boucle locale, où seule `https://graph.facebook.com` est jointe.
 */
export function whatsappApiBase(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['WHATSAPP_API_BASE_URL']?.trim();
  if (
    override &&
    env['NODE_ENV'] !== 'production' &&
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(`${override}/`)
  ) {
    return override.replace(/\/+$/, '');
  }
  return WHATSAPP_GRAPH_BASE;
}

/** Version valide (`v24.0`), sinon le défaut. */
export function whatsappApiVersion(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  return /^v\d{1,3}\.\d{1,2}$/.test(v) ? v : WHATSAPP_DEFAULT_API_VERSION;
}

/** `WHATSAPP_ENABLED` : allumé par défaut ; seule la valeur `false` coupe tout. */
export function whatsappEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['WHATSAPP_ENABLED']?.trim().toLowerCase() !== 'false';
}

/** Plafond mensuel par organisation : entier de 0 à 1 000 000, sinon le défaut prudent. */
export function whatsappMonthlyLimit(value: string | null | undefined): number {
  const text = (value ?? '').trim();
  if (!/^\d{1,7}$/.test(text)) return WHATSAPP_DEFAULT_MONTHLY_LIMIT;
  const n = Number(text);
  return n <= WHATSAPP_MAX_MONTHLY_LIMIT ? n : WHATSAPP_DEFAULT_MONTHLY_LIMIT;
}

/** Mois courant à Kinshasa (`AAAA-MM`) — période du compteur d'envois. */
export function kinshasaMonth(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kinshasa',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  return `${y}-${m}`;
}
