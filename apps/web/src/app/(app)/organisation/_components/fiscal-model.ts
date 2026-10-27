// Logique pure de l'onglet Fiscalité (S25b — ADR-0021, chantier C).
//
// Isolée du rendu pour être testable : `apps/web` tourne vitest en environnement
// `node`, sans DOM. Tout ce qui décide vit ici, les `.tsx` assemblent.
//
// Rien de ce fichier n'AUTORISE quoi que ce soit. Le serveur reste seul juge :
// prérequis d'activation, verrou du NIF, fenêtre de ré-authentification, test du
// jeton auprès de la DGI. L'interface traduit ses réponses en mots.
//
// Le jeton e-MCF ne passe JAMAIS par ce module : aucune fonction ne le reçoit,
// ne le formate ni ne le conserve. Seul `last4`, servi par l'API, est affiché.

import type {
  EdefEnvironment,
  FiscalLegalForm,
  FiscalProfile,
  FiscalProfileBody,
  NormalizedInvoicingView,
  PointOfSaleStatus,
  PointOfSaleView,
} from '@/lib/api';

import { codeErreur, formatDate } from './organization-model';

// ─────────────────────────────────────────────────────────────────────────────
// Lecture des erreurs de l'API
// ─────────────────────────────────────────────────────────────────────────────

/** Corps d'erreur de l'API (`code`, `message`, `details` éventuels). */
function detailDe(err: unknown): Record<string, unknown> | null {
  if (typeof err !== 'object' || err === null || !('detail' in err)) return null;
  const detail = (err as { detail: unknown }).detail;
  return typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>) : null;
}

function detailsDe(err: unknown): Record<string, unknown> | null {
  const d = detailDe(err);
  const details = d?.['details'];
  return typeof details === 'object' && details !== null
    ? (details as Record<string, unknown>)
    : null;
}

const MESSAGES_FISCAUX: Record<string, string> = {
  FORBIDDEN:
    'Votre rôle ne donne pas accès à la fiscalité. Elle est gérée par un Propriétaire ou un Directeur financier.',
  NO_ORGANIZATION: 'Aucune organisation active. Créez-en une ou acceptez une invitation.',
  INVALID_REQUEST: 'Certaines valeurs sont refusées. Vérifiez les champs signalés.',
  FISCAL_IDENTITY_LOCKED:
    'Le NIF ne peut pas être modifié tant que la facture normalisée est activée. Les autres champs restent modifiables.',
  FISCAL_PROFILE_REQUIRED:
    'Enregistrez d’abord la fiche fiscale : le jeton est vérifié contre son NIF.',
  NORMALIZED_INVOICING_PREREQUISITES:
    'La facture normalisée ne peut pas être activée : des conditions manquent.',
  DGI_PRODUCTION_UNAVAILABLE:
    'La production sera ouverte après l’homologation de Lalanda par la DGI.',
  EMCF_ALREADY_REGISTERED:
    'Cet e-MCF est déjà rattaché à une organisation sur Lalanda. Un e-MCF n’appartient qu’à une seule organisation.',
  LAST_ACTIVE_POINT_OF_SALE:
    'C’est le dernier point de vente actif alors que la facture normalisée est activée : il ne peut pas être retiré.',
  POINT_OF_SALE_NOT_FOUND: 'Point de vente introuvable.',
  EMCF_TOKEN_REJECTED: 'La DGI a refusé ce jeton. Rien n’a été enregistré.',
  EMCF_STATUS_FALSE: 'La DGI indique que ce jeton n’est pas opérationnel. Rien n’a été enregistré.',
  EMCF_NIF_MISMATCH:
    'Le NIF associé à ce jeton par la DGI est différent de celui de la fiche fiscale. Rien n’a été enregistré.',
  EMCF_NIM_MISMATCH:
    'Le NIM renvoyé par la DGI ne correspond pas au NIM attendu pour ce point de vente. Rien n’a été enregistré.',
  EMCF_TOKEN_EXPIRED: 'Ce jeton est expiré selon la DGI. Rien n’a été enregistré.',
  EMCF_DISABLED_AT_DGI: 'Cet e-MCF est désactivé auprès de la DGI. Rien n’a été enregistré.',
  EDEF_INVALID_RESPONSE:
    'La DGI a renvoyé une réponse illisible. Rien n’a été enregistré ; réessayez plus tard.',
  EDEF_UNREACHABLE:
    'Le serveur de la DGI ne répond pas. Rien n’a été enregistré ; réessayez plus tard.',
  EMCF_TOKEN_MISSING:
    'Aucun jeton n’est enregistré pour ce point de vente. Fournissez-en un avant de lire les listes de la DGI.',
  EMCF_TOKEN_UNREADABLE:
    'Le jeton enregistré pour ce point de vente est illisible. Saisissez-le à nouveau avec « Remplacer le jeton ».',
  VAULT_UNAVAILABLE:
    'Le coffre de Lalanda est indisponible : aucun jeton ne peut être enregistré pour le moment. Contactez le support.',
  INVALID_PASSWORD: 'Mot de passe incorrect.',
  REAUTH_REQUIRED: 'Confirmez votre identité pour poursuivre.',
  REAUTH_GOOGLE_REQUIRED: 'Reconnectez-vous avec Google pour poursuivre.',
};

