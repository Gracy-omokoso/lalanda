// vCard 3.0 d'une carte de visite (QR facultatif du verso) — ADR-0069 § 5.
//
// Coordonnées PROFESSIONNELLES seulement (fiche + réglages de l'organisation).
// Échappement RFC 2426 : `\`, `,`, `;` et sauts de ligne. Aucun champ vide n'est écrit.

export interface VCardInput {
  firstName: string;
  lastName: string;
  organization: string;
  jobTitle: string | null;
  workPhone: string | null;
  workEmail: string | null;
  website: string | null;
  address: string | null;
}

export function vcardEscape(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function vcardOf(c: VCardInput): string {
  const e = vcardEscape;
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${e(c.lastName)};${e(c.firstName)};;;`,
    `FN:${e(`${c.firstName} ${c.lastName}`.trim())}`,
    `ORG:${e(c.organization)}`,
  ];
  if (c.jobTitle) lines.push(`TITLE:${e(c.jobTitle)}`);
  if (c.workPhone) lines.push(`TEL;TYPE=WORK,VOICE:${e(c.workPhone)}`);
  if (c.workEmail) lines.push(`EMAIL;TYPE=INTERNET,WORK:${e(c.workEmail)}`);
  if (c.website) lines.push(`URL:${e(c.website)}`);
  if (c.address) lines.push(`ADR;TYPE=WORK:;;${e(c.address)};;;;`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}
