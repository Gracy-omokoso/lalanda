// Logique pure de l'espace compte (S20b).
//
// Isolée du rendu pour être testable : `apps/web` n'a pas d'environnement DOM
// (vitest en `node`, cf. apps/web/vitest.config.ts), donc tout ce qui mérite un
// test vit ici et les `.tsx` restent de l'assemblage.

/** Langues réellement servies. Doit refléter SUPPORTED_LOCALES côté API. */
export const LOCALE_LABELS: Record<string, string> = {
  fr: 'Français',
};

export const THEME_LABELS: Record<string, string> = {
  system: 'Selon le système',
  light: 'Clair',
  dark: 'Sombre',
};

export const THEME_DESCRIPTIONS: Record<string, string> = {
  system: 'Suit le réglage clair/sombre de votre appareil.',
  light: 'Papier registre, encre foncée.',
  dark: 'Fond encre, texte crème.',
};

// La mécanique du thème (résolution, application, stockage local) vit dans
// `@/lib/theme` : elle est partagée avec le bascule du header et la
// synchronisation au chargement, hors de l'espace compte.

/** Devises d'affichage. Même énumération que `projects.dto.ts` côté API. */
export const CURRENCY_LABELS: Record<string, string> = {
  USD: 'USD — dollar américain',
  CDF: 'CDF — franc congolais',
  XOF: 'XOF — franc CFA (UEMOA)',
  XAF: 'XAF — franc CFA (CEMAC)',
  EUR: 'EUR — euro',
};

export const NOTIFICATION_LABELS: Record<string, { label: string; description: string }> = {
  securite: {
    label: 'Alertes de sécurité',
    description: 'Connexion depuis un nouvel appareil, changement de mot de passe.',
  },
  produit: {
    label: 'Nouveautés produit',
    description: 'Nouvelles fonctionnalités et évolutions importantes.',
  },
  projet: {
    label: 'Activité des projets',
    description: 'Plans validés, périodes clôturées, invitations acceptées.',
  },
  resumeHebdomadaire: {
    label: 'Résumé hebdomadaire',
    description: 'Un récapitulatif par semaine de l’activité de vos projets.',
  },
};

/**
 * Fuseaux proposés par défaut.
 *
 * Liste COURTE et délibérément orientée sur les pays servis (docs/09 —
 * Country Packs, RDC en premier). `Intl.supportedValuesOf('timeZone')` en
 * renverrait plus de 400 : un menu déroulant illisible pour un réglage que la
 * plupart des utilisateurs ne changeront jamais. Le fuseau détecté par le
 * navigateur et le fuseau déjà enregistré sont ajoutés à la volée par
 * `timezoneOptions`, si bien qu'aucun choix existant n'est jamais perdu ni
 * silencieusement réécrit.
 */
export const COMMON_TIMEZONES = [
  'Africa/Kinshasa',
  'Africa/Lubumbashi',
  'Africa/Abidjan',
  'Africa/Dakar',
  'Africa/Douala',
  'Africa/Lagos',
  'Africa/Casablanca',
  'Africa/Tunis',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'Europe/Paris',
  'Europe/Brussels',
  'Europe/London',
  'America/Montreal',
  'America/New_York',
  'UTC',
] as const;

/**
 * Options du sélecteur de fuseau : la liste courte, plus le fuseau courant et
 * celui détecté par le navigateur s'ils en sortent. Sans cette fusion, ouvrir la
 * page suffirait à remplacer un fuseau exotique déjà enregistré par le premier
 * de la liste — une modification que l'utilisateur n'a pas demandée.
 *
 * Le résultat est dédoublonné et l'ordre de la liste de référence est conservé,
 * les ajouts venant ensuite.
 */
export function timezoneOptions(current?: string | null, detected?: string | null): string[] {
  const options = [...COMMON_TIMEZONES] as string[];
  for (const extra of [current, detected]) {
    const value = extra?.trim();
    if (value && !options.includes(value)) options.push(value);
  }
  return options;
}

/** Fuseau du navigateur, ou `null` côté serveur / si l'API échoue. */
export function detectTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Décalage lisible d'un fuseau (« UTC+01:00 »), pour que l'utilisateur choisisse
 * sans connaître la nomenclature IANA. Renvoie `null` si le fuseau est inconnu —
 * l'appelant affiche alors le seul identifiant, plutôt qu'un décalage inventé.
 */
