// ─────────────────────────────────────────────────────────────────────────────
// Logique pure de l'espace admin plateforme (S21b — ADR-0012 §4, ADR-0013)
//
// Isolée du rendu pour être testable : `apps/web` n'a pas d'environnement DOM
// (vitest en `node`, cf. apps/web/vitest.config.ts). Tout ce qui décide vit ici,
// les `.tsx` ne font que l'assemblage.
//
// ── Ce que ce fichier ne fait pas ─────────────────────────────────────────────
//
// Il n'AUTORISE rien. Les drapeaux `canReadAdmin`, `canManagePlatform` et
// `canManageIntegrations` viennent du serveur, qui refuse de toute façon. Une
// divergence produit au pire un bouton en trop, jamais un droit en trop.
//
// Il ne manipule AUCUNE valeur de secret. Les seules données de secret qui
// entrent ici sont `configured`, `last4`, `updatedAt`, `updatedBy` et `source` —
// le contrat d'écriture seule d'ADR-0013 §4 ne fait circuler rien d'autre.
// ─────────────────────────────────────────────────────────────────────────────

import { PLAN_CATALOG, PLANS } from '@lalanda/shared/pricing';

import type {
  AdminUserSummary,
  IntegrationProvider,
  IntegrationSecretView,
  IntegrationView,
  PlatformAuditEventView,
  PlatformRole,
  Plan,
} from '@/lib/api';

// ── Navigation ───────────────────────────────────────────────────────────────

export const ADMIN_BASE = '/admin';

/**
 * Les cinq sections de l'espace, dans un ordre stable.
 *
 * `besoin` dit quel drapeau SERVEUR ouvre l'onglet — jamais un rôle recopié
 * côté client. `null` = visible dès qu'on est entré dans l'espace, ce qui est
 * déjà conditionné par `canReadAdmin`.
 */
export interface OngletAdmin {
  segment: string;
  label: string;
  besoin: 'canManagePlatform' | 'canManageIntegrations' | null;
}

export const ADMIN_TABS: readonly OngletAdmin[] = [
  { segment: '', label: 'Tableau de bord', besoin: null },
  { segment: 'organisations', label: 'Organisations', besoin: null },
  { segment: 'utilisateurs', label: 'Utilisateurs', besoin: null },
  { segment: 'integrations', label: 'Intégrations', besoin: 'canManageIntegrations' },
  { segment: 'journal', label: 'Journal', besoin: null },
] as const;

/**
 * Onglets à afficher.
 *
 * Filtrer est un CONFORT : `PermissionsGuard` refuse de toute façon, et l'onglet
 * Intégrations est le seul qu'on masque parce qu'il est le seul dont l'ouverture
 * révélerait quelque chose — la liste des fournisseurs branchés et l'état de
 * chacun. Les autres onglets se contentent d'un refus explicite à l'arrivée.
 */
export function ongletsVisibles(acces: {
  canManagePlatform: boolean;
  canManageIntegrations: boolean;
}): OngletAdmin[] {
  return ADMIN_TABS.filter((tab) => tab.besoin === null || acces[tab.besoin]);
}

/**
 * Segment actif déduit du chemin. `/admin` et `/admin/` donnent `''`.
 *
 * Comparaison sur le PREMIER segment seulement : une future sous-page
 * `/admin/organisations/xyz` doit garder l'onglet Organisations allumé.
 */
export function segmentActif(pathname: string): string {
  // Frontière de SEGMENT, pas simple préfixe : `/administration` commence par
  // `/admin` sans en faire partie, et un `startsWith` nu allumerait un onglet
  // depuis une page étrangère à l'espace.
  if (pathname !== ADMIN_BASE && !pathname.startsWith(`${ADMIN_BASE}/`)) return '';
  const reste = pathname.slice(ADMIN_BASE.length).replace(/^\/+/, '');
  return reste.split('/')[0] ?? '';
}

// ── Erreurs ──────────────────────────────────────────────────────────────────

/**
 * Traductions des refus de l'API d'administration.
 *
 * Le `message` du serveur est correct mais technique; ces phrases disent ce
 * qu'il faut FAIRE. Un code inconnu retombe sur le message brut plutôt que sur
 * un « une erreur est survenue » qui n'aide personne.
 */
