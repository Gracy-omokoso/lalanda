// Connexion d'une organisation à SON espace Slack — ADR-0064 § 1, § 2, § 6 et § 8.
//
// ── Ce que ce service garantit ────────────────────────────────────────────────
//
// 1. ISOLATION. Toute méthode prend l'organisation de l'APPELANT (jamais un
//    identifiant reçu) : l'organisation B ne lit, n'utilise ni ne déconnecte la
//    connexion de A. Le jeton du bot est rangé dans le coffre d'organisation (nature
//    `slack_bot_token`, AAD liée à l'organisation) : recopié vers B, il ne se
//    déchiffre pas.
// 2. AUCUN JETON EN SORTIE. Ni vue, ni journal, ni audit ne porte le jeton : il ne
//    quitte le coffre que vers `SlackApi`, en mémoire, le temps d'un appel.
// 3. INTERRUPTEUR (ADR-0017). Sans identifiants de l'application dans `/admin`,
//    intégration désactivée, ou `SLACK_ENABLED=false` : `available` est faux, aucune
//    connexion ne démarre et AUCUN message ne part — y compris pour les organisations
//    déjà connectées.
// 4. ESPACE PARTAGÉ. Deux organisations peuvent installer l'application dans le MÊME
//    espace Slack ; Slack leur remet alors le même jeton de bot. Déconnecter A ne
//    révoque donc ce jeton chez Slack que si aucune autre organisation n'en a une
//    connexion active — sinon A détruit seulement sa copie (A ne casse jamais B).

import { can, type OrgPermissionContext } from '../authz/permissions.js';
import type {
  SlackChannelOption,
  SlackConnectStart,
  SlackConnectionStatus,
  SlackConnectionView,
} from '@lalanda/shared/work';
import { SLACK_BOT_SCOPES } from '@lalanda/shared/work';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import type { Connection, Model } from 'mongoose';

import { getAuth } from '../auth/auth.js';
import { isAccountBlocked } from '../auth/auth.guard.js';
import { AuditService } from '../authz/audit.service.js';
import { AuthzService } from '../authz/authz.service.js';
import {
  ORGANIZATION_SECRETS,
  VaultUnavailableError,
  type OrganizationSecretRef,
  type OrganizationSecretsPort,
} from '../integrations/organization-secrets.port.js';
import { SecretsService } from '../integrations/secrets.service.js';
import { apiUrl, webUrl } from '../mail/mail.links.js';
import { MembersService } from '../organizations/members.service.js';
import { SlackApi, SlackApiError } from './slack-api.js';
import { signSlackState, verifySlackSignature, verifySlackState } from './slack-security.js';
import {
  SlackConnection,
  SlackProjectChannel,
  SlackUserLink,
  type SlackConnectionDocument,
  type SlackConnectionLean,
  type SlackProjectChannelDocument,
  type SlackUserLinkDocument,
} from './slack.schemas.js';

/** `SLACK_ENABLED` : allumé par défaut ; seule la valeur `false` coupe tout (lu à chaque appel). */
export function slackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['SLACK_ENABLED']?.trim().toLowerCase() !== 'false';
}

/** Adresse de retour OAuth — à déclarer telle quelle dans l'application Slack. */
export function slackRedirectUri(): string {
  return `${apiUrl()}/slack/oauth/callback`;
}

/** Page de l'écran où revient la dirigeante après l'aller-retour Slack. */
export function slackSettingsUrl(result: string): string {
  return `${webUrl()}/projets/parametres?onglet=slack&slack=${encodeURIComponent(result)}`;
}

export const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';

export interface SlackAppCredentials {
  clientId: string;
  clientSecret: string;
  signingSecret: string;
}

export interface SlackActor {
  userId: string;
  role: string;
}

/** Une connexion utilisable par l'envoi : jeton en mémoire et document. */
export interface ActiveSlackConnection {
  token: string;
  connection: SlackConnectionLean;
}

const TOKEN_OWNER = 'bot';