export function timezoneOffsetLabel(timezone: string, at: Date = new Date()): string | null {
  try {
    const formatted = new Intl.DateTimeFormat('fr-FR', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    }).format(at);
    const match = formatted.match(/(UTC[+−-]\d{2}:\d{2}|UTC)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Date absolue et lisible d'une session.
 *
 * Volontairement PAS de « il y a 3 heures » : docs/04 § Conventions impose que
 * les dates s'affichent dans un fuseau explicite. Sur un écran de sécurité, une
 * date exacte est ce qui permet de reconnaître — ou non — une connexion.
 */
export function formatSessionDate(iso: string, timezone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(date);
  } catch {
    // Fuseau invalide enregistré en base : on dégrade sur le fuseau local plutôt
    // que de casser l'écran de sécurité.
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }
}

/**
 * Le formulaire de profil a-t-il divergé des valeurs enregistrées ?
 * Sert à n'activer « Enregistrer » que s'il y a réellement quelque chose à écrire.
 */
export function profileIsDirty(
  form: { name: string; locale: string; timezone: string },
  saved: { name: string; locale: string; timezone: string },
): boolean {
  return (
    form.name.trim() !== saved.name.trim() ||
    form.locale !== saved.locale ||
    form.timezone !== saved.timezone
  );
}

/**
 * Volet « préférences » : thème, devise d'affichage, notifications.
 *
 * `notifications` est laissé générique — l'interface `NotificationPreferences`
 * du client d'API n'a pas de signature d'index, et la contraindre ici obligerait
 * à la dupliquer.
 */
export interface PreferencesForm<N extends object = Record<string, boolean>> {
  theme: string;
  displayCurrency: string;
  notifications: N;
}

/**
 * Le formulaire de préférences a-t-il divergé des valeurs enregistrées ?
 *
 * La comparaison des notifications se fait clé par clé sur l'UNION des deux
 * ensembles : une comparaison basée sur les seules clés du formulaire déclarerait
 * « rien à enregistrer » si l'API venait à servir une catégorie que l'UI ne
 * connaît pas encore — le bouton « Enregistrer » resterait alors grisé sans
 * raison visible.
 */
export function preferencesAreDirty<N extends object>(
  form: PreferencesForm<N>,
  saved: PreferencesForm<N>,
): boolean {
  if (form.theme !== saved.theme) return true;
  if (form.displayCurrency !== saved.displayCurrency) return true;
  const a = form.notifications as Record<string, boolean | undefined>;
  const b = saved.notifications as Record<string, boolean | undefined>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return true;
  }
  return false;
}

/** Message d'erreur d'un champ nom, ou `null` s'il est valide. */
export function validateName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Le nom ne peut pas être vide.';
  if (trimmed.length > 120) return 'Le nom ne peut pas dépasser 120 caractères.';
  return null;
}

/**
 * Message d'erreur d'un champ email, ou `null`.
 * Contrôle volontairement permissif — l'API valide pour de bon ; ici on ne fait
 * qu'éviter un aller-retour réseau sur une saisie manifestement incomplète.
 */
export function validateEmail(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'L’adresse email est obligatoire.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'Adresse email invalide.';
  return null;
}

/** Traduit un code d'erreur de l'API en message affichable. */
export function accountErrorMessage(
  detail: { code?: string; message?: string } | undefined,
  fallback: string,
): string {
  switch (detail?.code) {
    case 'INVALID_PASSWORD':
      return 'Mot de passe incorrect.';
    case 'EMAIL_TAKEN':
      return 'Cette adresse est déjà utilisée par un autre compte.';
    case 'EMAIL_UNCHANGED':
      return 'Cette adresse est déjà celle de votre compte.';
    case 'EMAIL_MISMATCH':
      return 'L’adresse saisie ne correspond pas à celle de votre compte.';
    case 'SESSION_NOT_FOUND':
      return 'Cette session n’existe plus.';
    case 'INVALID_REQUEST':
      return 'Certaines valeurs sont invalides. Vérifiez le formulaire.';
    default:
      return detail?.message ?? fallback;
  }
}
