// Fiche fiscale d'une organisation — ADR-0021 §2.

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { Organization, type OrganizationDocument } from '../organizations/organization.schema.js';
import {
  LEGAL_FORMS,
  OrganizationFiscalProfile,
  type OrganizationFiscalProfileDocument,
} from './fiscal-profile.schema.js';
import { LEGAL_FORM_LABELS, type PutFiscalProfileInput } from './fiscal.dto.js';
import { conflict } from './fiscal.errors.js';
import { NormalizedInvoicingStateReader } from './normalized-invoicing-state.reader.js';

/** Acteur d'une écriture : identifiant et rôle SOUS LEQUEL l'action a été autorisée. */
export interface FiscalActor {
  userId: string;
  role: string;
}

export interface FiscalProfileData {
  legalName: string;
  tradeName: string | null;
  legalForm: (typeof LEGAL_FORMS)[number] | null;
  legalFormOther: string | null;
  nif: string;
  rccm: string | null;
  nationalId: string | null;
  vatRegistered: boolean;
  headOffice: {
    line1: string;
    line2: string | null;
    commune: string | null;
    city: string;
    province: string | null;
    country: string;
  };
  phone: string;
  email: string;
}

export interface FiscalProfileView {
  profile: (FiscalProfileData & { updatedAt: string | null }) | null;
  locks: { nif: boolean };
  options: { legalForms: Array<{ value: string; label: string }> };
}

const FIELDS: ReadonlyArray<keyof FiscalProfileData> = [
  'legalName',
  'tradeName',
  'legalForm',
  'legalFormOther',
  'nif',
  'rccm',
  'nationalId',
  'vatRegistered',
  'headOffice',
  'phone',
  'email',
];

@Injectable()
export class FiscalProfileService {
  constructor(
    @InjectModel(OrganizationFiscalProfile.name)
    private readonly profiles: Model<OrganizationFiscalProfileDocument>,
    @InjectModel(Organization.name) private readonly organizations: Model<OrganizationDocument>,
    @Inject(NormalizedInvoicingStateReader) private readonly state: NormalizedInvoicingStateReader,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Fiche enregistrée, ou `null`. */
  async find(organizationId: string): Promise<FiscalProfileData | null> {
    const doc = await this.profiles.findOne({ organizationId }).lean().exec();
    return doc ? dataOf(doc) : null;
  }

  /** NIF des fiches de plusieurs organisations (contrôle R1 `nif_elsewhere`). */
  async organizationsWithNif(nif: string, organizationIds: readonly string[]): Promise<number> {
    if (organizationIds.length === 0) return 0;
    return this.profiles
      .countDocuments({ nif, organizationId: { $in: [...organizationIds] } })
      .exec();
  }

  async view(organizationId: string): Promise<FiscalProfileView> {
    const [doc, settings] = await Promise.all([
      this.profiles.findOne({ organizationId }).lean().exec(),
      this.state.read(organizationId),
    ]);
    return {
      profile: doc
        ? {
            ...dataOf(doc),
            updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
          }
        : null,
      locks: { nif: settings.state === 'enabled' },
      options: {
        legalForms: LEGAL_FORMS.map((value) => ({ value, label: LEGAL_FORM_LABELS[value] })),
      },
    };
  }

  async put(
    organizationId: string,
    input: PutFiscalProfileInput,
    actor: FiscalActor,
  ): Promise<FiscalProfileView> {
    const [existing, settings, org] = await Promise.all([
      this.profiles.findOne({ organizationId }).lean().exec(),
      this.state.read(organizationId),
      this.organizations.findById(organizationId, { pays: 1 }).lean().exec(),
    ]);

    const next: FiscalProfileData = {
      legalName: input.legalName,
      tradeName: input.tradeName,
      legalForm: input.legalForm,
      legalFormOther: input.legalFormOther,
      nif: input.nif,
      rccm: input.rccm,
      nationalId: input.nationalId,
      vatRegistered: input.vatRegistered,
      headOffice: {
        line1: input.headOffice.line1,
        line2: input.headOffice.line2,
        commune: input.headOffice.commune,
        city: input.headOffice.city,
        province: input.headOffice.province,
        country: input.headOffice.country ?? (org?.pays ?? 'CD').toUpperCase(),
      },
      phone: input.phone,
      email: input.email,
    };

    // Verrou (ADR-0021 §2) : tant que la facture normalisée est activée, le NIF
    // ne se modifie pas. Les autres champs restent modifiables.
    if (existing && settings.state === 'enabled' && existing.nif !== next.nif) {
      conflict(
        'FISCAL_IDENTITY_LOCKED',
        'Le NIF ne peut pas être modifié tant que la facture normalisée est activée.',
      );
    }

    const before = existing ? dataOf(existing) : null;
    await this.profiles
      .updateOne(
        { organizationId },
        {
          $set: { ...next, updatedBy: actor.userId },
          $setOnInsert: { organizationId, _schemaVersion: 1 },
        },
        { upsert: true, runValidators: true },
      )
      .exec();

    const changed = FIELDS.filter(
      (f) => before === null || JSON.stringify(before[f]) !== JSON.stringify(next[f]),
    );
    // `record`, pas `recordStrict` : la fiche n'engage rien tant que la facture
    // normalisée n'est pas activée, et le verrou du NIF protège l'essentiel.
    // Les NOMS des champs seulement, jamais leurs valeurs (docs/17).
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'fiscal_profile.updated',
      targetType: 'organization',
      targetId: organizationId,
      metadata: { champs: changed.join(','), creation: before === null },
    });

    return this.view(organizationId);
  }
}

function dataOf(doc: OrganizationFiscalProfile): FiscalProfileData {
  return {
    legalName: doc.legalName,
    tradeName: doc.tradeName ?? null,
    legalForm: doc.legalForm ?? null,
    legalFormOther: doc.legalFormOther ?? null,
    nif: doc.nif,
    rccm: doc.rccm ?? null,
    nationalId: doc.nationalId ?? null,
    vatRegistered: doc.vatRegistered,
    headOffice: {
      line1: doc.headOffice.line1,
      line2: doc.headOffice.line2 ?? null,
      commune: doc.headOffice.commune ?? null,
      city: doc.headOffice.city,
      province: doc.headOffice.province ?? null,
      country: doc.headOffice.country,
    },
    phone: doc.phone,
    email: doc.email,
  };
}
