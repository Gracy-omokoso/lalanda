// Contenu des documents RH générés — ADR-0072 § 1. Fonctions PURES.
//
// La fiche, les réglages et les choix de la génération entrent ; une liste de blocs de
// TEXTE BRUT sort (le rendu échappe tout). Le certificat est composé EXCLUSIVEMENT des
// mentions de l'art. 79 du Code du travail (RDC) : nature et durée des services, dates
// de début et de fin, numéro d'immatriculation à la sécurité sociale. Aucun paramètre
// de ces fonctions ne transporte un motif de sortie, une appréciation ou un salaire.

import {
  ATTESTATION_TITLE_LABELS,
  DEFAULT_ATTESTATION_CLOSING,
  DEFAULT_ATTESTATION_INTRO,
  GENERATED_DOCUMENT_KIND_LABELS,
  serviceDuration,
  serviceDurationLabel,
  type AttestationTitle,
  type CertificateJob,
  type GeneratedDocumentField,
} from '@lalanda/shared/hr';

export type DocBlock =
  | { kind: 'p'; text: string }
  | { kind: 'facts'; rows: Array<[string, string]> }
  | { kind: 'jobs'; title: string; rows: Array<{ title: string; period: string }> };

export interface DocContent {
  title: string;
  blocks: DocBlock[];
}

const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** `2026-11-08` → « 8 novembre 2026 » (« 1er » pour le premier du mois). */
export function longDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${d === 1 ? '1er' : d} ${MOIS[m - 1]} ${y}`;
}

/** Remplace les champs nommés `{nom}`… (les inconnus sont refusés à l'enregistrement). */
export function fillFields(text: string, values: Record<GeneratedDocumentField, string>): string {
  return text.replace(/\{([a-z_]+)\}/g, (all, name: string) =>
    name in values ? values[name as GeneratedDocumentField] : all,
  );
}

/** Fiche réduite à ce que ces documents peuvent imprimer (aucun champ sensible). */
export interface DocEmployee {
  displayName: string;
  jobTitle: string;
  startDate: string;
  endDate: string | null;
  employeeNumber: string | null;
  department: string | null;
  contractTypeLabel: string | null;
}

export interface AttestationChoices {
  title: AttestationTitle;
  intro: string | null;
  closing: string | null;
  includeContractType: boolean;
  includeDepartment: boolean;
  includeEmployeeNumber: boolean;
  /** Adresse personnelle DÉJÀ révélée (choix explicite), sinon `null`. */
  personalAddress: string | null;
}

export function attestationContent(
  e: DocEmployee,
  orgName: string,
  c: AttestationChoices,
): DocContent {
  const values = {
    nom: e.displayName,
    poste: e.jobTitle,
    date_entree: longDate(e.startDate),
    organisation: orgName,
  };
  const rows: Array<[string, string]> = [];
  if (c.includeContractType && e.contractTypeLabel) rows.push(['Contrat', e.contractTypeLabel]);
  if (c.includeDepartment && e.department) rows.push(['Service', e.department]);
  if (c.includeEmployeeNumber && e.employeeNumber) rows.push(['Matricule', e.employeeNumber]);
  if (c.personalAddress) rows.push(['Adresse', c.personalAddress]);
  const blocks: DocBlock[] = [
    { kind: 'p', text: fillFields(c.intro ?? DEFAULT_ATTESTATION_INTRO, values) },
  ];
  if (rows.length > 0) blocks.push({ kind: 'facts', rows });
  blocks.push({ kind: 'p', text: fillFields(c.closing ?? DEFAULT_ATTESTATION_CLOSING, values) });
  return { title: ATTESTATION_TITLE_LABELS[c.title], blocks };
}

export interface CertificateChoices {
  jobs: readonly CertificateJob[] | null;
  socialSecurityNumber: string | null;
}

/** Emplois par défaut : le poste de la fiche, de l'entrée à la sortie. */
export function defaultJobs(e: DocEmployee & { endDate: string }): CertificateJob[] {
  return [{ title: e.jobTitle, from: e.startDate, to: e.endDate }];
}

export function certificateContent(
  e: DocEmployee & { endDate: string },
  orgName: string,
  c: CertificateChoices,
): DocContent {
  const jobs = c.jobs && c.jobs.length > 0 ? c.jobs : defaultJobs(e);
  return {
    title: GENERATED_DOCUMENT_KIND_LABELS.certificate,
    blocks: [
      {
        kind: 'p',
        text: `Nous, ${orgName}, certifions que ${e.displayName} a été à notre service du ${longDate(e.startDate)} au ${longDate(e.endDate)}.`,
      },
      {
        kind: 'jobs',
        title: 'Nature des services prestés',
        rows: jobs.map((j) => ({
          title: j.title,
          period: `du ${longDate(j.from)} au ${longDate(j.to)}`,
        })),
      },
      {
        kind: 'facts',
        rows: [
          ['Date de début des prestations', longDate(e.startDate)],
          ['Date de fin des prestations', longDate(e.endDate)],
          ['Durée des services', serviceDurationLabel(serviceDuration(e.startDate, e.endDate))],
          ['N° d’immatriculation CNSS', c.socialSecurityNumber ?? 'non communiqué'],
        ],
      },
    ],
  };
}