const PANNE_DGI: Record<string, string> = {
  timeout: 'délai dépassé',
  network: 'connexion impossible',
  server: 'erreur du serveur DGI',
};

/** Message en français d'une erreur de l'onglet Fiscalité. */
export function messageFiscal(err: unknown, repli: string): string {
  const code = codeErreur(err);
  if (code === 'EDEF_UNREACHABLE') {
    const kind = detailsDe(err)?.['kind'];
    const precision = typeof kind === 'string' ? PANNE_DGI[kind] : undefined;
    return precision
      ? `${MESSAGES_FISCAUX['EDEF_UNREACHABLE']!} (${precision})`
      : MESSAGES_FISCAUX['EDEF_UNREACHABLE']!;
  }
  // Un 400 sans problème de champ (activation déjà faite dans l'autre
  // environnement, motif manquant…) : le message du serveur dit exactement quoi
  // faire, la phrase générique « vérifiez les champs » serait fausse.
  if (code === 'INVALID_REQUEST' && Object.keys(erreursParChamp(err)).length === 0) {
    const m = detailDe(err)?.['message'];
    if (typeof m === 'string' && m !== '') return m;
  }
  if (code && MESSAGES_FISCAUX[code]) return MESSAGES_FISCAUX[code]!;
  return err instanceof Error && err.message !== '' ? err.message : repli;
}

/**
 * Code et libellé DGI d'une erreur, À AFFICHER TELS QUELS : la DGI exige que
 * l'utilisateur les voie (ADR-0021 §10). `null` si l'erreur ne vient pas d'elle.
 */
export function erreurDgi(err: unknown): { code: string | null; message: string | null } | null {
  const details = detailsDe(err);
  if (!details) return null;
  const code = typeof details['dgiErrorCode'] === 'string' ? details['dgiErrorCode'] : null;
  const message = typeof details['dgiMessage'] === 'string' ? details['dgiMessage'] : null;
  return code === null && message === null ? null : { code, message };
}

/**
 * Erreurs de validation rangées par champ (`headOffice.city` → message).
 *
 * L'API renvoie les `issues` Zod sous `details.issues` (contrat §10) ; les
 * contrôleurs plus anciens les posent à la racine du corps — on lit les deux.
 * `FISCAL_IDENTITY_LOCKED` est rattaché au champ NIF : c'est lui que la
 * personne doit regarder.
 */
