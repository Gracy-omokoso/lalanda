// Données sensibles du collaborateur (ADR-0045 § 2.4, § 8) — logique pure, lot H7.
//
// Par défaut, l'écran ne montre que les FORMES MASQUÉES servies par l'API (« Salaire
// renseigné depuis le … », « Rawbank •••• 4521 », type et expiration d'une pièce).
// « Afficher » appelle `reveal` après une confirmation qui dit que l'affichage est
// journalisé ; le clair n'existe que dans l'état de l'écran, 60 secondes au plus, et
// disparaît au changement d'onglet. Rien n'est calculé : un salaire est une donnée
// déclarée, rendue telle quelle.
//
// Les formulaires se valident avec les schémas PARTAGÉS (`HR_PRIVATE_SECTION_SCHEMAS`,
// `@lalanda/shared/hr`) : mêmes règles et mêmes messages que l'API, qui reste juge.

import {
  HR_LIMITS,
  HR_PRIVATE_SECTION_SCHEMAS,
  type EmployeePrivateSummary,
  type HrBankAccount,
  type HrCompensationPeriod,
  type HrCurrency,
  type HrIdDocumentKind,
  type HrPrivateField,
  type HrPrivateSections,
} from '@lalanda/shared/hr';

import type { OrgAction } from '@/lib/api';

import { formatJour, messageRh, statutDe } from './rh-model';

// ── Droits ──────────────────────────────────────────────────────────────────

type Actions = readonly OrgAction[] | null;
const a = (x: Actions, action: OrgAction): boolean => x !== null && x.includes(action);

/** Lire les formes masquées et afficher : `hr.sensitive.read`, ou soi-même (§ 2.4). */
export function peutVoirSensible(actions: Actions, estSoi: boolean): boolean {
  return estSoi || a(actions, 'hr.sensitive.read');
}

/** Modifier une section : `hr.manage` ET `hr.sensitive.read` (le salarié ne modifie pas). */
export function peutModifierSensible(actions: Actions): boolean {
  return a(actions, 'hr.manage') && a(actions, 'hr.sensitive.read');
}

/** Anonymiser : `hr.manage` ET `hr.sensitive.read`, collaborateur sorti seulement. */
export function peutAnonymiser(actions: Actions): boolean {
  return peutModifierSensible(actions);
}

// ── Sections ────────────────────────────────────────────────────────────────

export interface SectionSensible {
  champ: HrPrivateField;
  titre: string;
  aide: string;
}

export const SECTIONS_SENSIBLES: readonly SectionSensible[] = [
  {
    champ: 'compensation',
    titre: 'Salaire',
    aide: 'Salaire de base contractuel, déclaré. Lalanda ne calcule aucune paie.',
  },
  {
    champ: 'bankDetails',
    titre: 'Coordonnées bancaires',
    aide: 'Trois moyens de paiement au plus : compte bancaire ou mobile money.',
  },
  {
    champ: 'identity',
    titre: 'Pièces d’identité',
    aide: 'Date de naissance, nationalité et pièces. Le numéro n’apparaît qu’à l’affichage.',
  },
  {
    champ: 'personalContact',
    titre: 'Coordonnées personnelles et contacts d’urgence',
    aide: 'Adresse, téléphone et e-mail personnels, trois contacts d’urgence au plus.',
  },
  {
    champ: 'exitNote',
    titre: 'Motif détaillé de sortie',
    aide: 'Le commentaire de sortie est une donnée sensible.',
  },
];

/** Durée d'affichage du clair (§ 8 : « après 60 secondes »). */
export const DUREE_AFFICHAGE_MS = 60_000;

export const PHRASE_JOURNALISEE =
  'L’affichage est journalisé : votre nom, l’heure et la section affichée sont inscrits au journal d’audit de l’organisation, sans les valeurs. Les valeurs disparaissent après 60 secondes ou quand vous quittez l’onglet.';

export const PHRASE_PLAFOND = `Vous avez atteint le plafond de ${HR_LIMITS.revealsPerHour} affichages de données sensibles par heure. Rien n’a été affiché ; réessayez dans une heure.`;

/** Message d'un refus de `reveal` ou d'écriture : le plafond se dit en clair. */
export function messageSensible(err: unknown, repli: string): string {
  if (statutDe(err) === 429) return PHRASE_PLAFOND;
  if (statutDe(err) === 403) {
    return 'Votre rôle ne permet pas d’afficher les données sensibles de ce collaborateur.';
  }
  return messageRh(err, repli);
}

