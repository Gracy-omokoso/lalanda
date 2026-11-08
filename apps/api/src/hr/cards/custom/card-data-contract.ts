// Contrat de données des gabarits de carte sur mesure — version 1 (ADR-0069 § 6).
//
// Liste EXHAUSTIVE et typée de ce qu'un gabarit `gabarit.html` peut lire. Le
// contrôle statique (`checkTemplate`) refuse toute autre variable à
// l'installation. Recopiée dans `docs/cartes/guide-paquet-code.md` ; un test
// vérifie que les deux concordent. Ajouter une variable reste en version 1 ;
// en retirer une ou en changer le sens ouvre la version 2.

import type {
  DataValue,
  FieldType,
} from '../../../sales/documents/templates/custom/data-contract.js';
import type { CardData } from '../card-model.js';

export const CARD_DATA_CONTRACT_VERSION = 1;

const text = (doc: string): FieldType => ({ kind: 'text', nullable: false, doc });
const maybe = (doc: string): FieldType => ({ kind: 'text', nullable: true, doc });
const bool = (doc: string): FieldType => ({ kind: 'bool', doc });
const obj = (doc: string, fields: Record<string, FieldType>): FieldType => ({
  kind: 'object',
  fields,
  doc,
});

/** Jetons d'image : seule valeur admise dans un `src` (avec les images du paquet). */
export const CARD_IMAGE_TOKENS = {
  photo: 'lx-img:photo',
  logo: 'lx-img:logo',
  logoLight: 'lx-img:logo-light',
} as const;

export const CARD_DATA_SCHEMA: FieldType = obj('Données du gabarit de carte.', {
  face: obj('Face en cours de rendu : le gabarit est rendu une fois par face.', {
    recto: bool('Vrai pendant le rendu du recto.'),
    verso: bool('Vrai pendant le rendu du verso.'),
  }),
  person: obj('Collaborateur (données professionnelles seulement).', {
    firstName: text('Prénom (ou prénom d’usage).'),
    lastName: text('Nom.'),
    displayName: text('Prénom et nom.'),
    initials: text('Initiales (deux lettres), à défaut de photo.'),
    jobTitle: text('Poste.'),
    department: maybe('Service, ou vide.'),
    employeeNumber: maybe('Matricule, ou vide (masqué si l’organisation le décide).'),
    workEmail: maybe('E-mail professionnel, ou vide.'),
    workPhone: maybe('Téléphone professionnel, ou vide.'),
    hasPhoto: bool('Vrai si une photo consentie existe.'),
    photo: maybe('Photo : à placer tel quel dans `<img src="{{person.photo}}">`.'),
  }),
  organization: obj('Organisation (identité visuelle et réglages des cartes).', {
    name: text('Nom de l’organisation.'),
    initials: text('Initiales de l’organisation.'),
    logo: maybe('Logo principal : `<img src="{{organization.logo}}">`.'),
    logoLight: maybe('Logo pour fond sombre : `<img src="{{organization.logoLight}}">`.'),
    address: maybe('Adresse imprimée, ou vide.'),
    website: maybe('Site, ou vide.'),
    phone: maybe('Téléphone de l’organisation, ou vide.'),
    slogan: maybe('Slogan, ou vide.'),
  }),
  card: obj('Carte.', {
    kindLabel: text('« Carte de service » ou « Carte de visite ».'),
    serial: maybe('Numéro d’émission (carte de service), ou vide.'),
  }),
});

/** Données d'un rendu (jetons d'image à la place des octets). */
export function cardTemplateData(d: CardData, face: 'recto' | 'verso'): DataValue {
  return {
    face: { recto: face === 'recto', verso: face === 'verso' },
    person: {
      firstName: d.firstName,
      lastName: d.lastName,
      displayName: d.displayName,
      initials: d.initials,
      jobTitle: d.jobTitle,
      department: d.department,
      employeeNumber: d.employeeNumber,
      workEmail: d.workEmail,
      workPhone: d.workPhone,
      hasPhoto: d.photo !== null,
      photo: d.photo ? CARD_IMAGE_TOKENS.photo : null,
    },
    organization: {
      name: d.org.name,
      initials: d.org.initials,
      logo: d.org.logo ? CARD_IMAGE_TOKENS.logo : null,
      logoLight: d.org.logoLight ? CARD_IMAGE_TOKENS.logoLight : null,
      address: d.org.address,
      website: d.org.website,
      phone: d.org.phone,
      slogan: d.org.slogan,
    },
    card: {
      kindLabel: d.kind === 'badge' ? 'Carte de service' : 'Carte de visite',
      serial: d.serial !== null ? String(d.serial) : null,
    },
  };
}

/** Liste plate « chemin — type — description », pour le guide et son test. */
export function cardVariableList(): Array<{ path: string; type: string; doc: string }> {
  const out: Array<{ path: string; type: string; doc: string }> = [];
  const walk = (t: FieldType, path: string) => {
    if (t.kind === 'object') {
      for (const [k, v] of Object.entries(t.fields)) walk(v, path ? `${path}.${k}` : k);
      return;
    }
    out.push({
      path,
      type:
        t.kind === 'bool'
          ? 'booléen'
          : t.kind === 'list'
            ? 'liste'
            : t.nullable
              ? 'texte ou vide'
              : 'texte',
      doc: t.doc,
    });
  };
  walk(CARD_DATA_SCHEMA, '');
  return out;
}