const MESSAGES: Record<string, string> = {
  // ── Ré-authentification et coffre (ADR-0013 §5, §8) ──
  REAUTH_REQUIRED:
    'Confirmez votre mot de passe pour ouvrir une fenêtre de dix minutes avant de modifier un secret.',
  INTEGRATION_TEST_FAILED:
    'Le test de connexion a échoué : rien n’a été enregistré. Vérifiez la valeur, ou forcez l’enregistrement si le test ne peut pas aboutir depuis ce serveur.',
  VAULT_UNAVAILABLE:
    'Le coffre est indisponible : SECRETS_MASTER_KEY est absente de l’environnement du serveur. Aucun secret ne peut être chiffré.',
  SECRET_KEY_UNAVAILABLE:
    'Un secret ne peut plus être déchiffré : la clé maîtresse qui l’a chiffré n’est plus disponible. Re-saisissez-le, ou terminez la rotation en cours.',
  UNKNOWN_FIELD:
    'Champ refusé : il ne figure pas dans la liste blanche du fournisseur. Un secret ne peut pas être rangé dans la configuration — il y serait stocké en clair.',
  UNKNOWN_PROVIDER: 'Ce fournisseur n’existe pas.',

  // ── Gouvernance plateforme (ADR-0012 §4) ──
  SELF_DEMOTION_FORBIDDEN:
    'Un super-administrateur ne peut pas se retirer son propre rôle : un autre super-administrateur doit le faire.',
  SELF_DISABLE_FORBIDDEN: 'Vous ne pouvez pas désactiver votre propre compte.',
  UNKNOWN_ROLE: 'Ce rôle plateforme n’existe pas.',
  UNKNOWN_PLAN: 'Ce plan n’existe pas.',
  INVALID_DATE: 'La date d’expiration est invalide.',
  USER_NOT_FOUND: 'Ce compte n’existe plus.',
  ORG_NOT_FOUND: 'Cette organisation n’existe plus.',

  // ── Communs ──
  FORBIDDEN: 'Votre rôle plateforme ne permet pas cette action.',
  VALIDATION_ERROR: 'La saisie est invalide.',
};

