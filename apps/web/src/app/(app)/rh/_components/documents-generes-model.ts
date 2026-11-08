// Documents RH générés (ADR-0072) — logique pure de l'écran : formulaire, contrôles
// locaux (l'API reste juge), corps de la requête, phrases.

import {
  ATTESTATION_TITLE_LABELS,
  GENERATED_DOCUMENT_KIND_LABELS,
  GENERATED_DOCUMENT_LIMITS,
  type AttestationTitle,
  type GenerateHrDocumentInput,
  type GeneratedDocumentKind,
  type GeneratedDocumentSettingsView,
  type GeneratedDocumentTemplateId,
} from '@lalanda/shared/hr';

export { ATTESTATION_TITLE_LABELS, GENERATED_DOCUMENT_KIND_LABELS };

/** Ce qui décide des types proposés : la fiche (statut, dates). */
export interface FicheDoc {
  status: string;
  startDate: string;
  endDate: string | null;
  jobTitle: string;
}

/** Types disponibles pour cette fiche aujourd'hui (`AAAA-MM-JJ`). */
export function typesPossibles(f: FicheDoc, today: string): GeneratedDocumentKind[] {
  if (f.status === 'anonymized') return [];
  const out: GeneratedDocumentKind[] = [];
  const sorti = f.status === 'exited' || (f.endDate !== null && f.endDate < today);
  if (!sorti && f.startDate <= today) out.push('attestation');
  if (f.endDate !== null) out.push('certificate');
  return out;
}

export interface LigneEmploi {
  title: string;
  from: string;
  to: string;
}

export interface FormDocumentGenere {
  kind: GeneratedDocumentKind;
  templateId: GeneratedDocumentTemplateId;
  title: AttestationTitle;
  signataireNom: string;
  signataireQualite: string;
  lieu: string;
  date: string;
  visible: boolean;
  contrat: boolean;
  service: boolean;
  matricule: boolean;
  adresse: boolean;
  emplois: LigneEmploi[];
  cnss: string;
}

export function formInitial(
  f: FicheDoc,
  reglages: GeneratedDocumentSettingsView | null,
  kind: GeneratedDocumentKind,
  today: string,
): FormDocumentGenere {
  return {
    kind,
    templateId: reglages?.templateId ?? 'classique',
    title: 'work',
    signataireNom: reglages?.signatory?.name ?? '',
    signataireQualite: reglages?.signatory?.title ?? '',
    lieu: reglages?.place ?? '',
    date: today,
    visible: true,
    contrat: false,
    service: false,
    matricule: false,
    adresse: false,
    emplois: [{ title: f.jobTitle, from: f.startDate, to: f.endDate ?? today }],
    cnss: '',
  };
}

const L = GENERATED_DOCUMENT_LIMITS;
const BALISE = /[<>]/;

export function validerForm(form: FormDocumentGenere): Record<string, string> {
  const err: Record<string, string> = {};
  const ligne = (k: string, v: string, max: number, what: string) => {
    if (v.trim() === '') err[k] = `${what} obligatoire.`;
    else if (v.trim().length > max) err[k] = `${max} caractères au plus.`;
    else if (BALISE.test(v)) err[k] = 'Ni < ni >.';
  };
  ligne('signataireNom', form.signataireNom, L.signatoryName, 'Nom du signataire');
  ligne('signataireQualite', form.signataireQualite, L.signatoryTitle, 'Qualité du signataire');
  ligne('lieu', form.lieu, L.place, 'Lieu');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) err['date'] = 'Date attendue.';
  if (form.kind === 'certificate') {
    if (form.emplois.length === 0) err['emplois'] = 'Au moins un emploi.';
    if (form.emplois.length > L.jobs) err['emplois'] = `${L.jobs} emplois au plus.`;
    form.emplois.forEach((j, i) => {
      if (j.title.trim() === '' || BALISE.test(j.title))
        err[`emploi-${i}`] = 'Intitulé requis, sans < ni >.';
      else if (!j.from || !j.to || j.to < j.from) err[`emploi-${i}`] = 'Dates incohérentes.';
    });
    if (form.cnss.trim().length > L.socialSecurityNumber) err['cnss'] = 'Numéro trop long.';
    else if (form.cnss.trim() !== '' && !/^[0-9A-Za-z ./-]+$/.test(form.cnss.trim())) {
      err['cnss'] = 'Chiffres, lettres, espaces, points ou tirets.';
    }
  }
  return err;
}

/** Corps de `POST …/generated-documents` (et de l'aperçu). */
export function corpsGeneration(form: FormDocumentGenere): GenerateHrDocumentInput {
  const common = {
    templateId: form.templateId,
    signatory: { name: form.signataireNom.trim(), title: form.signataireQualite.trim() },
    place: form.lieu.trim(),
    issuedOn: form.date,
    visibleToEmployee: form.visible,
  };
  if (form.kind === 'attestation') {
    return {
      kind: 'attestation',
      ...common,
      title: form.title,
      includeContractType: form.contrat,
      includeDepartment: form.service,
      includeEmployeeNumber: form.matricule,
      includePersonalAddress: form.adresse,
    };
  }
  const cnss = form.cnss.trim();
  return {
    kind: 'certificate',
    ...common,
    jobs: form.emplois.map((j) => ({ title: j.title.trim(), from: j.from, to: j.to })),
    socialSecurityNumber: cnss === '' ? null : cnss,
  };
}

/** Phrase d'aide sous le formulaire, selon le type. */
export function phraseType(kind: GeneratedDocumentKind): string {
  return kind === 'attestation'
    ? 'Rien de sensible n’est imprimé par défaut ; le salaire n’est jamais proposé.'
    : 'Le certificat ne porte que les mentions de l’article 79 du Code du travail : nature et durée des services, dates de début et de fin, numéro CNSS. Ni motif de départ ni appréciation. À remettre au plus tard deux jours ouvrables après la fin du contrat.';
}