export const LIBELLES_PIECE: Record<HrIdDocumentKind, string> = {
  national_id: 'Carte d’identité',
  passport: 'Passeport',
  voter_card: 'Carte d’électeur',
  residence_permit: 'Titre de séjour',
  other: 'Autre pièce',
};

export const LIBELLES_PERIODE_SALAIRE: Record<HrCompensationPeriod, string> = {
  month: 'par mois',
  day: 'par jour',
  hour: 'par heure',
};

const pluriel = (n: number, un: string, plusieurs: string): string =>
  `${n} ${n >= 2 ? plusieurs : un}`;

/** Lignes masquées d'une section (forme servie sans `reveal`). Vide : non renseignée. */
export function lignesMasquees(champ: HrPrivateField, s: EmployeePrivateSummary): string[] {
  switch (champ) {
    case 'compensation':
      return s.compensation
        ? [
            `Salaire renseigné depuis le ${formatJour(s.compensation.since)}`,
            `${pluriel(s.compensation.entries, 'entrée', 'entrées')} dans l’historique`,
          ]
        : [];
    case 'bankDetails':
      return s.bankDetails
        ? s.bankDetails.accounts.map(
            (c) => `${c.kind === 'bank' ? 'Banque' : 'Mobile money'} · ${c.masked}`,
          )
        : [];
    case 'identity': {
      if (!s.identity) return [];
      const l: string[] = [];
      if (s.identity.hasBirthDate) l.push('Date de naissance renseignée');
      if (s.identity.hasNationality) l.push('Nationalité renseignée');
      for (const p of s.identity.idDocuments) {
        l.push(
          `${LIBELLES_PIECE[p.kind]}${p.expiresOn ? ` — expire le ${formatJour(p.expiresOn)}` : ''}`,
        );
      }
      return l.length > 0 ? l : ['Section enregistrée, sans pièce'];
    }
    case 'personalContact': {
      if (!s.personalContact) return [];
      const c = s.personalContact;
      const l: string[] = [];
      if (c.hasAddress) l.push('Adresse renseignée');
      if (c.hasPersonalPhone) l.push('Téléphone personnel renseigné');
      if (c.hasPersonalEmail) l.push('E-mail personnel renseigné');
      l.push(
        c.emergencyContacts === 0
          ? 'Aucun contact d’urgence'
          : `${pluriel(c.emergencyContacts, 'contact', 'contacts')} d’urgence renseigné${c.emergencyContacts >= 2 ? 's' : ''}`,
      );
      return l;
    }
    case 'exitNote':
      return s.exitNote ? ['Motif détaillé renseigné'] : [];
  }
}

/** Date de dernière modification d'une section, si elle existe. */
export function modifieeLe(champ: HrPrivateField, s: EmployeePrivateSummary): string | null {
  const v = s[champ];
  return v ? v.changedAt : null;
}

// ── Clair (après `reveal`) ──────────────────────────────────────────────────

const ou = (v: string | null | undefined): string => (v && v.trim() !== '' ? v : '—');

/** Montant déclaré mis en forme pour la lecture (espaces de milliers), sans calcul. */
export function formatMontantDeclare(montant: string, devise: HrCurrency): string {
  const [entier = '', fraction = ''] = montant.split('.');
  const groupe = entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${groupe}${fraction && fraction !== '00' ? `,${fraction}` : ''} ${devise}`;
}

/** Lignes lisibles d'une section en clair : [libellé, valeur]. */
export function lignesClaires<F extends HrPrivateField>(
  champ: F,
  data: HrPrivateSections[F] | null | undefined,
): [string, string][] {
  if (!data) return [];
  switch (champ) {
    case 'compensation':
      return (data as HrPrivateSections['compensation']).history.map((h) => [
        `Depuis le ${formatJour(h.effectiveFrom)}`,
        `${formatMontantDeclare(h.amount, h.currency)} ${LIBELLES_PERIODE_SALAIRE[h.period]}${h.note ? ` — ${h.note}` : ''}`,
      ]);
    case 'bankDetails':
      return (data as HrPrivateSections['bankDetails']).accounts.map((c: HrBankAccount) =>
        c.kind === 'bank'
          ? [
              c.bankName,
              [
                `Titulaire : ${c.holderName}`,
                `Compte : ${c.accountNumber}`,
                c.iban ? `IBAN : ${c.iban}` : null,
                c.swift ? `BIC : ${c.swift}` : null,
              ]
                .filter(Boolean)
                .join(' · '),
            ]
          : [c.operator, `Titulaire : ${c.holderName} · Numéro : ${c.phoneNumber}`],
      );
    case 'identity': {
      const d = data as HrPrivateSections['identity'];
      return [
        ['Date de naissance', d.birthDate ? formatJour(d.birthDate) : '—'],
        ['Nationalité', ou(d.nationality)],
        ...d.idDocuments.map((p): [string, string] => [
          LIBELLES_PIECE[p.kind],
          [
            `N° ${p.number}`,
            p.issuedOn ? `délivrée le ${formatJour(p.issuedOn)}` : null,
            p.expiresOn ? `expire le ${formatJour(p.expiresOn)}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        ]),
      ];
    }
    case 'personalContact': {
      const d = data as HrPrivateSections['personalContact'];
      return [
        ['Adresse', ou(d.address)],
        ['Téléphone personnel', ou(d.personalPhone)],
        ['E-mail personnel', ou(d.personalEmail)],
        ...d.emergencyContacts.map((c, i): [string, string] => [
          `Contact d’urgence ${i + 1}`,
          `${c.name} (${c.relation}) · ${c.phone}`,
        ]),
      ];
    }
    case 'exitNote':
      return [['Motif', (data as HrPrivateSections['exitNote']).note]];
  }
  return [];
}