/** Code métier porté par une erreur d'`api.ts`, s'il y en a un. */
export function codeErreur(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || !('detail' in err)) return null;
  const detail = (err as { detail: unknown }).detail;
  if (typeof detail !== 'object' || detail === null || !('code' in detail)) return null;
  const code = (detail as { code: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** Statut HTTP d'une erreur d'`api.ts`, s'il y en a un. */
export function statutErreur(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('status' in err)) return null;
  const status = (err as { status: unknown }).status;
  return typeof status === 'number' ? status : null;
}

export function messageErreur(err: unknown, repli: string): string {
  const code = codeErreur(err);
  if (code && MESSAGES[code]) return MESSAGES[code]!;
  if (statutErreur(err) === 429) {
    // Quota dédié d'ADR-0013 §5 : dix écritures par heure et par utilisateur.
    return 'Trop d’écritures sur les intégrations : dix par heure et par utilisateur. Réessayez plus tard.';
  }
  return err instanceof Error && err.message !== '' ? err.message : repli;
}

/** L'erreur exige-t-elle une ré-authentification ? Déclenche l'ouverture du dialogue. */
export function exigeReauth(err: unknown): boolean {
  return codeErreur(err) === 'REAUTH_REQUIRED';
}

/**
 * L'erreur est-elle un échec de test de connexion ? Le formulaire propose alors
 * la dérogation `?force=true` — et seulement dans ce cas.
 *
 * Proposer « forcer » systématiquement ferait du contournement le geste normal,
 * ce qui viderait le contrôle de sa substance.
 */
export function offreDerogation(err: unknown): boolean {
  return codeErreur(err) === 'INTEGRATION_TEST_FAILED';
}

// ── État d'une intégration ───────────────────────────────────────────────────

export type TonStatut = 'neutre' | 'attention' | 'succes' | 'echec';

export interface StatutIntegration {
  cle: 'non_configuree' | 'incomplete' | 'prete' | 'active' | 'en_echec';
  label: string;
  /** Renfort visuel UNIQUEMENT — le libellé porte déjà toute l'information. */
  ton: TonStatut;
  explication: string;
}

/**
 * Les secrets requis qui manquent encore.
 *
 * `configured` est vrai dès qu'une source existe — base OU variable
 * d'environnement de secours (ADR-0013 option C). Une intégration servie par
 * l'environnement n'est donc pas signalée « incomplète » : elle fonctionne. La
 * colonne « Source » est ce qui dit d'où elle vient.
 */
export function secretsManquants(view: IntegrationView): string[] {
  return view.requiredSecrets.filter((nom) => !view.secrets[nom]?.configured);
}

/**
 * État affiché d'une intégration. Cinq états et pas deux : « configurée » et
 * « qui marche » sont deux questions distinctes, et les confondre ferait
 * apparaître comme opérationnelle une intégration dont la dernière vérification
 * a échoué.
 */
export function statutIntegration(view: IntegrationView): StatutIntegration {
  const manquants = secretsManquants(view);

  if (manquants.length === view.requiredSecrets.length && manquants.length > 0) {
    return {
      cle: 'non_configuree',
      label: 'Non configurée',
      ton: 'neutre',
      explication: 'Aucun secret enregistré. L’intégration n’est pas utilisable.',
    };
  }
  if (manquants.length > 0) {
    return {
      cle: 'incomplete',
      label: 'Incomplète',
      ton: 'attention',
      explication: `Secret requis manquant : ${manquants.join(', ')}.`,
    };
  }
  if (view.lastTest?.status === 'failed') {
    return {
      cle: 'en_echec',
      label: 'Dernier test en échec',
      ton: 'echec',
      explication: view.lastTest.forced
        ? 'Enregistrée par dérogation, sans test concluant.'
        : 'Les identifiants ont été refusés lors du dernier test.',
    };
  }
  if (!view.enabled) {
    return {
      cle: 'prete',
      label: 'Configurée, inactive',
      ton: 'attention',
      explication: 'Les secrets sont en place mais l’intégration n’est pas activée.',
    };
  }
  return {
    cle: 'active',
    label: 'Active',
    ton: 'succes',
    explication: 'Secrets en place, intégration activée.',
  };
}

/**
 * Empreinte affichable d'un secret — « •••• 1234 », jamais davantage.
 *
 * Les points ne représentent pas la longueur réelle : l'afficher renseignerait
 * sur le format de la clé. `last4` vaut `null` sous douze caractères
 * (ADR-0013 §4), et l'interface dit alors « enregistré » sans fragment.
 */
export function empreinteSecret(secret: IntegrationSecretView | undefined): string {
  if (!secret?.configured) return 'Non configuré';
  if (secret.last4 === null) return 'Enregistré (valeur trop courte pour un indice)';
  return `•••• ${secret.last4}`;
}

/** D'où vient la valeur réellement utilisée par le serveur (ADR-0013 option C). */
export function libelleSource(source: IntegrationSecretView['source']): string {
  if (source === 'db') return 'Coffre chiffré';
  if (source === 'env') return 'Variable d’environnement';
  return '—';
}

/**
 * La source `env` est un RESTE de migration, pas un état normal.
 *
 * ADR-0013 §8 : `OPENAI_API_KEY` et les `S3_*` sont « transitoires », à retirer
 * au sprint de sortie. L'interface le dit, sans quoi la transition devient
 * l'hybride permanent que l'ADR rejette explicitement.
 */
export function avertissementSource(secret: IntegrationSecretView | undefined): string | null {
  if (secret?.source !== 'env') return null;
  return 'Cette valeur vient encore de l’environnement du serveur. Enregistrez-la ici pour qu’elle devienne rotable sans redéploiement.';
}

export interface ResumeTest {
  libelle: string;
  ton: TonStatut;
  detail: string | null;
}

/** Résumé du dernier test de connexion — « jamais testée » est une information. */
export function resumeDernierTest(view: IntegrationView): ResumeTest {
  if (!view.lastTest) {
    return {
      libelle: 'Jamais testée',
      ton: 'neutre',
      detail: null,
    };
  }
  const quand = formaterDateHeure(view.lastTest.at);
  if (view.lastTest.status === 'ok') {
    return { libelle: `Réussi le ${quand}`, ton: 'succes', detail: view.lastTest.detail || null };
  }
  return {
    libelle: view.lastTest.forced ? `Échoué le ${quand} — forcé` : `Échoué le ${quand}`,
    ton: 'echec',
    detail: view.lastTest.detail || null,
  };
}

// ── Libellés de champs ───────────────────────────────────────────────────────

/**
 * Libellés français des champs de configuration et de secret.
 *
 * Purement présentationnel : la SOURCE DE VÉRITÉ des noms reste
 * `apps/api/src/integrations/providers.ts`, et c'est le serveur qui refuse tout
 * champ hors liste blanche. Un libellé manquant ici retombe sur le nom technique
 * plutôt que de masquer le champ — l'opératrice doit pouvoir saisir un champ que
 * l'API accepte, même si personne n'a pensé à le traduire.
 */
const LIBELLES_CHAMPS: Record<string, string> = {
  // OpenAI
  apiKey: 'Clé d’API',
  modelReasoning: 'Modèle de raisonnement',
  modelLite: 'Modèle léger',
  baseUrl: 'URL de base',
  organization: 'Organisation OpenAI',
  // Stripe
  restrictedKey: 'Clé restreinte (rk_…)',
  webhookSecret: 'Secret de signature des webhooks',
  publishableKey: 'Clé publiable (pk_…)',
  webhookEndpoint: 'Point de terminaison des webhooks',
  accountCountry: 'Pays du compte',
  // PayPal
  clientSecret: 'Secret client',
  clientId: 'Identifiant client',
  environment: 'Environnement (sandbox / live)',
  // SMTP
  password: 'Mot de passe',
  host: 'Hôte',
  port: 'Port',
  secure: 'Connexion chiffrée (TLS implicite)',
  user: 'Identifiant',
  fromAddress: 'Adresse expéditrice',
  fromName: 'Nom expéditeur',
  // S3 / Spaces
  secretKey: 'Clé secrète',
  endpoint: 'Point de terminaison',
  region: 'Région',
  accessKey: 'Clé d’accès (identifiant)',
  bucketExports: 'Bucket des exports',
  bucketSnapshots: 'Bucket des instantanés',
  bucketUploads: 'Bucket des téléversements',
  forcePathStyle: 'Forcer le style de chemin',
};

export function libelleChamp(nom: string): string {
  return LIBELLES_CHAMPS[nom] ?? nom;
}

/**
 * Aides affichées sous les champs sensibles, quand l'ADR a un avis.
 *
 * Le cas Stripe est le seul qui change la nature d'un incident : une clé
 * restreinte fuitée est une violation de confidentialité, une clé secrète
 * complète fuitée est un détournement de trésorerie (ADR-0013 §7).
 */
const AIDES_CHAMPS: Partial<Record<IntegrationProvider, Record<string, string>>> = {
  stripe: {
    restrictedKey:
      'Utilisez une clé RESTREINTE (rk_…), pas la clé secrète complète (sk_…). Sans droit sur Payouts, Balance, Transfers ni Connect : une fuite devient un incident de confidentialité au lieu d’un détournement de fonds.',
    webhookSecret: 'Vérifié à chaque webhook reçu — sans lui, un webhook peut être falsifié.',
    publishableKey: 'Publique par conception : stockée en clair, jamais chiffrée.',
  },
  r2: {
    accessKey: 'Identifiant, pas un secret : stocké en clair, comme un nom d’utilisateur.',
    endpoint:
      'Point d’accès Cloudflare R2 : https://<ID_DE_COMPTE>.r2.cloudflarestorage.com. La région n’existe pas chez R2 — la signature emploie le littéral « auto ».',
  },
  elevenlabs: {
    apiKey:
      'Sert à l’assistant vocal. Le test de connexion ne fait que LIRE la liste des voix : aucune synthèse n’est déclenchée, donc aucun coût.',
  },
  zeptomail: {
    sendMailToken:
      'Send Mail Token du Mail Agent Zoho — pas la clé d’API du compte. Le domaine expéditeur doit être vérifié côté Zoho, sinon l’API refuse l’envoi.',
    apiUrl: 'À changer seulement pour un compte régional (.eu, .in). Par défaut api.zeptomail.com.',
  },
  paypal: {
    clientId: 'Identifiant public de l’application, stocké en clair.',
  },
  smtp: {
    user: 'Identifiant du compte d’envoi, stocké en clair.',
  },
};

export function aideChamp(provider: IntegrationProvider, nom: string): string | null {
  return AIDES_CHAMPS[provider]?.[nom] ?? null;
}

// ── Ré-authentification ──────────────────────────────────────────────────────

/** Millisecondes restantes avant la fin de la fenêtre — 0 si elle est close. */
export function reauthRestantMs(expiresAt: string | null, maintenant: number = Date.now()): number {
  if (!expiresAt) return 0;
  const fin = Date.parse(expiresAt);
  if (Number.isNaN(fin)) return 0;
  return Math.max(fin - maintenant, 0);
}

/**
 * La fenêtre est-elle utilisable ?
 *
 * Une marge de 15 secondes est retranchée : une fenêtre qui expire pendant que
 * l'opératrice tape sa clé produirait un 401 après la saisie, c'est-à-dire au
 * pire moment. Mieux vaut redemander le mot de passe un peu tôt.
 */
export const MARGE_REAUTH_MS = 15_000;

export function reauthUtilisable(
  expiresAt: string | null,
  maintenant: number = Date.now(),
): boolean {
  return reauthRestantMs(expiresAt, maintenant) > MARGE_REAUTH_MS;
}

/** « 7 min » / « 45 s » — pour l'indicateur de fenêtre ouverte. */
export function formaterRestant(ms: number): string {
  if (ms <= 0) return 'expirée';
  const secondes = Math.ceil(ms / 1000);
  if (secondes < 60) return `${secondes} s`;
  return `${Math.ceil(secondes / 60)} min`;
}

// ── Dates ────────────────────────────────────────────────────────────────────

/** `null`, chaîne vide ou date invalide → tiret. Jamais « Invalid Date » à l'écran. */
export function formaterDateHeure(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formaterDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ── Organisations et comptes ─────────────────────────────────────────────────

/**
 * Libellés d'offre de la console — dérivés du catalogue.
 *
 * La table s'arrêtait à trois offres : une organisation `cabinet` s'affichait
 * `undefined` dans la console d'administration, c'est-à-dire exactement là où on
 * regarde pour savoir qui paie quoi. Seul `free` garde un libellé propre à la
 * console (« Gratuit » plutôt que « Free »), le reste vient du catalogue.
 */
export const LIBELLES_PLAN: Record<Plan, string> = Object.freeze(
  Object.fromEntries(
    PLANS.map((p) => [p, p === 'free' ? 'Gratuit' : PLAN_CATALOG[p].name]),
  ) as Record<Plan, string>,
);

/**
 * Libellés français des six rôles plateforme.
 *
 * Purement présentationnel, comme `LIBELLES_CHAMPS` : la source de vérité reste
 * `apps/api/src/authz/permissions.ts`, et les vues servies par l'API portent
 * déjà leur propre `label`. Cette table ne sert qu'aux rôles qu'on peut
 * ATTRIBUER — donc à ceux que l'utilisateur ne détient pas encore, et dont
 * aucune vue ne porte le libellé. Un rôle inconnu retombe sur sa clé technique.
 */
const LIBELLES_ROLES: Record<PlatformRole, string> = {
  platform_super_admin: 'Super-administrateur de plateforme',
  platform_admin: 'Administrateur de plateforme',
  platform_support: 'Support',
  platform_billing: 'Facturation',
  platform_template_editor: 'Éditeur de modèles',
  platform_country_pack_manager: 'Gestionnaire de packs pays',
};

export function libelleRole(role: string): string {
  return LIBELLES_ROLES[role as PlatformRole] ?? role;
}

/** Longueur minimale du motif de suspension — l'API refuse en deçà. */
export const MOTIF_SUSPENSION_MIN = 10;

export function motifSuspensionValide(motif: string): boolean {
  return motif.trim().length >= MOTIF_SUSPENSION_MIN;
}

/**
 * Pourquoi ce compte n'est-il pas désactivable ? `null` s'il l'est.
 *
 * Rendu À CÔTÉ du contrôle désactivé, jamais à la place : une commande absente
 * n'explique rien.
 */
export function raisonNonDesactivable(
  user: AdminUserSummary,
  moiUserId: string | null,
): string | null {
  if (moiUserId && user.id === moiUserId) {
    return 'Vous ne pouvez pas désactiver votre propre compte.';
  }
  return null;
}

/** Pourquoi ce rôle plateforme n'est-il pas révocable ? `null` s'il l'est. */
export function raisonNonRevocable(
  user: AdminUserSummary,
  role: PlatformRole,
  moiUserId: string | null,
): string | null {
  if (moiUserId && user.id === moiUserId && role === 'platform_super_admin') {
    return 'Un autre super-administrateur doit vous retirer ce rôle : la plateforme ne peut pas rester sans aucun.';
  }
  return null;
}

/**
 * Une désactivation déconnecte mais NE VERROUILLE PAS la reconnexion.
 *
 * Limite connue et documentée (`admin.service.ts`, docs/17 § S21b). L'interface
 * doit le dire : un opérateur qui croit avoir barré l'accès alors qu'il n'a que
 * déconnecté prend une décision de sécurité sur une prémisse fausse.
 */
export const AVERTISSEMENT_DESACTIVATION =
  'La désactivation révoque immédiatement toutes les sessions du compte, mais n’empêche pas encore la reconnexion. Le verrou au moment de la connexion reste à livrer.';

// ── Journal d'audit ──────────────────────────────────────────────────────────

/**
 * Libellés des actions du journal plateforme.
 *
 * Un code brut (`integration.secret.updated`) est lisible par qui l'a écrit et
 * par personne d'autre. Le journal n'a de valeur que s'il se lit en
 * investigation, sous pression.
 */
const LIBELLES_ACTIONS: Record<string, string> = {
  'integration.secret.updated': 'Secret d’intégration remplacé',
  'integration.secret.deleted': 'Secret d’intégration supprimé',
  'integration.tested': 'Test de connexion exécuté',
  'integration.config.updated': 'Configuration d’intégration modifiée',
  'integration.enabled': 'Intégration activée',
  'integration.disabled': 'Intégration désactivée',
  'secret.rewrapped': 'Secret re-chiffré (rotation de clé)',
  'organization.plan_changed': 'Plan d’organisation modifié',
  'organization.suspended': 'Organisation suspendue',
  'organization.suspension_lifted': 'Suspension levée',
  'platform_role.granted': 'Rôle plateforme attribué',
  'platform_role.revoked': 'Rôle plateforme retiré',
  'user.disabled': 'Compte désactivé',
  'user.enabled': 'Compte réactivé',
};

export function libelleAction(action: string): string {
  return LIBELLES_ACTIONS[action] ?? action;
}

/** Les actions proposées au filtre du journal, dans un ordre stable. */
export const ACTIONS_FILTRABLES = Object.keys(LIBELLES_ACTIONS);

/**
 * Métadonnées d'un événement, mises en forme.
 *
 * Les clés `ip` et `userAgent` sont écartées de la ligne principale : elles sont
 * longues, presque toujours identiques, et noieraient `last4Before` /
 * `last4After` — les seuls champs qui répondent à « quelle clé a été remplacée
 * par quelle autre ? ».
 */
export function metadonneesLisibles(
  event: PlatformAuditEventView,
): Array<{ cle: string; valeur: string }> {
  const CACHEES = new Set(['ip', 'userAgent']);
  return Object.entries(event.metadata ?? {})
    .filter(([cle, valeur]) => !CACHEES.has(cle) && valeur !== null && valeur !== '')
    .map(([cle, valeur]) => ({ cle: libelleMetadonnee(cle), valeur: String(valeur) }));
}

const LIBELLES_METADONNEES: Record<string, string> = {
  last4Before: 'Ancien suffixe',
  last4After: 'Nouveau suffixe',
  secretName: 'Secret',
  result: 'Résultat',
  forced: 'Dérogation',
  keys: 'Champs',
  role: 'Rôle',
  reason: 'Motif',
  from: 'Avant',
  to: 'Après',
  revokedSessions: 'Sessions révoquées',
  expiresAt: 'Expire le',
};

export function libelleMetadonnee(cle: string): string {
  return LIBELLES_METADONNEES[cle] ?? cle;
}
