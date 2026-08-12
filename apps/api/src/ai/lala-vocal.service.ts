// ─────────────────────────────────────────────────────────────────────────────
// SESSION D'AGENT VOCAL ELEVENLABS — l'URL signée est produite ICI
//
// ── Comment ElevenLabs authentifie une session côté navigateur (vérifié) ─────
//
// La clé d'API ElevenLabs ne doit jamais atteindre le navigateur. Le fournisseur
// prévoit deux mécanismes, tous deux appelés PAR LE SERVEUR avec l'en-tête
// `xi-api-key`, et dont le résultat seul part vers le client :
//
//   · WebSocket — `GET /v1/convai/conversation/get-signed-url?agent_id=…`
//     rend `{ "signed_url": "wss://…" }`, passé ensuite à
//     `startSession({ signedUrl })`;
//   · WebRTC — `GET /v1/convai/conversation/token?agent_id=…`
//     rend `{ "token": "…", "conversation_id": "…" }`, passé à
//     `startSession({ conversationToken })`.
//
// L'URL signée (WebSocket) est retenue : c'est le chemin documenté depuis le
// plus longtemps, il rend un seul jeton opaque, et `include_conversation_id=true`
// nous donne en prime l'identifiant de conversation du fournisseur — celui par
// lequel une facture ElevenLabs se rapproche d'une organisation.
//
// ── Ce qui SORT vers ElevenLabs, exhaustivement ─────────────────────────────
//
//   agent_id                  — identifiant de NOTRE agent, une constante de
//                               déploiement, pas une donnée d'utilisateur;
//   include_conversation_id   — un booléen;
//   en-tête xi-api-key        — la clé, lue dans le coffre chiffré.
//
// Rien d'autre. Pas de corps, pas d'identifiant d'organisation, pas de nom, pas
// de feuille, pas de valeur, pas de seuil. `construireRequeteSessionSignee()`
// est pure et exportée exactement pour que ce « rien d'autre » soit une
// assertion de test (`lala-vocal-frontiere.test.ts`) et non une promesse.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { monthWindowStart, type Plan } from '@lalanda/shared/pricing';

import { BillingService } from '../billing/billing.service.js';
import { SecretsService } from '../integrations/secrets.service.js';
import { MENTION_VOCALE } from './lala-vocal-prompt.js';
import {
  DUREE_MAX_SESSION_MINUTES,
  etatQuotaVocal,
  minutesAutorisees,
  voiceQuotaExceededPayload,
  type EtatQuotaVocal,
} from './lala-vocal-quota.js';
import { LalaVocalUsageService } from './lala-vocal-usage.service.js';
import {
  ClotureVocaleResponseSchema,
  EtatVocalResponseSchema,
  SessionVocaleResponseSchema,
  type ClotureVocaleResponse,
  type EtatVocalResponse,
  type QuotaVocalView,
  type SessionVocaleResponse,
} from './lala-vocal.dto.js';

/** Point d'entrée par défaut. ElevenLabs publie aussi des variantes régionales. */
export const ELEVENLABS_BASE_URL_DEFAUT = 'https://api.elevenlabs.io';

/** Chemin de l'émission d'URL signée — vérifié dans la référence d'API du fournisseur. */
export const CHEMIN_URL_SIGNEE = '/v1/convai/conversation/get-signed-url';

/**
 * Délai maximal de l'appel d'émission.
 *
 * Court par choix : ce n'est pas une génération, c'est la signature d'un jeton.
 * Au-delà, l'utilisateur a déjà reposé son casque — mieux vaut un refus net
 * qu'un bouton qui tourne.
 */
export const DELAI_EMISSION_MS = 8_000;

/** Codes d'erreur rendus au client. Stables : l'interface s'en sert. */
export const CODE_NON_CONFIGURE = 'VOCAL_NON_CONFIGURE' as const;
export const CODE_SESSION_REFUSEE = 'VOCAL_SESSION_REFUSEE' as const;

