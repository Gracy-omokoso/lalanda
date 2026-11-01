// Réglages du formulaire public de prospects — ADR-0048 § 2 et § 9. Logique pure.
//
// Les règles des champs sont celles de l'API (`leadFormFieldIssues`, partagée) ;
// l'écran les applique pour ne pas proposer un enregistrement que le serveur
// refuserait. Le serveur reste seul juge (responsable éligible compris).

import {
  LEAD_FORM_DEFAULT_LABELS,
  leadFormFieldIssues,
  type CrmLeadFormView,
  type LeadFormFieldConfig,
  type LeadFormFieldKey,
  type UpdateLeadFormBody,
} from '@lalanda/shared/crm';

export { LEAD_FORM_DEFAULT_LABELS };

/** Adresse complète du lien public, à partir de l'origine du site web. */
export function lienPublic(origine: string, publicPath: string): string {
  return `${origine.replace(/\/+$/, '')}${publicPath}`;
}

/** Extrait HTML à copier : un lien-bouton (pas d'iframe : ADR-0048 O1, décision n° 6). */
export function extraitHtml(url: string, libelle = 'Nous contacter'): string {
  const echappe = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<a href="${echappe(url)}" target="_blank" rel="noopener">${echappe(libelle)}</a>`;
}

/**
 * Change « affiché » ou « obligatoire » d'un champ en gardant les règles
 * évidentes : le nom reste affiché et obligatoire ; masquer un champ le rend
 * facultatif ; le rendre obligatoire l'affiche.
 */
export function changerChamp(
  champs: readonly LeadFormFieldConfig[],
  key: LeadFormFieldKey,
  propriete: 'enabled' | 'required',
  valeur: boolean,
): LeadFormFieldConfig[] {
  return champs.map((c) => {
    if (c.key !== key || key === 'name') return c;
    if (propriete === 'enabled') return { ...c, enabled: valeur, required: valeur && c.required };
    return { ...c, required: valeur, enabled: valeur ? true : c.enabled };
  });
}

/** Problèmes des champs, en français (vide si l'enregistrement est possible). */
export function problemesChamps(champs: readonly LeadFormFieldConfig[]): string[] {
  return leadFormFieldIssues(champs).map((i) => i.message);
}

/** Ce qui manque pour activer (le serveur vérifie en plus l'éligibilité du responsable). */
export function manquesActivation(f: {
  privacyPolicyUrl: string | null;
  assigneeUserId: string | null;
  fields: readonly LeadFormFieldConfig[];
}): string[] {
  const out: string[] = [];
  if (!f.privacyPolicyUrl || f.privacyPolicyUrl.trim() === '') {
    out.push('le lien de votre politique de confidentialité');
  }
  if (!f.assigneeUserId) out.push('le responsable des demandes');
  if (problemesChamps(f.fields).length > 0) out.push('des champs conformes aux règles');
  return out;
}

/** Corps complet des réglages à partir de la vue éditée. */
export function corpsReglages(f: CrmLeadFormView, enabled: boolean): UpdateLeadFormBody {
  return {
    expectedRevision: f.revision,
    enabled,
    title: f.title,
    intro: f.intro ?? null,
    fields: f.fields,
    consentText: f.consentText,
    privacyPolicyUrl:
      f.privacyPolicyUrl && f.privacyPolicyUrl.trim() !== '' ? f.privacyPolicyUrl : null,
    successMessage: f.successMessage,
    assigneeUserId: f.assigneeUserId,
    createOpportunity: f.createOpportunity,
    opportunityCurrency: f.opportunityCurrency,
    showBranding: f.showBranding,
  };
}

const MESSAGES: Record<string, string> = {
  LEAD_FORM_EXISTS: 'Votre organisation a déjà un formulaire public.',
  LEAD_FORM_POLICY_REQUIRED:
    'Indiquez le lien de votre politique de confidentialité avant d’activer le formulaire.',
  LEAD_FORM_ASSIGNEE_REQUIRED: 'Choisissez le responsable des demandes avant d’activer.',
  CRM_ASSIGNEE_NOT_ELIGIBLE:
    'Ce membre ne gère pas le CRM : choisissez un responsable qui peut traiter les demandes.',
  CRM_MEMBER_NOT_FOUND: 'Ce membre ne fait plus partie de l’organisation.',
  URL_INVALID: 'Le lien de la politique doit commencer par https://.',
  STALE_REVISION: 'Le formulaire a été modifié entre-temps : rechargez la page.',
};

/** Message lisible d'une erreur de l'API des réglages. */
export function messageFormulaire(err: unknown, repli: string): string {
  if (typeof err !== 'object' || err === null) return repli;
  const e = err as { status?: unknown; detail?: unknown };
  if (e.status === 403) return 'Votre rôle ne permet pas de modifier le formulaire public.';
  const d =
    typeof e.detail === 'object' && e.detail !== null ? (e.detail as Record<string, unknown>) : {};
  const code = typeof d['code'] === 'string' ? d['code'] : null;
  if (code && MESSAGES[code]) return MESSAGES[code]!;
  const issues = ((d['details'] as { issues?: unknown } | undefined)?.issues ?? []) as {
    code?: string;
    message?: string;
  }[];
  for (const i of issues) {
    if (i.code && MESSAGES[i.code]) return MESSAGES[i.code]!;
  }
  if (issues[0]?.message) return issues[0].message;
  return typeof d['message'] === 'string' ? d['message'] : repli;
}