// ── Formulaires (modification en fenêtre modale) ────────────────────────────

export interface LigneSalaire {
  effectiveFrom: string;
  amount: string;
  currency: HrCurrency;
  period: HrCompensationPeriod;
  note: string;
}
export interface LigneCompte {
  kind: 'bank' | 'mobile_money';
  /** Banque ou opérateur. */
  nom: string;
  holderName: string;
  /** Numéro de compte ou de téléphone. */
  numero: string;
  iban: string;
  swift: string;
}
export interface LignePiece {
  kind: HrIdDocumentKind;
  number: string;
  issuedOn: string;
  expiresOn: string;
}
export interface LigneContact {
  name: string;
  relation: string;
  phone: string;
}

export interface FormSensible {
  salaires: LigneSalaire[];
  comptes: LigneCompte[];
  birthDate: string;
  nationality: string;
  pieces: LignePiece[];
  address: string;
  personalPhone: string;
  personalEmail: string;
  contacts: LigneContact[];
  note: string;
}

export const LIGNE_SALAIRE_VIDE: LigneSalaire = {
  effectiveFrom: '',
  amount: '',
  currency: 'CDF',
  period: 'month',
  note: '',
};
export const LIGNE_COMPTE_VIDE: LigneCompte = {
  kind: 'bank',
  nom: '',
  holderName: '',
  numero: '',
  iban: '',
  swift: '',
};
export const LIGNE_PIECE_VIDE: LignePiece = {
  kind: 'national_id',
  number: '',
  issuedOn: '',
  expiresOn: '',
};
export const LIGNE_CONTACT_VIDE: LigneContact = { name: '', relation: '', phone: '' };

/** Formulaire prérempli avec le clair de la section (ou vide si elle n'existe pas). */
export function formSensible<F extends HrPrivateField>(
  champ: F,
  data: HrPrivateSections[F] | null | undefined,
): FormSensible {
  const f: FormSensible = {
    salaires: [],
    comptes: [],
    birthDate: '',
    nationality: '',
    pieces: [],
    address: '',
    personalPhone: '',
    personalEmail: '',
    contacts: [],
    note: '',
  };
  if (!data) {
    if (champ === 'compensation') f.salaires = [{ ...LIGNE_SALAIRE_VIDE }];
    if (champ === 'bankDetails') f.comptes = [{ ...LIGNE_COMPTE_VIDE }];
    return f;
  }
  switch (champ) {
    case 'compensation':
      f.salaires = (data as HrPrivateSections['compensation']).history.map((h) => ({
        effectiveFrom: h.effectiveFrom,
        amount: h.amount,
        currency: h.currency,
        period: h.period,
        note: h.note ?? '',
      }));
      break;
    case 'bankDetails':
      f.comptes = (data as HrPrivateSections['bankDetails']).accounts.map((c) =>
        c.kind === 'bank'
          ? {
              kind: 'bank',
              nom: c.bankName,
              holderName: c.holderName,
              numero: c.accountNumber,
              iban: c.iban ?? '',
              swift: c.swift ?? '',
            }
          : {
              kind: 'mobile_money',
              nom: c.operator,
              holderName: c.holderName,
              numero: c.phoneNumber,
              iban: '',
              swift: '',
            },
      );
      break;
    case 'identity': {
      const d = data as HrPrivateSections['identity'];
      f.birthDate = d.birthDate ?? '';
      f.nationality = d.nationality ?? '';
      f.pieces = d.idDocuments.map((p) => ({
        kind: p.kind,
        number: p.number,
        issuedOn: p.issuedOn ?? '',
        expiresOn: p.expiresOn ?? '',
      }));
      break;
    }
    case 'personalContact': {
      const d = data as HrPrivateSections['personalContact'];
      f.address = d.address ?? '';
      f.personalPhone = d.personalPhone ?? '';
      f.personalEmail = d.personalEmail ?? '';
      f.contacts = d.emergencyContacts.map((c) => ({ ...c }));
      break;
    }
    case 'exitNote':
      f.note = (data as HrPrivateSections['exitNote']).note;
      break;
  }
  return f;
}