export function erreursParChamp(err: unknown): Record<string, string> {
  const code = codeErreur(err);
  if (code === 'FISCAL_IDENTITY_LOCKED')
    return { nif: MESSAGES_FISCAUX['FISCAL_IDENTITY_LOCKED']! };
  if (code !== 'INVALID_REQUEST') return {};
  const issues = detailsDe(err)?.['issues'] ?? detailDe(err)?.['issues'];
  if (!Array.isArray(issues)) return {};
  const out: Record<string, string> = {};
  for (const issue of issues) {
    if (typeof issue !== 'object' || issue === null) continue;
    const { path, message, code } = issue as {
      path?: unknown;
      message?: unknown;
      code?: unknown;
    };
    // L'API fiscale sert le chemin déjà joint (`"headOffice.city"`) ; Zod brut,
    // un tableau. On accepte les deux.
    const cle = Array.isArray(path)
      ? path.map(String).join('.')
      : typeof path === 'string'
        ? path
        : '';
    if (cle === '') continue;
    if (out[cle] === undefined) {
      out[cle] = messageIssue(code, message);
    }
  }
  return out;
}

/**
 * Message d'un problème de validation, en français.
 *
 * Les messages écrits par l'API (« NIF : 5 à 20 lettres ou chiffres ») passent
 * tels quels ; les messages PAR DÉFAUT de Zod, en anglais (« String must contain
 * at least 1 character(s) » sous zod 3, « Too small: expected string to have
 * >=1 characters » sous zod 4), sont remplacés d'après leur code.
 */
const MESSAGES_ZOD: Record<string, string> = {
  too_small: 'Ce champ est obligatoire ou trop court.',
  too_big: 'Ce champ est trop long.',
  invalid_type: 'Valeur manquante ou invalide.',
  invalid_string: 'Format invalide.',
  invalid_enum_value: 'Choix non reconnu.',
  unrecognized_keys: 'Champ non reconnu.',
};

const ZOD_ANGLAIS =
  /^(String|Number|Array|Expected|Required|Invalid|Unrecognized|Too (small|big))\b/;

export function messageIssue(code: unknown, message: unknown): string {
  if (typeof message === 'string' && message !== '' && !ZOD_ANGLAIS.test(message)) return message;
  if (typeof code === 'string' && MESSAGES_ZOD[code]) return MESSAGES_ZOD[code]!;
  return 'Valeur refusée.';
}

/** Codes de prérequis renvoyés par `409 NORMALIZED_INVOICING_PREREQUISITES`. */
export function prerequisManquantsDeErreur(err: unknown): string[] | null {
  if (codeErreur(err) !== 'NORMALIZED_INVOICING_PREREQUISITES') return null;
  const missing = detailsDe(err)?.['missing'];
  return Array.isArray(missing) ? missing.filter((m): m is string => typeof m === 'string') : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Ré-authentification : une seule nouvelle tentative
// ─────────────────────────────────────────────────────────────────────────────

export type ModeReauth = 'password' | 'google';

/** Le refus exige-t-il une ré-authentification, et laquelle ? */
export function modeReauthExige(err: unknown): ModeReauth | null {
  if (typeof err !== 'object' || err === null || !('status' in err)) return null;
  if ((err as { status: unknown }).status !== 401) return null;
  const code = codeErreur(err);
  if (code === 'REAUTH_REQUIRED') return 'password';
  if (code === 'REAUTH_GOOGLE_REQUIRED') return 'google';
  return null;
}

/**
 * Exécute `operation` ; sur `401 REAUTH_REQUIRED` (ou `REAUTH_GOOGLE_REQUIRED`),
 * demande la ré-authentification puis REJOUE UNE FOIS.
 *
 * - `demander` résout `true` si la fenêtre est ouverte, `false` si la personne
 *   annule (l'erreur d'origine est alors relancée).
 * - Une seconde exigence après la nouvelle tentative n'ouvre PAS de nouvelle
 *   boîte : elle remonte telle quelle. Une boucle de demandes de mot de passe
 *   serait pire qu'un échec franc.
 */
export async function avecReauth<T>(
  operation: () => Promise<T>,
  demander: (mode: ModeReauth) => Promise<boolean>,
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    const mode = modeReauthExige(err);
    if (mode === null) throw err;
    const ouverte = await demander(mode);
    if (!ouverte) throw err;
    return operation();
  }
}

