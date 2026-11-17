// « Mes notifications » — règles d'écran pures (ADR-0079 § 8), testées.
//
// L'écran choisit un mode, puis personnalise CE mode (surcharges gardées par mode) ;
// il calcule l'aperçu des canaux avec la MÊME fonction que le serveur
// (`effectiveChannels`), et prépare les corps. Le serveur valide et applique.

import {
  CONFIGURABLE_NOTIFICATION_KINDS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_FAMILIES,
  NOTIFICATION_MODULE_LABELS,
  NOTIFICATION_SKIP_REASON_LABELS,
  defaultChannelsFor,
  effectiveChannels,
  notificationSpecOf,
  type NotificationChannel,
  type NotificationChannelSet,
  type NotificationChannelsView,
  type NotificationDeliveryStatus,
  type NotificationEventSpec,
  type NotificationFamily,
  type NotificationKind,
  type NotificationMode,
  type NotificationModeOverrides,
  type NotificationSettingsView,
  type NotificationSkipReason,
  type NotificationSourceModule,
  type PutNotificationSettingsBody,
} from '@lalanda/shared/notifications';

/** Groupe d'affichage : un module, ses familles, leurs événements. */
export interface GroupeModule {
  module: NotificationSourceModule;
  label: string;
  familles: { famille: NotificationFamily; label: string; specs: NotificationEventSpec[] }[];
}

const ORDRE_MODULES: readonly NotificationSourceModule[] = [
  'work',
  'crm',
  'sales',
  'purchases',
  'hr',
  'stock',
  'assets',
  'documents',
  'organization',
];

/** Catalogue groupé par module puis par famille, dans l'ordre du catalogue. */
export function groupesCatalogue(modules?: readonly NotificationSourceModule[]): GroupeModule[] {
  const out: GroupeModule[] = [];
  for (const mod of ORDRE_MODULES) {
    if (modules && !modules.includes(mod)) continue;
    const specs = CONFIGURABLE_NOTIFICATION_KINDS.map((k) => notificationSpecOf(k)!).filter(
      (s) => s.module === mod,
    );
    if (specs.length === 0) continue;
    const familles: GroupeModule['familles'] = [];
    for (const s of specs) {
      let f = familles.find((x) => x.famille === s.family);
      if (!f) {
        f = { famille: s.family, label: NOTIFICATION_FAMILIES[s.family], specs: [] };
        familles.push(f);
      }
      f.specs.push(s);
    }
    out.push({ module: mod, label: NOTIFICATION_MODULE_LABELS[mod], familles });
  }
  return out;
}

/** Mode montré à l'écran (le choisi, sinon celui qui s'applique par défaut). */
export function modeAffiche(v: NotificationSettingsView): NotificationMode {
  return v.mode ?? v.effectiveMode;
}

/** Canaux effectifs d'un événement dans le mode affiché. */
export function canauxDe(
  v: NotificationSettingsView,
  spec: NotificationEventSpec,
  mode: NotificationMode = modeAffiche(v),
): NotificationChannelSet {
  return effectiveChannels({
    spec,
    mode,
    overrides: v.overrides[mode],
    mutedKinds: v.mutedKinds,
    mandatory: v.mandatory,
  });
}

/** Canal imposé par l'organisation (verrou affiché, interrupteur désactivé). */
export function estObligatoire(
  v: Pick<NotificationSettingsView, 'mandatory'>,
  kind: NotificationKind,
  canal: NotificationChannel,
): boolean {
  return v.mandatory.some((m) => m.kind === kind && m.channel === canal);
}

export type EtatCellule =
  | { etat: 'non_permis' }
  | { etat: 'obligatoire' }
  | { etat: 'indisponible'; raison: string }
  | { etat: 'reglable'; coche: boolean };

/**
 * État d'une cellule événement × canal : non permis (« — »), imposé, indisponible
 * (modèle WhatsApp en attente d'approbation) ou réglable. Slack non connecté et numéro non
 * vérifié restent réglables : le réglage vaudra dès que le canal sera prêt.
 */
export function etatCellule(
  v: NotificationSettingsView,
  spec: NotificationEventSpec,
  canal: NotificationChannel,
  canaux: NotificationChannelsView | null,
): EtatCellule {
  if (!spec.channels.includes(canal)) return { etat: 'non_permis' };
  if (estObligatoire(v, spec.kind, canal)) return { etat: 'obligatoire' };
  if (canal === 'whatsapp' && canaux && !canaux.whatsappKinds.includes(spec.kind)) {
    // Rien ne part tant que Meta n'a pas approuvé le modèle (journal : `template_unavailable`).
    return { etat: 'indisponible', raison: 'Modèle WhatsApp en attente d’approbation' };
  }
  return { etat: 'reglable', coche: canauxDe(v, spec)[canal] };
}

