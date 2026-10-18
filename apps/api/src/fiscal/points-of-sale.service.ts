// Points de vente e-MCF — ADR-0021 §4.1 (chantier B).
//
// ── Test avant écriture (ADR-0013 §5) ─────────────────────────────────────────
// Un jeton soumis sert d'abord à `GET /api/info/status` dans l'environnement du
// point de vente, AVANT toute écriture. Il n'est enregistré que si la DGI répond,
// l'accepte, renvoie `status = true`, le NIF de la fiche, le NIM attendu (s'il est
// renseigné), une validité future, et un e-MCF non désactivé. En cas d'échec :
// RIEN n'est écrit, ni document, ni secret. Pas de dérogation `force`.
//
// En cas de succès, UNE transaction écrit le document, le secret et l'événement
// d'audit strict. Le jeton n'apparaît ensuite nulle part en clair : seulement
// `last4`.
//
// ── Ce que ce service ne fait JAMAIS ──────────────────────────────────────────
// Il ne touche pas au réglage de la facture normalisée (R4) : ni un jeton
// expiré, ni une panne DGI, ni le retrait d'un point de vente ne la désactivent.

import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { EdefClient } from '../edef/edef.client.js';
import type { EdefInfoStatus } from '../edef/edef.types.js';
import {
  ORGANIZATION_SECRETS,
  type OrganizationSecretDescription,
  type OrganizationSecretRef,
  type OrganizationSecretsPort,
} from '../integrations/organization-secrets.port.js';
import { sanitizeProviderMessage } from '../integrations/redaction.js';
import { Secret } from '../integrations/secret-value.js';
import {
  DGI_PLATFORM_CONFIG,
  type DgiPlatformConfig,
  type EdefEnvironment,
} from '../platform-config/dgi-platform.config.js';
import {
  EmcfPointOfSale,
  type EmcfDgiSnapshot,
  type EmcfPointOfSaleDocument,
} from './emcf-point-of-sale.schema.js';
import { FiscalProfileService, type FiscalActor } from './fiscal-profile.service.js';
import { normalizeNif } from './fiscal.dto.js';
import {
  conflict,
  failureOfEdef,
  pointOfSaleNotFound,
  productionUnavailable,
  rethrowVault,
  throwTokenCheckFailure,
  type TokenCheckFailure,
} from './fiscal.errors.js';
import { inFiscalTransaction, isDuplicateKey } from './fiscal-transaction.js';
import { NormalizedInvoicingStateReader } from './normalized-invoicing-state.reader.js';

export type PointOfSaleStatus =
  'disabled' | 'token_missing' | 'nif_mismatch' | 'token_expired' | 'failing' | 'active';

export interface PointOfSaleView {
  id: string;
  label: string;
  environment: EdefEnvironment;
  expectedNim: string | null;
  enabled: boolean;
  status: PointOfSaleStatus;
  token: { configured: boolean; last4: string | null; updatedAt: string | null };
  dgi: {
    nif: string | null;
    nim: string | null;
    tokenValidUntil: string;
    emcfStatus: string | null;
    shopName: string | null;
    address: string[];
    contacts: string[];
    apiVersion: string | null;
    checkedAt: string;
  } | null;
  lastTest: { at: string; ok: boolean; code: string | null; message: string } | null;
}

/** Succès du test d'un jeton : le relevé DGI à enregistrer. */
interface TokenCheckSuccess {
  ok: true;
  dgi: EmcfDgiSnapshot;
}

const SUCCESS_MESSAGE = 'Connexion réussie.';

function secretRef(organizationId: string, pointOfSaleId: string): OrganizationSecretRef {
  return { organizationId, kind: 'dgi_emcf_token', ownerId: pointOfSaleId };
}

/**
 * Date renvoyée par la DGI. Une date sans fuseau est lue en UTC : la
 * spécification ne précise pas le fuseau (question ouverte à la DGI) et l'heure
 * locale du serveur Lalanda n'a aucune raison d'en tenir lieu.
 */
