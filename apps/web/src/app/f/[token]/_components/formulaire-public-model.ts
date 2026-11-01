// Page publique du formulaire de prospects — ADR-0048 § 9. Logique pure.
//
// Les règles (obligatoires, formats, consentement) sont CELLES DE L'API,
// partagées par `@lalanda/shared/crm` : l'écran les applique pour signaler
// une erreur avant l'envoi ; le serveur reste seul juge.

import {
  LEAD_FORM_HONEYPOT_FIELD,
  validateLeadSubmission,
  type LeadFormFieldKey,
  type PublicLeadFormField,
} from '@lalanda/shared/crm';

export type Valeurs = Partial<Record<LeadFormFieldKey, string>>;

/** Type et saisie semi-automatique de chaque champ (mobile : bon clavier). */
export const SAISIE: Readonly<
  Record<
    LeadFormFieldKey,
    { type: 'text' | 'email' | 'tel'; autoComplete: string; multiligne: boolean }
  >
> = Object.freeze({
  name: { type: 'text', autoComplete: 'name', multiligne: false },
  company: { type: 'text', autoComplete: 'organization', multiligne: false },
  email: { type: 'email', autoComplete: 'email', multiligne: false },
  phone: { type: 'tel', autoComplete: 'tel', multiligne: false },
  message: { type: 'text', autoComplete: 'off', multiligne: true },
  source: { type: 'text', autoComplete: 'off', multiligne: false },
});

/** Valeurs de départ ; `?source=` préremplit le champ « source » s'il est affiché. */
export function valeursInitiales(
  champs: readonly PublicLeadFormField[],
  source: string | null,
): Valeurs {
  const v: Valeurs = {};
  for (const c of champs) v[c.key] = '';
  if (source && champs.some((c) => c.key === 'source')) {
    v.source = source.slice(0, champs.find((c) => c.key === 'source')!.maxLength);
  }
  return v;
}

/** Erreurs par champ (et `consent`) avant l'envoi, avec les règles partagées. */
export function erreursLocales(
  champs: readonly PublicLeadFormField[],
  valeurs: Valeurs,
  accord: boolean,
): Record<string, string> {
  const { issues } = validateLeadSubmission(champs, { ...valeurs, consent: accord });
  return erreursParChamp(issues);
}

/** Première erreur de chaque champ. */
export function erreursParChamp(
  issues: readonly { path: string; message: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const cle = i.path.split('.')[0] ?? i.path;
    if (cle && out[cle] === undefined) out[cle] = i.message;
  }
  return out;
}

/** Corps envoyé : seuls les champs affichés, le ticket, l'accord, le piège. */
export function corpsSoumission(
  champs: readonly PublicLeadFormField[],
  valeurs: Valeurs,
  ticket: string,
  accord: boolean,
  piege: string,
): Record<string, unknown> {
  const corps: Record<string, unknown> = { ticket, consent: accord };
  for (const c of champs) {
    const v = (valeurs[c.key] ?? '').trim();
    if (v !== '') corps[c.key] = v;
  }
  if (piege !== '') corps[LEAD_FORM_HONEYPOT_FIELD] = piege;
  return corps;
}

/** Message d'erreur lisible d'un refus de l'API. */
export function messageRefus(code: string | null, status: number, repli: string): string {
  if (status === 0) return 'Connexion impossible : vérifiez votre réseau puis réessayez.';
  switch (code) {
    case 'LEAD_FORM_NOT_FOUND':
      return 'Ce formulaire n’est pas disponible.';
    case 'LEAD_FORM_TOO_FAST':
      return 'Merci de patienter quelques secondes avant d’envoyer.';
    case 'LEAD_FORM_TICKET_INVALID':
      return 'Le formulaire a expiré : il vient d’être rechargé, renvoyez votre demande.';
    case 'LEAD_FORM_RATE_LIMITED':
      return repli;
    case 'INVALID_REQUEST':
      return 'Certains champs sont à corriger.';
    default:
      return repli;
  }
}

/** Couleur d'accent de l'organisation, seulement si c'est un hexadécimal sûr. */
export function couleurSure(couleur: string | null | undefined): string | null {
  return couleur && /^#[0-9a-fA-F]{6}$/.test(couleur) ? couleur : null;
}