/**
 * Bascule un canal d'un événement dans le mode affiché. La surcharge est retirée si la
 * valeur rejoint le défaut du mode (le mode redevient « d'origine » de lui-même).
 */
export function basculer(
  v: NotificationSettingsView,
  spec: NotificationEventSpec,
  canal: NotificationChannel,
): NotificationSettingsView {
  const mode = modeAffiche(v);
  const voulu = !canauxDe(v, spec, mode)[canal];
  const base = defaultChannelsFor(spec, mode)[canal];
  const actuelles: NotificationModeOverrides = { ...v.overrides[mode] };
  const ligne = { ...(actuelles[spec.kind] ?? {}) };
  if (voulu === base) delete ligne[canal];
  else ligne[canal] = voulu;
  if (Object.keys(ligne).length === 0) delete actuelles[spec.kind];
  else actuelles[spec.kind] = ligne;
  return {
    ...v,
    overrides: { ...v.overrides, [mode]: actuelles },
    customized: { ...v.customized, [mode]: Object.keys(actuelles).length > 0 },
  };
}

/** « Revenir au mode d'origine » : vide les surcharges du mode affiché seulement. */
export function revenirOrigine(v: NotificationSettingsView): NotificationSettingsView {
  const mode = modeAffiche(v);
  return {
    ...v,
    overrides: { ...v.overrides, [mode]: {} },
    customized: { ...v.customized, [mode]: false },
  };
}

/** Choisir un mode (`null` : suivre le défaut de l'organisation). Rien n'est perdu. */
export function choisirMode(
  v: NotificationSettingsView,
  mode: NotificationMode | null,
): NotificationSettingsView {
  return { ...v, mode, ...(mode ? { effectiveMode: mode } : { effectiveMode: v.defaultMode }) };
}

/** Corps de `PUT /notifications/settings`. */
export function corpsReglages(v: NotificationSettingsView): PutNotificationSettingsBody {
  return {
    expectedRevision: v.revision,
    mode: v.mode,
    overrides: v.overrides,
    notifyOwnActions: v.notifyOwnActions,
    quietHours: v.quietHours,
  };
}

/** Résumé d'un module replié : « 12 actifs sur 18 ». */
export function resumeModule(v: NotificationSettingsView, g: GroupeModule): string {
  const specs = g.familles.flatMap((f) => f.specs);
  const actifs = specs.filter((s) => Object.values(canauxDe(v, s)).some(Boolean)).length;
  return `${actifs} actif${actifs > 1 ? 's' : ''} sur ${specs.length}`;
}

export const LIBELLES_CANAUX: Readonly<Record<NotificationChannel, string>> = {
  bell: 'Cloche',
  email: 'E-mail',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
};

export { NOTIFICATION_CHANNELS as CANAUX };

/** Libellé de l'état d'un canal (« Connecté », « Numéro non vérifié »…). */
export function libelleEtatCanal(c: NotificationChannelsView['channels'][number]): string {
  if (c.ready) return c.detail ? `Prêt — ${c.detail}` : 'Prêt';
  return c.reason ? NOTIFICATION_SKIP_REASON_LABELS[c.reason] : 'Indisponible';
}

/** Libellé d'un sort du journal d'envoi. */
export function libelleSort(
  status: NotificationDeliveryStatus,
  raison: NotificationSkipReason | null,
): string {
  const base = {
    sent: 'Envoyée',
    queued: 'En cours d’envoi',
    deferred: 'Différée (heures calmes)',
    skipped: 'Ignorée',
    failed: 'Échec',
  }[status];
  if (status === 'deferred') return base;
  if (!raison || raison === 'grouped') return raison === 'grouped' ? `${base} (regroupée)` : base;
  return `${base} — ${NOTIFICATION_SKIP_REASON_LABELS[raison]}`;
}

/** Libellé d'un type dans le journal (catalogue, sinon le test). */
export function libelleType(kind: string): string {
  if (kind === 'organization.notification_test') return 'Notification de test';
  return notificationSpecOf(kind)?.label ?? kind;
}

/** Heures (0 à 23) proposées pour les heures calmes. */
export const HEURES = Array.from({ length: 24 }, (_, h) => h);
export function libelleHeureCalme(h: number): string {
  return `${String(h).padStart(2, '0')} h`;
}