/**
 * Action à reprendre après l'aller-retour chez Google.
 *
 * La connexion Google quitte la page : l'action interrompue est décrite ici,
 * SANS AUCUN JETON. Une action qui portait un jeton (création d'un point de
 * vente, remplacement) n'est pas reprise : la personne le saisit à nouveau.
 * C'est voulu — un jeton ne se range jamais dans le navigateur.
 */
export type ActionReprise =
  | { type: 'activate'; environment: EdefEnvironment }
  | { type: 'deactivate'; reason: string }
  | { type: 'environment'; environment: EdefEnvironment; reason: string | null }
  | { type: 'disable_pos'; posId: string; label: string; reason: string | null };

/** Une reprise ne vaut que dix minutes : la fenêtre de ré-authentification. */
export const DUREE_REPRISE_MS = 10 * 60 * 1000;

const CLES_AUTORISEES: Record<ActionReprise['type'], readonly string[]> = {
  activate: ['type', 'environment'],
  deactivate: ['type', 'reason'],
  environment: ['type', 'environment', 'reason'],
  disable_pos: ['type', 'posId', 'label', 'reason'],
};

export function serialiserReprise(action: ActionReprise, maintenant = Date.now()): string {
  return JSON.stringify({ action, at: maintenant });
}

/**
 * Relit une reprise. Refuse tout ce qui n'est pas exactement une des quatre
 * formes — en particulier une clé `token` — et toute reprise périmée.
 */
export function lireReprise(brut: string | null, maintenant = Date.now()): ActionReprise | null {
  if (!brut) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(brut);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { action, at } = parsed as { action?: unknown; at?: unknown };
  if (typeof at !== 'number' || maintenant - at > DUREE_REPRISE_MS || at > maintenant + 60_000) {
    return null;
  }
  if (typeof action !== 'object' || action === null) return null;
  const a = action as Record<string, unknown>;
  const type = a['type'];
  if (typeof type !== 'string' || !(type in CLES_AUTORISEES)) return null;
  const autorisees = CLES_AUTORISEES[type as ActionReprise['type']];
  if (Object.keys(a).some((k) => !autorisees.includes(k))) return null;
  const env = (v: unknown): v is EdefEnvironment => v === 'test' || v === 'production';
  const texte = (v: unknown): v is string => typeof v === 'string';
  const texteOuNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
  switch (type) {
    case 'activate':
      return env(a['environment']) ? { type, environment: a['environment'] } : null;
    case 'deactivate':
      return texte(a['reason']) ? { type, reason: a['reason'] } : null;
    case 'environment':
      return env(a['environment']) && texteOuNull(a['reason'])
        ? { type, environment: a['environment'], reason: a['reason'] }
        : null;
    case 'disable_pos':
      return texte(a['posId']) && texte(a['label']) && texteOuNull(a['reason'])
        ? { type, posId: a['posId'], label: a['label'], reason: a['reason'] }
        : null;
    default:
      return null;
  }
}