export function slackTokenRef(organizationId: string): OrganizationSecretRef {
  return { organizationId, kind: 'slack_bot_token', ownerId: TOKEN_OWNER };
}

/** Empreinte d'une adresse (invalidation du cache de correspondance). */
export function emailKeyOf(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

function notConnected(): NotFoundException {
  return new NotFoundException({
    code: 'SLACK_NOT_CONNECTED',
    message: 'Aucun espace Slack n’est connecté à cette organisation.',
  });
}

@Injectable()
export class SlackConnectionsService {
  private readonly logger = new Logger('Slack');

  constructor(
    @InjectModel(SlackConnection.name)
    private readonly connections: Model<SlackConnectionDocument>,
    @InjectModel(SlackUserLink.name) private readonly links: Model<SlackUserLinkDocument>,
    @InjectModel(SlackProjectChannel.name)
    private readonly channels: Model<SlackProjectChannelDocument>,
    @Inject(SecretsService) private readonly secrets: SecretsService,
    @Inject(ORGANIZATION_SECRETS) private readonly vault: OrganizationSecretsPort,
    @Inject(SlackApi) private readonly api: SlackApi,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(MembersService) private readonly members: MembersService,
    @InjectConnection() private readonly db: Connection,
  ) {}

  // ── Application de la plateforme ───────────────────────────────────────────

  /**
   * Identifiants de l'application Slack, ou `null` (non configurée, désactivée dans
   * `/admin`, ou `SLACK_ENABLED=false`). Lus par `SecretsService` : cache de 60 s.
   */
  async appCredentials(): Promise<SlackAppCredentials | null> {
    if (!slackEnabled()) return null;
    const [clientId, clientSecret, signingSecret] = await Promise.all([
      this.secrets.configValue('slack', 'clientId'),
      this.secrets.resolve('slack', 'clientSecret'),
      this.secrets.resolve('slack', 'signingSecret'),
    ]);
    if (!clientId || !clientSecret || !signingSecret) return null;
    return {
      clientId,
      clientSecret: clientSecret.secret.expose(),
      signingSecret: signingSecret.secret.expose(),
    };
  }

  // ── Lecture ────────────────────────────────────────────────────────────────

  async view(organizationId: string, canManage: boolean): Promise<SlackConnectionView> {
    const [app, doc] = await Promise.all([
      this.appCredentials(),
      this.connections.findOne({ organizationId }).lean<SlackConnectionLean>().exec(),
    ]);
    let connectedBy: SlackConnectionView['connectedBy'] = null;
    if (doc) {
      const who = await this.members.identitiesOf([doc.connectedByUserId]);
      const id = who.get(doc.connectedByUserId);
      connectedBy = {
        userId: doc.connectedByUserId,
        name: id?.name ?? id?.email ?? 'Membre retiré',
      };
    }
    return {
      available: app !== null,
      connected: doc !== null,
      status: doc?.status ?? null,
      teamName: doc?.teamName ?? null,
      connectedBy,
      connectedAt: doc ? doc.connectedAt.toISOString() : null,
      stats: doc
        ? {
            sent: doc.stats?.sent ?? 0,
            unmatched: doc.stats?.unmatched ?? 0,
            failed: doc.stats?.failed ?? 0,
          }
        : null,
      canManage,
    };
  }

  /** Connexion ACTIVE et utilisable, jeton déchiffré — ou `null` (rien ne doit partir). */
  async active(organizationId: string): Promise<ActiveSlackConnection | null> {
    if ((await this.appCredentials()) === null) return null;
    const connection = await this.connections
      .findOne({ organizationId, status: 'active' })
      .lean<SlackConnectionLean>()
      .exec();
    if (!connection) return null;
    let secret;
    try {
      secret = await this.vault.resolve(slackTokenRef(organizationId));
    } catch (err) {
      if (err instanceof VaultUnavailableError) return null;
      throw err;
    }
    if (!secret) return null;
    return { token: secret.expose(), connection };
  }

  async isActive(organizationId: string): Promise<boolean> {
    if ((await this.appCredentials()) === null) return false;
    return (await this.connections.countDocuments({ organizationId, status: 'active' })) > 0;
  }

  // ── Connexion (OAuth v2) ───────────────────────────────────────────────────

  async startConnect(organizationId: string, userId: string): Promise<SlackConnectStart> {
    const app = await this.appCredentials();
    if (!app) {
      throw new ServiceUnavailableException({
        code: 'SLACK_NOT_AVAILABLE',
        message:
          'Slack n’est pas encore disponible sur Lalanda : l’application n’est pas configurée.',
      });
    }
    const state = signSlackState({ organizationId, userId }, authSecret());
    const url = new URL(SLACK_AUTHORIZE_URL);
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('scope', SLACK_BOT_SCOPES.join(','));
    url.searchParams.set('redirect_uri', slackRedirectUri());
    url.searchParams.set('state', state);
    return { authorizeUrl: url.toString() };
  }

  /**
   * Retour de Slack (`GET /slack/oauth/callback`). Renvoie TOUJOURS l'adresse de la
   * page web où rediriger, avec un résultat (`connecte`, ou `erreur-<motif>`) : aucune
   * exception ne remonte vers un navigateur au milieu d'un aller-retour OAuth.
   */
  async completeConnect(input: {
    code: unknown;
    state: unknown;
    error: unknown;
    headers: Record<string, string>;
  }): Promise<string> {
    const state = verifySlackState(input.state, authSecret());
    if (!state) return slackSettingsUrl('erreur-etat');

    // La session courante doit être celle qui a lancé la connexion.
    const session = await getAuth().api.getSession({ headers: new Headers(input.headers) });
    const userId = session?.user ? String(session.user.id) : null;
    if (!userId || userId !== state.userId) return slackSettingsUrl('erreur-session');
    if (await isAccountBlocked(this.db, userId)) return slackSettingsUrl('erreur-session');

    // Toujours membre, et toujours habilitée à gérer l'organisation.
    const resolved = await this.authz.resolveOrgRole(userId, state.organizationId);
    if (
      !resolved ||
      !can(resolved.role, 'organization.manage', resolved.context as OrgPermissionContext)
    ) {
      return slackSettingsUrl('erreur-droit');
    }

    if (typeof input.error === 'string' && input.error !== '') {
      return slackSettingsUrl('annule');
    }
    if (typeof input.code !== 'string' || input.code === '' || input.code.length > 512) {
      return slackSettingsUrl('erreur-code');
    }

    const app = await this.appCredentials();
    if (!app) return slackSettingsUrl('erreur-indisponible');

    let access;
    try {
      access = await this.api.oauthAccess({
        clientId: app.clientId,
        clientSecret: app.clientSecret,
        code: input.code,
        redirectUri: slackRedirectUri(),
      });
    } catch (err) {
      this.logger.warn(`Échange OAuth Slack refusé : ${codeOf(err)}`);
      return slackSettingsUrl('erreur-echange');
    }
    if (access.tokenType !== 'bot' || access.teamId.includes(':')) {
      return slackSettingsUrl('erreur-echange');
    }

    const organizationId = state.organizationId;
    const previous = await this.connections
      .findOne({ organizationId })
      .lean<SlackConnectionLean>()
      .exec();
    let previousToken: string | null = null;
    if (previous && previous.teamId !== access.teamId) {
      previousToken = (await this.vault.resolve(slackTokenRef(organizationId)))?.expose() ?? null;
    }

    try {
      await this.vault.put(slackTokenRef(organizationId), access.accessToken, userId);
    } catch (err) {
      this.logger.error(`Jeton Slack non enregistré : ${codeOf(err)}`);
      return slackSettingsUrl('erreur-coffre');
    }
    const now = new Date();
    await this.connections
      .updateOne(
        { organizationId },
        {
          $set: {
            teamId: access.teamId,
            teamName: access.teamName,
            appId: access.appId,
            botUserId: access.botUserId,
            scopes: access.scope ? access.scope.split(',') : [],
            status: 'active',
            statusReason: null,
            statusChangedAt: now,
            connectedByUserId: userId,
            connectedAt: now,
            stats: { sent: 0, unmatched: 0, failed: 0 },
            lastErrorCode: null,
            lastErrorAt: null,
          },
          $setOnInsert: { _schemaVersion: 1 },
        },
        { upsert: true },
      )
      .exec();
    // Nouvel espace, ou membres renommés : la correspondance repart de zéro.
    await this.links.deleteMany({ organizationId }).exec();
    if (previous && previousToken) {
      await this.revokeIfUnshared(organizationId, previous.teamId, previousToken);
    }

    await this.audit.record({
      organizationId,
      actorUserId: userId,
      actorRole: resolved.role,
      action: previous ? 'slack.reconnected' : 'slack.connected',
      targetType: 'slack_connection',
      targetId: access.teamId,
      metadata: { teamId: access.teamId, teamName: access.teamName },
    });
    return slackSettingsUrl('connecte');
  }

  // ── Déconnexion ────────────────────────────────────────────────────────────

  async disconnect(organizationId: string, actor: SlackActor): Promise<SlackConnectionView> {
    const doc = await this.connections
      .findOne({ organizationId })
      .lean<SlackConnectionLean>()
      .exec();
    if (!doc) throw notConnected();
    let token: string | null = null;
    try {
      token = (await this.vault.resolve(slackTokenRef(organizationId)))?.expose() ?? null;
    } catch (err) {
      // Coffre indisponible ou chiffré illisible : la déconnexion locale reste possible.
      this.logger.warn(`Jeton Slack illisible à la déconnexion : ${codeOf(err)}`);
    }
    if (token) await this.revokeIfUnshared(organizationId, doc.teamId, token);
    await this.vault.destroy(slackTokenRef(organizationId));
    await Promise.all([
      this.connections.deleteOne({ organizationId }).exec(),
      this.links.deleteMany({ organizationId }).exec(),
    ]);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'slack.disconnected',
      targetType: 'slack_connection',
      targetId: doc.teamId,
      metadata: { teamId: doc.teamId, teamName: doc.teamName },
    });
    return this.view(organizationId, true);
  }

  /** `auth.revoke` seulement si aucune AUTRE organisation n'utilise cet espace. */
  private async revokeIfUnshared(
    organizationId: string,
    teamId: string,
    token: string,
  ): Promise<void> {
    const shared = await this.connections.countDocuments({
      teamId,
      status: 'active',
      organizationId: { $ne: organizationId },
    });
    if (shared > 0) return;
    try {
      await this.api.authRevoke(token);
    } catch (err) {
      // Jeton déjà mort chez Slack : rien à révoquer, la suppression locale suffit.
      this.logger.warn(`auth.revoke Slack : ${codeOf(err)}`);
    }
  }

  // ── Canaux ─────────────────────────────────────────────────────────────────

  async listChannels(organizationId: string): Promise<SlackChannelOption[]> {
    const active = await this.active(organizationId);
    if (!active) throw notConnected();
    try {
      return await this.api.listPublicChannels(active.token);
    } catch (err) {
      await this.onError(organizationId, err);
      throw new ConflictException({
        code: 'SLACK_UNAVAILABLE',
        message: 'Slack n’a pas répondu : la liste des canaux est indisponible.',
      });
    }
  }

  // ── Erreurs et compteurs ───────────────────────────────────────────────────

  /** Erreur Slack : compte l'échec ; jeton mort → connexion « à reconnecter ». */
  async onError(organizationId: string, err: unknown): Promise<void> {
    const code = codeOf(err);
    const dead = err instanceof SlackApiError && err.deadToken;
    await this.connections
      .updateOne(
        { organizationId },
        {
          $inc: { 'stats.failed': 1 },
          $set: {
            lastErrorCode: code,
            lastErrorAt: new Date(),
            ...(dead
              ? { status: 'reconnect_required', statusReason: code, statusChangedAt: new Date() }
              : {}),
          },
        },
      )
      .exec();
    this.logger.warn(`Envoi Slack en échec (organisation ${organizationId}) : ${code}`);
  }

  async count(organizationId: string, field: 'sent' | 'unmatched'): Promise<void> {
    await this.connections
      .updateOne({ organizationId }, { $inc: { [`stats.${field}`]: 1 } })
      .exec();
  }

  // ── Événements Slack (Events API) ──────────────────────────────────────────

  /**
   * `POST /slack/events`. Renvoie le corps de réponse, ou `null` si la requête doit
   * être refusée (signature absente, fausse ou périmée → 401).
   */
  async handleEvent(input: {
    rawBody: string;
    timestamp: string | undefined;
    signature: string | undefined;
  }): Promise<{ challenge?: string; ok?: true } | null> {
    const app = await this.appCredentials();
    if (!app) return null;
    if (
      !verifySlackSignature({
        signingSecret: app.signingSecret,
        timestamp: input.timestamp,
        signature: input.signature,
        rawBody: input.rawBody,
      })
    ) {
      return null;
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(input.rawBody) as Record<string, unknown>;
    } catch {
      return { ok: true };
    }
    if (payload['type'] === 'url_verification') {
      return { challenge: typeof payload['challenge'] === 'string' ? payload['challenge'] : '' };
    }
    if (payload['type'] !== 'event_callback') return { ok: true };
    const teamId = typeof payload['team_id'] === 'string' ? payload['team_id'] : null;
    const event = (payload['event'] ?? {}) as Record<string, unknown>;
    if (!teamId) return { ok: true };
    const appId = typeof payload['api_app_id'] === 'string' ? payload['api_app_id'] : null;
    if (event['type'] === 'app_uninstalled') {
      await this.closeTeam(teamId, appId, 'uninstalled', 'app_uninstalled');
    } else if (event['type'] === 'tokens_revoked') {
      const tokens = (event['tokens'] ?? {}) as Record<string, unknown>;
      const bots = Array.isArray(tokens['bot']) ? (tokens['bot'] as unknown[]) : [];
      if (bots.length > 0) {
        await this.closeTeam(teamId, appId, 'reconnect_required', 'tokens_revoked');
      }
    }
    return { ok: true };
  }

  /** Toutes les connexions de cet espace : statut changé, jeton détruit. */
  private async closeTeam(
    teamId: string,
    appId: string | null,
    status: SlackConnectionStatus,
    reason: string,
  ): Promise<void> {
    const docs = await this.connections
      .find({ teamId, ...(appId ? { $or: [{ appId }, { appId: null }] } : {}) })
      .lean<SlackConnectionLean[]>()
      .exec();
    for (const doc of docs) {
      await this.vault.destroy(slackTokenRef(doc.organizationId));
      await this.connections
        .updateOne(
          { _id: doc._id },
          { $set: { status, statusReason: reason, statusChangedAt: new Date() } },
        )
        .exec();
      await this.links.deleteMany({ organizationId: doc.organizationId }).exec();
      await this.audit.record({
        organizationId: doc.organizationId,
        actorUserId: 'slack',
        actorRole: 'system',
        action: `slack.${reason}`,
        targetType: 'slack_connection',
        targetId: teamId,
        metadata: { teamId, status },
      });
    }
  }

  // ── Correspondance des membres ─────────────────────────────────────────────

  get linkModel(): Model<SlackUserLinkDocument> {
    return this.links;
  }

  get channelModel(): Model<SlackProjectChannelDocument> {
    return this.channels;
  }
}

/** Code d'une erreur, sans message libre (qui pourrait recopier une requête). */
export function codeOf(err: unknown): string {
  if (err instanceof SlackApiError) return err.code;
  if (err instanceof VaultUnavailableError) return err.code;
  if (err instanceof Error) return err.name;
  return 'unknown';
}

function authSecret(): string {
  return process.env['AUTH_SECRET'] ?? '';
}
