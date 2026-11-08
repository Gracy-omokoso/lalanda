// Données FICTIVES des aperçus de modèles — ADR-0069 § 7.
//
// Aucun collaborateur réel n'est lu pour un aperçu : nom, poste et coordonnées
// inventés, bandeau « EXEMPLE » posé par le moteur. Le logo et les couleurs sont
// ceux de l'organisation (c'est l'objet de l'aperçu).

import type { CardKind } from '@lalanda/shared/hr';

import { initialsOf, type CardData, type CardImage } from './card-model.js';

export interface SampleOrg {
  name: string;
  logo: CardImage | null;
  logoLight: CardImage | null;
  address: string | null;
  website: string | null;
  phone: string | null;
  slogan: string | null;
}

export function sampleCardData(
  kind: CardKind,
  org: SampleOrg,
  qr: { verify: string | null; vcard: string | null },
  verifyLabel: string,
  overrides: Partial<CardData> = {},
): CardData {
  const firstName = 'Aline';
  const lastName = 'Mbuyi Kabongo';
  return {
    kind,
    firstName,
    lastName,
    displayName: `${firstName} ${lastName}`,
    initials: initialsOf(`${firstName} ${lastName}`),
    jobTitle: 'Responsable des opérations',
    department: 'Logistique et transport',
    employeeNumber: 'EX-0042',
    workEmail: 'aline.mbuyi@exemple.cd',
    workPhone: '+243 81 000 00 00',
    photo: null,
    org: {
      name: org.name,
      initials: initialsOf(org.name),
      logo: org.logo,
      logoLight: org.logoLight,
      address: org.address ?? '12, avenue de l’Exemple, Gombe, Kinshasa',
      website: org.website ?? 'www.exemple.cd',
      phone: org.phone ?? '+243 99 000 00 00',
      slogan: org.slogan ?? 'Votre partenaire au quotidien',
    },
    verifyQrSvg: kind === 'badge' ? qr.verify : null,
    verifyLabel,
    serial: kind === 'badge' ? 1 : null,
    vcardQrSvg: kind === 'business' ? qr.vcard : null,
    sample: true,
    ...overrides,
  };
}