export function parseDgiDate(raw: string): Date | null {
  const withZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** « Désactivé » à la DGI, quelle que soit la casse ou l'accentuation. */
function isDisabledAtDgi(status: string | null): boolean {
  if (!status) return false;
  const plain = status.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return plain.startsWith('desactiv');
}

@Injectable()
export class PointsOfSaleService {
  constructor(
    @InjectModel(EmcfPointOfSale.name) private readonly model: Model<EmcfPointOfSaleDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(ORGANIZATION_SECRETS) private readonly secrets: OrganizationSecretsPort,
    @Inject(EdefClient) private readonly edef: EdefClient,
    @Inject(FiscalProfileService) private readonly profiles: FiscalProfileService,
    @Inject(NormalizedInvoicingStateReader) private readonly state: NormalizedInvoicingStateReader,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DGI_PLATFORM_CONFIG) private readonly config: DgiPlatformConfig,
  ) {}

  // ── Lecture ────────────────────────────────────────────────────────────────

  async list(organizationId: string): Promise<PointOfSaleView[]> {
    const docs = await this.model.find({ organizationId }).sort({ createdAt: 1 }).exec();
    if (docs.length === 0) return [];
    const [descriptions, profile] = await Promise.all([
      this.describeMany(
        organizationId,
        docs.map((d) => String(d._id)),
      ),
      this.profiles.find(organizationId),
    ]);
    return docs.map((d) =>
      viewOf(d, descriptions.get(String(d._id)) ?? null, profile?.nif ?? null),
    );
  }

  /** Points de vente à l'état `active` dans un environnement. */
  async countActive(organizationId: string, environment: EdefEnvironment): Promise<number> {
    const views = await this.list(organizationId);
    return views.filter((v) => v.environment === environment && v.status === 'active').length;
  }

  async view(organizationId: string, pointOfSaleId: string): Promise<PointOfSaleView> {
    const doc = await this.requireOwn(organizationId, pointOfSaleId);
    const [description, profile] = await Promise.all([
      this.describe(secretRef(organizationId, pointOfSaleId)),
      this.profiles.find(organizationId),
    ]);
    return viewOf(doc, description, profile?.nif ?? null);
  }

  /**
   * Jeton d'un point de vente ACTIF — pour l'émission des lots suivants (S25f).
   * `null` si le point de vente n'existe pas dans cette organisation ou n'est pas
   * `active`.
   */
  async resolveActiveToken(
    organizationId: string,
    pointOfSaleId: string,
  ): Promise<{ token: Secret; environment: EdefEnvironment } | null> {
    if (!Types.ObjectId.isValid(pointOfSaleId)) return null;
    const doc = await this.model.findOne({ _id: pointOfSaleId, organizationId }).exec();
    if (!doc) return null;
    const ref = secretRef(organizationId, pointOfSaleId);
    const [description, profile] = await Promise.all([
      this.describe(ref),
      this.profiles.find(organizationId),
    ]);
    if (viewOf(doc, description, profile?.nif ?? null).status !== 'active') return null;
    const token = await this.resolve(ref);
    return token ? { token, environment: doc.environment } : null;
  }

  // ── Écritures ──────────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    input: {
      label: string;
      environment: EdefEnvironment;
      expectedNim: string | null;
      token: string;
    },
    actor: FiscalActor,
  ): Promise<PointOfSaleView> {
    const profile = await this.profiles.find(organizationId);
    if (!profile) {
      conflict(
        'FISCAL_PROFILE_REQUIRED',
        'Enregistrez d’abord la fiche fiscale de l’organisation : le NIF est comparé à celui de la DGI.',
      );
    }
    if (input.environment === 'production' && !this.config.productionEnabled) {
      productionUnavailable();
    }

    const check = await this.checkToken({
      organizationId,
      pointOfSaleId: null,
      environment: input.environment,
      token: input.token,
      expectedNim: input.expectedNim,
      profileNif: profile.nif,
    });
    if (!check.ok) throwTokenCheckFailure(check);
    await this.assertNimFree(input.environment, check.dgi.nim, null);

    const id = new Types.ObjectId();
    const now = new Date();
    const ref = secretRef(organizationId, String(id));
    try {
      await inFiscalTransaction(this.connection, async (session) => {
        await this.model.create(
          [
            {
              _id: id,
              organizationId,
              environment: input.environment,
              label: input.label,
              expectedNim: input.expectedNim,
              enabled: true,
              dgi: check.dgi,
              lastTest: { at: now, ok: true, code: null, message: SUCCESS_MESSAGE },
              createdBy: actor.userId,
              updatedBy: actor.userId,
              _schemaVersion: 1,
            },
          ],
          { session },
        );
        const description = await this.secrets.put(ref, input.token, actor.userId, { session });
        await this.audit.recordStrict(
          {
            organizationId,
            actorUserId: actor.userId,
            actorRole: actor.role,
            action: 'emcf_point_of_sale.created',
            targetType: 'emcf_point_of_sale',
            targetId: String(id),
            metadata: {
              environment: input.environment,
              nim: check.dgi.nim,
              last4: description.last4,
            },
          },
          { session },
        );
      });
    } catch (err) {
      if (isDuplicateKey(err)) emcfAlreadyRegistered();
      rethrowVault(err);
    }
    return this.view(organizationId, String(id));
  }

  async patch(
    organizationId: string,
    pointOfSaleId: string,
    input: { label?: string | undefined; expectedNim?: string | null | undefined },
    actor: FiscalActor,
  ): Promise<PointOfSaleView> {
    await this.requireOwn(organizationId, pointOfSaleId);
    const set: Record<string, unknown> = { updatedBy: actor.userId };
    if (input.label !== undefined) set['label'] = input.label;
    if (input.expectedNim !== undefined) set['expectedNim'] = input.expectedNim;
    await this.model.updateOne({ _id: pointOfSaleId, organizationId }, { $set: set }).exec();
    return this.view(organizationId, pointOfSaleId);
  }

  /** Remplace le jeton — test avant écriture ; réactive un point de vente retiré. */
  async replaceToken(
    organizationId: string,
    pointOfSaleId: string,
    token: string,
    actor: FiscalActor,
  ): Promise<PointOfSaleView> {
    const doc = await this.requireOwn(organizationId, pointOfSaleId);
    const profile = await this.profiles.find(organizationId);
    if (!profile) {
      conflict(
        'FISCAL_PROFILE_REQUIRED',
        'Enregistrez d’abord la fiche fiscale de l’organisation.',
      );
    }
    if (doc.environment === 'production' && !this.config.productionEnabled) {
      productionUnavailable();
    }
    const check = await this.checkToken({
      organizationId,
      pointOfSaleId,
      environment: doc.environment,
      token,
      expectedNim: doc.expectedNim,
      profileNif: profile.nif,
    });
    if (!check.ok) throwTokenCheckFailure(check);
    await this.assertNimFree(doc.environment, check.dgi.nim, pointOfSaleId);

    const ref = secretRef(organizationId, pointOfSaleId);
    const before = await this.describe(ref);
    const now = new Date();
    try {
      await inFiscalTransaction(this.connection, async (session) => {
        await this.model
          .updateOne(
            { _id: pointOfSaleId, organizationId },
            {
              $set: {
                enabled: true,
                dgi: check.dgi,
                lastTest: { at: now, ok: true, code: null, message: SUCCESS_MESSAGE },
                updatedBy: actor.userId,
              },
            },
            { session },
          )
          .exec();
        const after = await this.secrets.put(ref, token, actor.userId, { session });
        await this.audit.recordStrict(
          {
            organizationId,
            actorUserId: actor.userId,
            actorRole: actor.role,
            action: 'emcf_point_of_sale.token_replaced',
            targetType: 'emcf_point_of_sale',
            targetId: pointOfSaleId,
            metadata: { nim: check.dgi.nim, last4Before: before.last4, last4After: after.last4 },
          },
          { session },
        );
      });
    } catch (err) {
      if (isDuplicateKey(err)) emcfAlreadyRegistered();
      rethrowVault(err);
    }
    return this.view(organizationId, pointOfSaleId);
  }

  /**
   * Test de connexion avec le jeton enregistré. Le résultat est dans `lastTest`
   * (jamais une erreur HTTP, sauf 404 et coffre indisponible) ; le relevé `dgi`
   * n'est remplacé que par un test entièrement réussi.
   */
  async test(organizationId: string, pointOfSaleId: string): Promise<PointOfSaleView> {
    const doc = await this.requireOwn(organizationId, pointOfSaleId);
    const now = new Date();
    const token = await this.resolve(secretRef(organizationId, pointOfSaleId));
    const profile = await this.profiles.find(organizationId);

    let lastTest: { at: Date; ok: boolean; code: string | null; message: string };
    let dgi: EmcfDgiSnapshot | null = null;
    if (!token) {
      lastTest = {
        at: now,
        ok: false,
        code: 'TOKEN_MISSING',
        message: 'Aucun jeton enregistré pour ce point de vente.',
      };
    } else if (!profile) {
      lastTest = {
        at: now,
        ok: false,
        code: 'FISCAL_PROFILE_REQUIRED',
        message: 'La fiche fiscale de l’organisation n’est pas enregistrée.',
      };
    } else {
      const check = await this.checkToken({
        organizationId,
        pointOfSaleId,
        environment: doc.environment,
        token: token.expose(),
        expectedNim: doc.expectedNim,
        profileNif: profile.nif,
      });
      if (check.ok) {
        dgi = check.dgi;
        lastTest = { at: now, ok: true, code: null, message: SUCCESS_MESSAGE };
      } else {
        lastTest = { at: now, ok: false, code: check.code, message: check.message };
      }
    }

    const set: Record<string, unknown> = { lastTest };
    if (dgi) set['dgi'] = dgi;
    try {
      await this.model.updateOne({ _id: pointOfSaleId, organizationId }, { $set: set }).exec();
    } catch (err) {
      // Le NIM renvoyé appartient désormais à un autre point de vente : le relevé
      // n'est pas enregistré, l'échec l'est.
      if (!isDuplicateKey(err)) throw err;
      await this.model
        .updateOne(
          { _id: pointOfSaleId, organizationId },
          {
            $set: {
              lastTest: {
                at: now,
                ok: false,
                code: 'EMCF_ALREADY_REGISTERED',
                message: 'Cet e-MCF est déjà rattaché à une organisation Lalanda.',
              },
            },
          },
        )
        .exec();
    }
    return this.view(organizationId, pointOfSaleId);
  }

  /**
   * Retrait : désactive le point de vente et DÉTRUIT son jeton. Le document reste.
   * R2 : pendant l'activation, le dernier point de vente actif de l'environnement
   * courant ne se retire pas.
   */
  async disable(
    organizationId: string,
    pointOfSaleId: string,
    reason: string | null,
    actor: FiscalActor,
  ): Promise<PointOfSaleView> {
    const doc = await this.requireOwn(organizationId, pointOfSaleId);
    if (!doc.enabled) return this.view(organizationId, pointOfSaleId);

    const settings = await this.state.read(organizationId);
    if (settings.state === 'enabled' && settings.environment === doc.environment) {
      const views = await this.list(organizationId);
      const self = views.find((v) => v.id === pointOfSaleId);
      const othersActive = views.filter(
        (v) => v.id !== pointOfSaleId && v.environment === doc.environment && v.status === 'active',
      ).length;
      if (self?.status === 'active' && othersActive === 0) {
        conflict(
          'LAST_ACTIVE_POINT_OF_SALE',
          'C’est le dernier point de vente actif alors que la facture normalisée est activée : ' +
            'ajoutez-en un autre, ou désactivez d’abord la facture normalisée.',
        );
      }
    }

    try {
      await inFiscalTransaction(this.connection, async (session) => {
        const res = await this.model
          .updateOne(
            { _id: pointOfSaleId, organizationId, enabled: true },
            { $set: { enabled: false, updatedBy: actor.userId } },
            { session },
          )
          .exec();
        if (res.modifiedCount === 0) return; // retrait concurrent : déjà fait.
        await this.secrets.destroy(secretRef(organizationId, pointOfSaleId), { session });
        await this.audit.recordStrict(
          {
            organizationId,
            actorUserId: actor.userId,
            actorRole: actor.role,
            action: 'emcf_point_of_sale.disabled',
            targetType: 'emcf_point_of_sale',
            targetId: pointOfSaleId,
            metadata: { nim: doc.dgi?.nim ?? null, reason: reason ?? null },
          },
          { session },
        );
      });
    } catch (err) {
      rethrowVault(err);
    }
    return this.view(organizationId, pointOfSaleId);
  }

  // ── Internes ───────────────────────────────────────────────────────────────

  /** Document du point de vente DANS cette organisation, sinon 404 (jamais 403). */
  async requireOwn(
    organizationId: string,
    pointOfSaleId: string,
  ): Promise<EmcfPointOfSaleDocument> {
    if (!Types.ObjectId.isValid(pointOfSaleId)) pointOfSaleNotFound();
    const doc = await this.model.findOne({ _id: pointOfSaleId, organizationId }).exec();
    if (!doc) pointOfSaleNotFound();
    return doc;
  }

  /** Jeton enregistré d'un point de vente de cette organisation (lecture des listes). */
  async tokenOf(organizationId: string, pointOfSaleId: string): Promise<Secret | null> {
    return this.resolve(secretRef(organizationId, pointOfSaleId));
  }

  private async assertNimFree(
    environment: EdefEnvironment,
    nim: string | null,
    exceptPointOfSaleId: string | null,
  ): Promise<void> {
    if (!nim) return;
    const filter: Record<string, unknown> = { environment, 'dgi.nim': nim };
    if (exceptPointOfSaleId) filter['_id'] = { $ne: new Types.ObjectId(exceptPointOfSaleId) };
    if (await this.model.exists(filter).exec()) emcfAlreadyRegistered();
  }

  private async checkToken(input: {
    organizationId: string;
    pointOfSaleId: string | null;
    environment: EdefEnvironment;
    token: string;
    expectedNim: string | null;
    profileNif: string;
  }): Promise<TokenCheckSuccess | TokenCheckFailure> {
    const out = await this.edef.getStatus({
      environment: input.environment,
      token: new Secret(input.token),
      organizationId: input.organizationId,
      pointOfSaleId: input.pointOfSaleId,
    });
    if (!out.ok) return failureOfEdef(out.error);
    return evaluateStatus(out.data, input, [input.token]);
  }

  private async describe(ref: OrganizationSecretRef): Promise<OrganizationSecretDescription> {
    try {
      return await this.secrets.describe(ref);
    } catch (err) {
      rethrowVault(err);
    }
  }

  private async describeMany(
    organizationId: string,
    ids: string[],
  ): Promise<Map<string, OrganizationSecretDescription>> {
    try {
      return await this.secrets.describeMany(organizationId, 'dgi_emcf_token', ids);
    } catch (err) {
      rethrowVault(err);
    }
  }

  private async resolve(ref: OrganizationSecretRef): Promise<Secret | null> {
    try {
      return await this.secrets.resolve(ref);
    } catch (err) {
      rethrowVault(err);
    }
  }
}