/** Ce que le service a besoin d'appeler sur le réseau — injectable pour les tests. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface RequeteSignee {
  url: string;
  headers: Record<string, string>;
}

/**
 * Requête EXACTE émise vers ElevenLabs.
 *
 * Pure et exportée : c'est la surface sur laquelle porte l'assertion de
 * non-fuite. Toute donnée de projet qui apparaîtrait un jour dans un appel
 * vocal devrait passer par ici, et ferait échouer le test.
 */
export function construireRequeteSessionSignee(
  baseUrl: string,
  agentId: string,
  apiKey: string,
): RequeteSignee {
  const url = new URL(CHEMIN_URL_SIGNEE, baseUrl.replace(/\/+$/, '') + '/');
  url.searchParams.set('agent_id', agentId);
  // L'identifiant de conversation du fournisseur sert au rapprochement d'une
  // facture avec une organisation. Il est opaque et ne porte aucun contenu.
  url.searchParams.set('include_conversation_id', 'true');
  return {
    url: url.toString(),
    // `xi-api-key`, et non `Authorization: Bearer` : c'est l'écart le plus facile
    // à manquer en recopiant un appel OpenAI (voir `connection-tests.ts`).
    headers: { 'xi-api-key': apiKey },
  };
}

interface ConfigurationVocale {
  agentId: string;
  baseUrl: string;
}

/** Configuration de déploiement — ni secrète, ni propre à une organisation. */
export function lireConfiguration(
  env: Record<string, string | undefined> = process.env,
): ConfigurationVocale | null {
  const agentId = env.ELEVENLABS_AGENT_ID?.trim();
  if (!agentId) return null;
  const baseUrl = env.ELEVENLABS_BASE_URL?.trim() || ELEVENLABS_BASE_URL_DEFAUT;
  return { agentId, baseUrl };
}

@Injectable()
export class LalaVocalService {
  private readonly logger = new Logger(LalaVocalService.name);
  private configAbsenteSignalee = false;

