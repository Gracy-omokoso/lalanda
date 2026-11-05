// Notifications des Projets par Slack — ADR-0064.
//
// UNE application Slack « Lalanda » (distribuée), que CHAQUE organisation installe
// dans SON espace Slack (OAuth « Ajouter à Slack »). Ce fichier porte les contrats
// échangés entre l'API et l'écran : état de la connexion de l'organisation, canaux
// proposés, canal d'un projet. Jamais de jeton : le jeton du bot reste chiffré dans le
// coffre de l'organisation et ne sort d'aucune route.

import { z } from 'zod';

/**
 * Portées (« scopes ») demandées à l'installation — le minimum utile :
 * `chat:write` (écrire), `chat:write.public` (publier dans un canal public sans y être
 * invité), `users:read` + `users:read.email` (retrouver un membre par son adresse),
 * `im:write` (ouvrir un message privé), `channels:read` (proposer la liste des canaux
 * publics). Recopiées à l'identique dans `docs/integrations/slack-app-manifest.yml`.
 */
export const SLACK_BOT_SCOPES = [
  'chat:write',
  'chat:write.public',
  'users:read',
  'users:read.email',
  'im:write',
  'channels:read',
] as const;

/**
 * État de la connexion d'une organisation.
 * - `active` : le bot envoie ;
 * - `reconnect_required` : Slack a refusé le jeton (`token_revoked`, `account_inactive`,
 *   `invalid_auth`) ou l'a annoncé révoqué (`tokens_revoked`) — plus aucun envoi ;
 * - `uninstalled` : l'application a été retirée de l'espace Slack (`app_uninstalled`).
 */
export const SLACK_CONNECTION_STATUSES = ['active', 'reconnect_required', 'uninstalled'] as const;
export type SlackConnectionStatus = (typeof SLACK_CONNECTION_STATUSES)[number];

/** `GET /work/slack` — ce que l'écran a besoin de savoir, et rien de plus. */
export interface SlackConnectionView {
  /**
   * L'application Slack de la plateforme est-elle configurée et allumée (identifiants
   * saisis dans `/admin`, intégration activée, `SLACK_ENABLED` non coupé) ? Faux : le
   * bouton « Connecter Slack » explique que Slack n'est pas encore disponible.
   */
  available: boolean;
  /** Vrai quand l'organisation a une connexion (même à reconnecter). */
  connected: boolean;
  status: SlackConnectionStatus | null;
  /** Nom de l'espace Slack connecté (équipe). */
  teamName: string | null;
  connectedBy: { userId: string; name: string } | null;
  connectedAt: string | null;
  /** Compteurs d'envoi depuis la connexion (diagnostic, jamais de contenu). */
  stats: { sent: number; unmatched: number; failed: number } | null;
  /** L'appelant peut connecter / déconnecter (`organization.manage`). */
  canManage: boolean;
}

/** `POST /work/slack/connect` — adresse d'autorisation Slack vers laquelle rediriger. */
export interface SlackConnectStart {
  authorizeUrl: string;
}

/** Canal public proposé (`conversations.list`). */
export interface SlackChannelOption {
  id: string;
  name: string;
}

/**
 * Identifiant de canal PUBLIC Slack (`C…`). Les canaux privés (`G…`) et les messages
 * privés (`D…`) sont refusés : un projet publie dans un canal visible, choisi en
 * connaissance de cause.
 */
export const SlackChannelId = z
  .string({ error: 'Identifiant de canal attendu.' })
  .trim()
  .regex(/^C[A-Z0-9]{6,20}$/, {
    message: 'Identifiant de canal public Slack attendu (commence par « C »).',
  });

/** `PUT /work/projects/:projectId/slack-channel` — `null` retire le canal. */
export const PutWorkProjectSlackChannelBody = z
  .object({
    channelId: SlackChannelId.nullable(),
    /** Nom affiché (sans « # »), facultatif : repris de la liste quand il est connu. */
    channelName: z
      .string()
      .trim()
      .max(80, { message: '80 caractères au plus.' })
      .regex(/^[^<>&]*$/, { message: 'Caractères < > & refusés.' })
      .optional(),
    /**
     * Projet PRIVÉ : confirmation explicite que tout le canal verra les événements du
     * projet. Sans elle, `400 SLACK_PRIVATE_PROJECT_CONFIRMATION_REQUIRED`.
     */
    confirmPrivate: z.boolean().optional(),
  })
  .strict();
export type PutWorkProjectSlackChannelBody = z.output<typeof PutWorkProjectSlackChannelBody>;

/** `GET|PUT /work/projects/:projectId/slack-channel`. */
export interface WorkProjectSlackChannelView {
  /** L'organisation a une connexion Slack active. */
  connected: boolean;
  projectPrivate: boolean;
  channel: {
    id: string;
    name: string | null;
    /** Publication confirmée pour un projet privé. */
    privateConfirmed: boolean;
    setAt: string;
  } | null;
  /**
   * Le canal reçoit-il réellement les événements ? Faux si le projet est devenu privé
   * sans confirmation, ou si la connexion n'est pas active.
   */
  publishing: boolean;
  canManage: boolean;
}