function emcfAlreadyRegistered(): never {
  // Message générique : on ne nomme jamais l'autre organisation.
  conflict(
    'EMCF_ALREADY_REGISTERED',
    'Cet e-MCF est déjà rattaché à une organisation Lalanda. Si c’est une erreur, contactez le support.',
  );
}

function rejected(
  code: TokenCheckFailure['code'],
  message: string,
  details: Record<string, unknown> = {},
): TokenCheckFailure {
  return { ok: false, http: 422, code, message, details };
}

/** Contrôles du §4.1 sur une réponse `GET /api/info/status` réussie. */
export function evaluateStatus(
  info: EdefInfoStatus,
  input: { expectedNim: string | null; profileNif: string },
  secrets: readonly string[],
  now: Date = new Date(),
): TokenCheckSuccess | TokenCheckFailure {
  const clean = (v: string | null): string | null =>
    v === null ? null : sanitizeProviderMessage(v, secrets);
  if (!info.status) {
    return rejected(
      'EMCF_STATUS_FALSE',
      'La DGI indique que le service e-MCF n’est pas opérationnel.',
    );
  }
  if (!info.nim) {
    return rejected('EDEF_INVALID_RESPONSE', 'La DGI n’a pas renvoyé le NIM de l’e-MCF.');
  }
  const dgiNif = info.nif ? normalizeNif(info.nif) : null;
  if (dgiNif !== input.profileNif) {
    return rejected(
      'EMCF_NIF_MISMATCH',
      'Le NIF associé à ce jeton par la DGI ne correspond pas au NIF de la fiche fiscale.',
      { dgiNif: clean(info.nif) },
    );
  }
  if (input.expectedNim && info.nim !== input.expectedNim) {
    return rejected(
      'EMCF_NIM_MISMATCH',
      'Le NIM renvoyé par la DGI ne correspond pas au NIM attendu pour ce point de vente.',
      { dgiNim: clean(info.nim) },
    );
  }
  const validUntil = parseDgiDate(info.tokenValid);
  if (!validUntil) {
    return rejected('EDEF_INVALID_RESPONSE', 'Date de validité du jeton illisible.');
  }
  if (validUntil.getTime() <= now.getTime()) {
    return rejected(
      'EMCF_TOKEN_EXPIRED',
      'Ce jeton est expiré : créez-en un nouveau dans l’e-DEF.',
      {
        tokenValidUntil: validUntil.toISOString(),
      },
    );
  }
  const emcf = info.emcfList.find((e) => e.nim === info.nim) ?? null;
  if (emcf && isDisabledAtDgi(emcf.status)) {
    return rejected('EMCF_DISABLED_AT_DGI', 'Cet e-MCF est désactivé à la DGI.', {
      emcfStatus: clean(emcf.status),
    });
  }
  return {
    ok: true,
    dgi: {
      nif: dgiNif,
      nim: info.nim,
      tokenValidUntil: validUntil,
      emcfStatus: emcf?.status ?? null,
      shopName: emcf?.shopName ?? null,
      address: [emcf?.address1, emcf?.address2, emcf?.address3].filter(
        (v): v is string => typeof v === 'string' && v.trim() !== '',
      ),
      contacts: [emcf?.contact1, emcf?.contact2, emcf?.contact3].filter(
        (v): v is string => typeof v === 'string' && v.trim() !== '',
      ),
      apiVersion: info.version,
      checkedAt: now,
    },
  };
}