  constructor(
    @Inject(SecretsService) private readonly secrets: SecretsService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(LalaVocalUsageService) private readonly usage: LalaVocalUsageService,
    private readonly http: FetchLike = (url, init) => fetch(url, init),
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  // ─── État, sans effet de bord ──────────────────────────────────────────────

  /**
   * L'appel vocal est-il utilisable ? Lire un quota n'en consomme pas.
   *
   * Sert au bouton : un bouton d'appel qui ouvre un panneau pour annoncer un
   * refus fait vivre à l'utilisateur l'échec au lieu de le lui épargner.
   */
  async etat(organizationId: string, now: Date = new Date()): Promise<EtatVocalResponse> {
    const config = lireConfiguration(this.env);
    const cle = config ? await this.cleApi() : null;
    if (!config || !cle) {
      this.signaleConfigAbsente(config === null);
      return EtatVocalResponseSchema.parse({
        disponible: false,
        motif: 'non_configure',
        message:
          'L’appel vocal n’est pas activé sur ce déploiement. Le chat écrit avec Lala reste disponible.',
        quota: null,
      });
    }

    const etat = await this.quota(organizationId, now);
    if (etat.limiteMinutes === 0) {
      return EtatVocalResponseSchema.parse({
        disponible: false,
        motif: 'offre_sans_voix',
        message: voiceQuotaExceededPayload(etat).message,
        quota: vueQuota(etat),
      });
    }
    if (etat.depasse) {
      return EtatVocalResponseSchema.parse({
        disponible: false,
        motif: 'quota_epuise',
        message: voiceQuotaExceededPayload(etat).message,
        quota: vueQuota(etat),
      });
    }
    return EtatVocalResponseSchema.parse({
      disponible: true,
      motif: null,
      message: null,
      quota: vueQuota(etat),
    });
  }

  // ─── Ouverture ─────────────────────────────────────────────────────────────

  /**
   * Ouvre une session : vérifie le quota, signe, débite.
   *
   * L'ORDRE est le même que celui d'`AiQuotaService.runGuarded()` et pour la même
   * raison : refuser AVANT de payer, débiter APRÈS avoir obtenu quelque chose.
   * Une signature qui échoue ne débite rien — l'utilisateur n'a rien reçu.
   *
   * Le débit, lui, est inscrit AVANT que la conversation commence, au plafond de
   * session. C'est le seul instant où l'on est sûr de pouvoir écrire : après, la
   * conversation vit dans le navigateur et le serveur n'en sait plus rien.
   */
  async ouvrirSession(
    organizationId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<SessionVocaleResponse> {
    const config = lireConfiguration(this.env);
    if (!config) {
      this.signaleConfigAbsente(true);
      throw new ServiceUnavailableException({
        code: CODE_NON_CONFIGURE,
        message: 'L’appel vocal n’est pas activé sur ce déploiement.',
      });
    }

    const cle = await this.cleApi();
    if (!cle) {
      this.signaleConfigAbsente(false);
      throw new ServiceUnavailableException({
        code: CODE_NON_CONFIGURE,
        message: 'L’appel vocal n’est pas activé sur ce déploiement.',
      });
    }

    const etat = await this.quota(organizationId, now);
    if (etat.depasse || etat.dureeMaxSessionMinutes <= 0) {
      throw new ForbiddenException(voiceQuotaExceededPayload(etat));
    }

    const { signedUrl, conversationId } = await this.signer(config, cle);

    const sessionId = await this.usage.ouvrirSession({
      organizationId,
      userId,
      conversationId,
      dureeMaxMinutes: etat.dureeMaxSessionMinutes,
    });

    // Le quota rendu au client tient compte du débit qui vient d'être inscrit :
    // afficher les minutes d'AVANT ferait croire à l'utilisateur qu'il lui en
    // reste encore autant alors qu'il est déjà en ligne.
    const apres = etatQuotaVocal(
      etat.plan,
      etat.limiteMinutes,
      etat.minutesConsommees + etat.dureeMaxSessionMinutes,
      now,
    );

    return SessionVocaleResponseSchema.parse({
      signedUrl,
      sessionId,
      dureeMaxSecondes: etat.dureeMaxSessionMinutes * 60,
      mention: MENTION_VOCALE,
      quota: vueQuota(apres),
    });
  }

  // ─── Clôture ───────────────────────────────────────────────────────────────

  /** Corrige à la baisse le débit d'une session terminée. Ne lève jamais. */
  async cloturerSession(
    organizationId: string,
    sessionId: string,
    minutes: number,
    now: Date = new Date(),
  ): Promise<ClotureVocaleResponse> {
    await this.usage.cloturerSession({
      sessionId,
      organizationId,
      minutesRapportees: minutes,
      dureeMaxMinutes: DUREE_MAX_SESSION_MINUTES,
    });
    return ClotureVocaleResponseSchema.parse({
      quota: vueQuota(await this.quota(organizationId, now)),
    });
  }

  // ─── Interne ───────────────────────────────────────────────────────────────

  /**
   * Clé ElevenLabs, lue dans le coffre chiffré.
   *
   * `expose()` est le seul chemin légitime hors de l'enveloppe `Secret` : la
   * valeur part directement dans un en-tête HTTP sortant. Elle n'est ni
   * journalisée, ni rendue au client, ni stockée — l'URL signée qui en résulte
   * est un jeton de session, pas la clé.
   *
   * `null` couvre trois cas volontairement indistincts pour l'appelant : aucune
   * clé enregistrée, coffre indisponible, ou intégration DÉSACTIVÉE dans
   * `/admin`. Dans les trois, la réponse est la même — la voix ne s'ouvre pas.
   */
  private async cleApi(): Promise<string | null> {
    const resolved = await this.secrets.resolve('elevenlabs', 'apiKey');
    return resolved ? resolved.secret.expose() : null;
  }

  private async quota(organizationId: string, now: Date): Promise<EtatQuotaVocal> {
    const { plan } = await this.billing.getPlanEntitlements(organizationId);
    const { minutes, avertissement } = minutesAutorisees(plan as Plan, this.env);
    if (avertissement) this.logger.warn(avertissement);
    // Une offre à zéro minute n'a rien à compter : la lecture serait un
    // décompte inutile sur le chemin chaud, et son résultat serait ignoré.
    const consommees =
      minutes === 0 ? 0 : await this.usage.minutesDepuis(organizationId, monthWindowStart(now));
    return etatQuotaVocal(plan as Plan, minutes, consommees, now);
  }

  private async signer(
    config: ConfigurationVocale,
    cle: string,
  ): Promise<{ signedUrl: string; conversationId: string | null }> {
    const requete = construireRequeteSessionSignee(config.baseUrl, config.agentId, cle);

    let res: Response;
    try {
      res = await this.http(requete.url, {
        method: 'GET',
        headers: requete.headers,
        signal: AbortSignal.timeout(DELAI_EMISSION_MS),
      });
    } catch (err) {
      // Le message du fournisseur n'est pas relayé tel quel : il peut contenir
      // l'URL appelée, donc la clé si un jour elle passait en query. On nomme la
      // cause par son type et on s'arrête là.
      this.logger.warn(
        `session vocale non signée — ${err instanceof Error ? err.name : 'Inconnue'} : ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException({
        code: CODE_SESSION_REFUSEE,
        message: 'L’assistante vocale est momentanément injoignable. Réessayez dans un instant.',
      });
    }

    if (!res.ok) {
      // Le STATUT est journalisé, jamais le corps : une réponse d'erreur du
      // fournisseur peut réfléchir la requête, en-têtes compris.
      this.logger.warn(`session vocale refusée par ElevenLabs (HTTP ${res.status}).`);
      throw new ServiceUnavailableException({
        code: CODE_SESSION_REFUSEE,
        message: 'L’assistante vocale a refusé d’ouvrir la session. Réessayez dans un instant.',
      });
    }

    const body = (await res.json()) as { signed_url?: unknown; conversation_id?: unknown };
    const signedUrl = typeof body.signed_url === 'string' ? body.signed_url : '';
    if (signedUrl === '') {
      this.logger.warn('session vocale : réponse ElevenLabs sans "signed_url".');
      throw new ServiceUnavailableException({
        code: CODE_SESSION_REFUSEE,
        message: 'L’assistante vocale a répondu de façon inattendue. Réessayez dans un instant.',
      });
    }
    return {
      signedUrl,
      conversationId: typeof body.conversation_id === 'string' ? body.conversation_id : null,
    };
  }

  /** L'absence de configuration est un ÉTAT, pas un incident par requête. */
  private signaleConfigAbsente(agentManquant: boolean): void {
    if (this.configAbsenteSignalee) return;
    this.configAbsenteSignalee = true;
    this.logger.warn(
      agentManquant
        ? 'ELEVENLABS_AGENT_ID absente : l’appel vocal reste fermé, le chat écrit est intact.'
        : 'Aucune clé ElevenLabs utilisable (non enregistrée, coffre indisponible ou ' +
            'intégration désactivée dans /admin) : l’appel vocal reste fermé.',
    );
  }
}

/** Vue publique d'un état de quota — jamais l'objet interne. */
function vueQuota(etat: EtatQuotaVocal): QuotaVocalView {
  return {
    plan: etat.plan,
    limiteMinutes: etat.limiteMinutes,
    minutesConsommees: etat.minutesConsommees,
    minutesRestantes: etat.minutesRestantes,
    reinitialisationLe: etat.reinitialisationLe.toISOString(),
  };
}