export function libelleReprise(action: ActionReprise): string {
  switch (action.type) {
    case 'activate':
      return `Activer la facture normalisée (${libelleEnvironnement(action.environment)})`;
    case 'deactivate':
      return 'Désactiver la facture normalisée';
    case 'environment':
      return `Passer en ${libelleEnvironnement(action.environment)}`;
    case 'disable_pos':
      return `Retirer le point de vente « ${action.label} »`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Points de vente
// ─────────────────────────────────────────────────────────────────────────────

const ETATS: Record<PointOfSaleStatus, string> = {
  active: 'Actif',
  disabled: 'Retiré',
  token_missing: 'Jeton manquant',
  nif_mismatch: 'NIF différent de la fiche',
  token_expired: 'Jeton expiré',
  failing: 'Dernier test en échec',
};

/** État d'un point de vente, en mots. */
export function libelleEtat(status: PointOfSaleStatus): string {
  return ETATS[status] ?? status;
}

const EXPLICATIONS: Record<PointOfSaleStatus, string> = {
  active: 'Le jeton a été accepté par la DGI et correspond à la fiche fiscale.',
  disabled:
    'Ce point de vente a été retiré et son jeton détruit. Fournissez un nouveau jeton pour le réactiver.',
  token_missing: 'Aucun jeton n’est enregistré pour ce point de vente.',
  nif_mismatch:
    'Le NIF que la DGI associe à ce jeton n’est plus celui de la fiche fiscale. Corrigez la fiche ou remplacez le jeton, puis testez à nouveau.',
  token_expired: 'La DGI a fixé une date de fin de validité qui est dépassée. Remplacez le jeton.',
  failing: 'Le dernier test de connexion a échoué. Consultez la réponse ci-dessous.',
};

export function explicationEtat(status: PointOfSaleStatus): string {
  return EXPLICATIONS[status] ?? '';
}

export type TonEtat = 'succes' | 'attention' | 'echec' | 'neutre';

export function tonEtat(status: PointOfSaleStatus): TonEtat {
  if (status === 'active') return 'succes';
  if (status === 'disabled') return 'neutre';
  if (status === 'failing' || status === 'token_expired') return 'echec';
  return 'attention';
}

/** Seuil de l'avertissement de fin de validité du jeton (ADR-0021 §13 C). */
export const JOURS_ALERTE_VALIDITE = 30;

const JOUR_MS = 24 * 60 * 60 * 1000;

export type AlerteValidite =
  { niveau: 'expire'; texte: string } | { niveau: 'bientot'; jours: number; texte: string } | null;

/**
 * Avertissement sur la fin de validité du jeton : expiré, ou à moins de
 * 30 jours. `null` si la date est inconnue ou lointaine — jamais d'alerte
 * inventée sur une date qu'on n'a pas.
 */
export function alerteValidite(
  tokenValidUntil: string | null | undefined,
  maintenant = Date.now(),
): AlerteValidite {
  if (!tokenValidUntil) return null;
  const fin = Date.parse(tokenValidUntil);
  if (Number.isNaN(fin)) return null;
  const reste = fin - maintenant;
  if (reste <= 0) {
    return { niveau: 'expire', texte: `Jeton expiré depuis le ${formatDate(tokenValidUntil)}.` };
  }
  const jours = Math.ceil(reste / JOUR_MS);
  if (jours >= JOURS_ALERTE_VALIDITE) return null;
  return {
    niveau: 'bientot',
    jours,
    texte: `Le jeton expire dans ${jours} jour${jours > 1 ? 's' : ''} (le ${formatDate(
      tokenValidUntil,
    )}). Demandez-en un nouveau à la DGI et remplacez-le avant cette date.`,
  };
}

/** `****x9Zq`, ou `****` si l'API ne donne pas de suffixe (jeton court). */
export function jetonMasque(token: PointOfSaleView['token']): string {
  if (!token.configured) return 'Aucun jeton';
  return token.last4 ? `****${token.last4}` : '****';
}

/** Format accepté par l'API (ADR-0021 §4.1) — contrôle de confort, le serveur tranche. */
const FORMAT_JETON = /^[A-Za-z0-9._-]+$/;

export function erreurFormatJeton(valeur: string): string | null {
  if (valeur.length === 0) return 'Saisissez le jeton fourni par la DGI.';
  if (valeur.length < 20 || valeur.length > 4096) {
    return 'Le jeton doit compter entre 20 et 4 096 caractères.';
  }
  if (!FORMAT_JETON.test(valeur)) {
    return 'Le jeton ne contient que des lettres, des chiffres, des points, des tirets et des soulignés. Vérifiez qu’il n’y a pas d’espace.';
  }
  return null;
}

/** Points de vente triés : ceux qui demandent une action d'abord, les retirés à la fin. */
export function pointsOrdonnes(points: readonly PointOfSaleView[]): PointOfSaleView[] {
  const rang = (p: PointOfSaleView): number =>
    p.status === 'disabled' ? 2 : p.status === 'active' ? 1 : 0;
  return [...points].sort((a, b) => rang(a) - rang(b) || a.label.localeCompare(b.label, 'fr'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Facture normalisée
// ─────────────────────────────────────────────────────────────────────────────

export function libelleEnvironnement(env: EdefEnvironment): string {
  return env === 'test' ? 'mode test' : 'production';
}

export const PHRASE_PRODUCTION_FERMEE =
  'La production sera ouverte après l’homologation de Lalanda par la DGI.';

const PREREQUIS: Record<string, string> = {
  fiscal_profile: 'Enregistrer la fiche fiscale de l’organisation.',
  country_cd:
    'Avoir son siège en République démocratique du Congo (pays « CD » dans la fiche fiscale).',
  active_point_of_sale:
    'Disposer d’au moins un point de vente actif dans l’environnement choisi (jeton accepté par la DGI).',
  production_unavailable: PHRASE_PRODUCTION_FERMEE,
  nif_elsewhere:
    'Ce NIF est déjà utilisé pour la facture normalisée par une autre organisation sur Lalanda. Contactez le support.',
};

/** Un prérequis manquant, en mots. Un code inconnu reste visible, jamais avalé. */
export function libellePrerequis(code: string): string {
  return PREREQUIS[code] ?? `Condition non remplie (${code}).`;
}

/**
 * Prérequis manquants déduits de la vue, dans l'ordre où on les règle.
 *
 * La production fermée ne compte que si l'environnement courant est la
 * production.
 */
export function prerequisManquants(vue: NormalizedInvoicingView): string[] {
  const p = vue.prerequisites;
  const out: string[] = [];
  if (!p.fiscalProfileComplete) out.push('fiscal_profile');
  if (!p.countryIsCd) out.push('country_cd');
  if (!p.activePointOfSaleInEnvironment) out.push('active_point_of_sale');
  if (vue.environment === 'production' && !p.productionAvailable) {
    out.push('production_unavailable');
  }
  if (!p.nifAvailable) out.push('nif_elsewhere');
  return out;
}

/** Bornes du motif de désactivation (ADR-0021 R3). */
export const MOTIF_MIN = 20;
export const MOTIF_MAX = 500;

export function erreurMotif(motif: string): string | null {
  const n = motif.trim().length;
  if (n < MOTIF_MIN) {
    return `Le motif doit compter au moins ${MOTIF_MIN} caractères (${n} pour l’instant).`;
  }
  if (n > MOTIF_MAX) return `Le motif ne peut pas dépasser ${MOTIF_MAX} caractères.`;
  return null;
}

/**
 * Le changement d'environnement exige-t-il un motif ?
 *
 * Production → test pendant l'activation : oui, c'est traité comme une
 * désactivation (les factures suivantes n'auraient plus de valeur fiscale).
 */
export function changementExigeMotif(
  vue: Pick<NormalizedInvoicingView, 'state' | 'environment'>,
  cible: EdefEnvironment,
): boolean {
  return vue.state === 'enabled' && vue.environment === 'production' && cible === 'test';
}

/** Bandeau permanent après une désactivation : date et motif (ADR-0021 R3). */
export function bandeauDesactivation(vue: NormalizedInvoicingView): string | null {
  if (vue.state !== 'disabled' || !vue.deactivatedAt) return null;
  const motif = vue.deactivationReason ? ` — motif : ${vue.deactivationReason}` : '';
  return `Facture normalisée désactivée le ${formatDate(vue.deactivatedAt)}${motif}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fiche fiscale : formulaire ⇄ corps de requête
// ─────────────────────────────────────────────────────────────────────────────

/** Tous les champs en texte, comme les saisit le formulaire. */
export interface FormulaireFiscal {
  legalName: string;
  tradeName: string;
  legalForm: FiscalLegalForm | '';
  legalFormOther: string;
  nif: string;
  rccm: string;
  nationalId: string;
  vatRegistered: boolean;
  line1: string;
  line2: string;
  commune: string;
  city: string;
  province: string;
  country: string;
  phone: string;
  email: string;
}

export function formulaireDepuisProfil(profil: FiscalProfile | null): FormulaireFiscal {
  return {
    legalName: profil?.legalName ?? '',
    tradeName: profil?.tradeName ?? '',
    legalForm: profil?.legalForm ?? '',
    legalFormOther: profil?.legalFormOther ?? '',
    nif: profil?.nif ?? '',
    rccm: profil?.rccm ?? '',
    nationalId: profil?.nationalId ?? '',
    vatRegistered: profil?.vatRegistered ?? false,
    line1: profil?.headOffice.line1 ?? '',
    line2: profil?.headOffice.line2 ?? '',
    commune: profil?.headOffice.commune ?? '',
    city: profil?.headOffice.city ?? '',
    province: profil?.headOffice.province ?? '',
    // Lalanda sert d'abord la RDC ; la personne peut corriger.
    country: profil?.headOffice.country ?? 'CD',
    phone: profil?.phone ?? '',
    email: profil?.email ?? '',
  };
}

const ouNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/**
 * Corps COMPLET du `PUT` : espaces de bord retirés, champs facultatifs vides
 * envoyés à `null`, `legalFormOther` à `null` hors « Autre ». Le NIF part tel
 * que saisi : c'est le serveur qui le normalise (majuscules, tirets retirés).
 */
export function corpsDepuisFormulaire(f: FormulaireFiscal): FiscalProfileBody {
  const legalForm = f.legalForm === '' ? null : f.legalForm;
  return {
    legalName: f.legalName.trim(),
    tradeName: ouNull(f.tradeName),
    legalForm,
    legalFormOther: legalForm === 'autre' ? ouNull(f.legalFormOther) : null,
    nif: f.nif.trim(),
    rccm: ouNull(f.rccm),
    nationalId: ouNull(f.nationalId),
    vatRegistered: f.vatRegistered,
    headOffice: {
      line1: f.line1.trim(),
      line2: ouNull(f.line2),
      commune: ouNull(f.commune),
      city: f.city.trim(),
      province: ouNull(f.province),
      country: f.country.trim().toUpperCase(),
    },
    phone: f.phone.trim(),
    email: f.email.trim(),
  };
}

/** Chemin d'erreur serveur (`headOffice.city`) → identifiant du champ du formulaire. */
export const CHAMP_DEPUIS_CHEMIN: Record<string, keyof FormulaireFiscal> = {
  legalName: 'legalName',
  tradeName: 'tradeName',
  legalForm: 'legalForm',
  legalFormOther: 'legalFormOther',
  nif: 'nif',
  rccm: 'rccm',
  nationalId: 'nationalId',
  vatRegistered: 'vatRegistered',
  'headOffice.line1': 'line1',
  'headOffice.line2': 'line2',
  'headOffice.commune': 'commune',
  'headOffice.city': 'city',
  'headOffice.province': 'province',
  'headOffice.country': 'country',
  phone: 'phone',
  email: 'email',
};

/**
 * Range les erreurs serveur sous les champs du formulaire. Une erreur sur un
 * chemin inconnu (`headOffice` entier, par exemple) part dans `autres` : elle
 * est affichée en tête, jamais perdue.
 */
export function erreursFormulaire(err: unknown): {
  champs: Partial<Record<keyof FormulaireFiscal, string>>;
  autres: string[];
} {
  const champs: Partial<Record<keyof FormulaireFiscal, string>> = {};
  const autres: string[] = [];
  for (const [chemin, message] of Object.entries(erreursParChamp(err))) {
    const champ = CHAMP_DEPUIS_CHEMIN[chemin];
    if (champ) champs[champ] = message;
    else autres.push(`${chemin} : ${message}`);
  }
  return { champs, autres };
}