/** État calculé (ADR-0021 §4.1), dans l'ordre imposé. */
export function statusOf(
  doc: Pick<EmcfPointOfSale, 'enabled' | 'dgi' | 'lastTest'>,
  tokenConfigured: boolean,
  profileNif: string | null,
  now: Date = new Date(),
): PointOfSaleStatus {
  if (!doc.enabled) return 'disabled';
  if (!tokenConfigured) return 'token_missing';
  if (doc.dgi && doc.dgi.nif !== profileNif) return 'nif_mismatch';
  if (doc.dgi && new Date(doc.dgi.tokenValidUntil).getTime() <= now.getTime()) {
    return 'token_expired';
  }
  if (!doc.dgi || (doc.lastTest && !doc.lastTest.ok)) return 'failing';
  return 'active';
}

function iso(d: Date | string | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

function viewOf(
  doc: EmcfPointOfSaleDocument,
  description: OrganizationSecretDescription | null,
  profileNif: string | null,
): PointOfSaleView {
  const configured = description?.configured ?? false;
  return {
    id: String(doc._id),
    label: doc.label,
    environment: doc.environment,
    expectedNim: doc.expectedNim ?? null,
    enabled: doc.enabled,
    status: statusOf(doc, configured, profileNif),
    token: {
      configured,
      last4: configured ? (description?.last4 ?? null) : null,
      updatedAt: configured ? iso(description?.updatedAt) : null,
    },
    dgi: doc.dgi
      ? {
          nif: doc.dgi.nif ?? null,
          nim: doc.dgi.nim ?? null,
          tokenValidUntil: new Date(doc.dgi.tokenValidUntil).toISOString(),
          emcfStatus: doc.dgi.emcfStatus ?? null,
          shopName: doc.dgi.shopName ?? null,
          address: [...(doc.dgi.address ?? [])],
          contacts: [...(doc.dgi.contacts ?? [])],
          apiVersion: doc.dgi.apiVersion ?? null,
          checkedAt: new Date(doc.dgi.checkedAt).toISOString(),
        }
      : null,
    lastTest: doc.lastTest
      ? {
          at: new Date(doc.lastTest.at).toISOString(),
          ok: doc.lastTest.ok,
          code: doc.lastTest.code ?? null,
          message: doc.lastTest.message,
        }
      : null,
  };
}