const t = (v: string): string => v.trim();
const n = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/** Corps brut d'une section, avant validation (forme d'entrée du schéma partagé). */
export function corpsSensible(champ: HrPrivateField, f: FormSensible): unknown {
  switch (champ) {
    case 'compensation':
      return {
        history: f.salaires.map((s) => ({
          effectiveFrom: t(s.effectiveFrom),
          // Saisie « 450 000,50 » : forme seulement (espaces retirés, virgule en point).
          amount: t(s.amount).replace(/[\s ]/g, '').replace(',', '.'),
          currency: s.currency,
          period: s.period,
          note: n(s.note),
        })),
      };
    case 'bankDetails':
      return {
        accounts: f.comptes.map((c) =>
          c.kind === 'bank'
            ? {
                kind: 'bank',
                bankName: t(c.nom),
                holderName: t(c.holderName),
                accountNumber: t(c.numero),
                iban: n(c.iban),
                swift: n(c.swift),
              }
            : {
                kind: 'mobile_money',
                operator: t(c.nom),
                holderName: t(c.holderName),
                phoneNumber: t(c.numero),
              },
        ),
      };
    case 'identity':
      return {
        birthDate: n(f.birthDate),
        nationality: n(f.nationality),
        idDocuments: f.pieces.map((p) => ({
          kind: p.kind,
          number: t(p.number),
          issuedOn: n(p.issuedOn),
          expiresOn: n(p.expiresOn),
        })),
      };
    case 'personalContact':
      return {
        address: n(f.address),
        personalPhone: n(f.personalPhone),
        personalEmail: n(f.personalEmail),
        emergencyContacts: f.contacts.map((c) => ({
          name: t(c.name),
          relation: t(c.relation),
          phone: t(c.phone),
        })),
      };
    case 'exitNote':
      return { note: t(f.note) };
  }
}

/**
 * Valide une section avec le schéma partagé. Les messages sont ceux de l'API ; le
 * chemin du champ fautif est rendu lisible (« Ligne 2 : … »).
 */
export function validerSensible<F extends HrPrivateField>(
  champ: F,
  f: FormSensible,
): { ok: true; data: HrPrivateSections[F] } | { ok: false; erreurs: string[] } {
  const r = HR_PRIVATE_SECTION_SCHEMAS[champ].safeParse(corpsSensible(champ, f));
  if (r.success) return { ok: true, data: r.data as HrPrivateSections[F] };
  const erreurs = r.error.issues.map((i) => {
    const ligne = i.path.find((p) => typeof p === 'number');
    return typeof ligne === 'number' ? `Ligne ${ligne + 1} : ${i.message}` : i.message;
  });
  return { ok: false, erreurs: [...new Set(erreurs)] };
}

/** Bornes des lignes répétées (bouton « Ajouter » masqué au plafond). */
export const MAX_LIGNES = {
  salaires: HR_LIMITS.compensationHistoryMax,
  comptes: HR_LIMITS.bankDetailsMax,
  pieces: HR_LIMITS.idDocumentsMax,
  contacts: HR_LIMITS.emergencyContactsMax,
} as const;

/** Bandeau d'alerte bancaire (§ 2.4) : sept jours après un changement. */
export function phraseAlerteBancaire(s: EmployeePrivateSummary): string | null {
  if (!s.bankDetailsAlert) return null;
  return `Coordonnées bancaires modifiées le ${formatJour(s.bankDetailsAlert.changedAt.slice(0, 10))}. Vérifiez ce changement directement avec le collaborateur avant tout virement : le détournement de salaire est la fraude la plus courante.`;
}
