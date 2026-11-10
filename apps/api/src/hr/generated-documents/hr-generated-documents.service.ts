// Documents RH générés : attestation de travail et certificat de travail — ADR-0072.
//
// ── Isolation ────────────────────────────────────────────────────────────────
// La fiche est lue dans l'organisation de la requête (portée `HrScopeService`) ; une
// fiche d'une autre organisation, ou anonymisée, est « introuvable » (404).
//
// ── Données sensibles ────────────────────────────────────────────────────────
// Rien de sensible par défaut. L'adresse personnelle n'est imprimée que sur CHOIX
// EXPLICITE (attestation), avec `hr.sensitive.read`, par la porte `reveal` d'ADR-0045
// § 2.4 (débit, audit strict) ; la pièce produite est alors SENSIBLE (chiffrée). Le
// salaire n'est pas proposé. Le motif de sortie n'est jamais lu.
//
// ── Numéros ──────────────────────────────────────────────────────────────────
// `ATT-AAAA-NNNN`, `CT-AAAA-NNNN` : `hr_counters` (`$inc` seulement), HORS transaction,
// année au jour de Kinshasa ; un échec après tirage laisse un trou, jamais un doublon.
// Regénérer = nouvelle pièce ; l'ancienne reste.

import { logoOrderFor } from '@lalanda/shared/branding';
import {
  ATTESTATION_TITLES,
  DEFAULT_ATTESTATION_CLOSING,
  DEFAULT_ATTESTATION_INTRO,
  GENERATED_DOCUMENT_FIELDS,
  GENERATED_DOCUMENT_PREFIXES,
  GENERATED_DOCUMENT_TEMPLATES,
  GENERATED_DOCUMENT_TEMPLATE_LABELS,
  generatedDocumentNumber,
  type GenerateHrDocumentInput,
  type GeneratedDocumentPage,
  type GeneratedDocumentSettingsView,
  type GeneratedDocumentTemplateId,
  type GeneratedDocumentView,
  type HrDocumentView,
  type PutGeneratedDocumentSettingsInput,
} from '@lalanda/shared/hr';
import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { BrandingService } from '../../branding/branding.service.js';
import type { RenderPattern } from '../../sales/documents/templates/template.contract.js';
import { OrganizationsService } from '../../organizations/organizations.service.js';
import { PdfRenderingService } from '../../reports/pdf-rendering.service.js';
import { conflict, isDuplicateKey, staleRevision } from '../../sales/sales.errors.js';
import { initialsOf } from '../cards/card-model.js';
import { Department, type DepartmentDocument } from '../departments/department.schema.js';
import { classifyHrDocument, HrDocumentsService } from '../documents/hr-documents.service.js';
import type { EmployeeLean } from '../employees/employee.schema.js';
import { HrCounter, type HrCounterDocument } from '../expenses/hr-counter.schema.js';
import { HrPrivateService } from '../private/hr-private.service.js';
import { employeeNotFound, hrToday, sensitiveForbidden } from '../scope/hr-errors.js';
import type { HrViewer } from '../scope/hr-scope.service.js';
import {
  attestationContent,
  certificateContent,
  type DocContent,
  type DocEmployee,
} from './generated-document-content.js';
import {
  generatedDocumentHtml,
  GENERATED_TEMPLATE_VERSIONS,
  templateRef,
  themeOf,
  type DocOrganization,
} from './generated-document-render.js';
import {
  HrGeneratedDocument,
  HrGeneratedDocumentSettings,
  type HrGeneratedDocumentDocument,
  type HrGeneratedDocumentLean,
  type HrGeneratedDocumentSettingsDocument,
  type HrGeneratedDocumentSettingsLean,
} from './generated-document.schemas.js';

export interface GeneratedDocActor {
  userId: string;
  role: string;
}

export interface GeneratedDocResult {
  generated: GeneratedDocumentView;
  document: HrDocumentView;
}

interface FiscalLike {
  legalName?: string | null;
  tradeName?: string | null;
  nif?: string | null;
  rccm?: string | null;
  nationalId?: string | null;
  phone?: string | null;
  email?: string | null;
  headOffice?: {
    line1?: string | null;
    line2?: string | null;
    commune?: string | null;
    city?: string | null;
    province?: string | null;
    country?: string | null;
  } | null;
}

function unprocessable(code: string, message: string): never {
  throw new UnprocessableEntityException({ code, message });
}

function present(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/** Identification de l'employeur : seulement ce qui est renseigné. */
export function organizationOf(
  orgName: string,
  fiscal: FiscalLike | null,
): {
  name: string;
  contactLines: string[];
  legalIds: string[];
} {
  const name = present(fiscal?.legalName) ? fiscal.legalName.trim() : orgName;
  const h = fiscal?.headOffice ?? null;
  const address = h
    ? [h.line1, h.line2, h.commune, h.city, h.province]
        .filter(present)
        .map((s) => s.trim())
        .join(', ')
    : '';
  const contactLines: string[] = [];
  if (address) contactLines.push(address);
  const reach = [fiscal?.phone, fiscal?.email].filter(present).map((s) => s.trim());
  if (reach.length > 0) contactLines.push(reach.join(' · '));
  const legalIds: string[] = [];
  if (present(fiscal?.rccm)) legalIds.push(`RCCM : ${fiscal.rccm.trim()}`);
  if (present(fiscal?.nationalId)) legalIds.push(`Id. nat. : ${fiscal.nationalId.trim()}`);
  if (present(fiscal?.nif)) legalIds.push(`NIF : ${fiscal.nif.trim()}`);
  return { name, contactLines, legalIds };
}

export function generatedViewOf(d: HrGeneratedDocumentLean): GeneratedDocumentView {
  return {
    id: String(d._id),
    employeeId: d.employeeId,
    kind: d.kind,
    number: d.number,
    templateId: d.templateId,
    documentId: d.documentId,
    issuedOn: d.issuedOn,
    place: d.place,
    signatory: { name: d.signatory.name, title: d.signatory.title },
    sensitive: d.sensitive,
    createdBy: d.createdBy,
    createdAt: new Date(d.createdAt).toISOString(),
  };
}

@Injectable()
export class HrGeneratedDocumentsService {
  constructor(
    @InjectModel(HrGeneratedDocument.name)
    private readonly registry: Model<HrGeneratedDocumentDocument>,
    @InjectModel(HrGeneratedDocumentSettings.name)
    private readonly settingsModel: Model<HrGeneratedDocumentSettingsDocument>,
    @InjectModel(HrCounter.name) private readonly counters: Model<HrCounterDocument>,
    @InjectModel(Department.name) private readonly departments: Model<DepartmentDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(HrDocumentsService) private readonly documents: HrDocumentsService,
    @Inject(HrPrivateService) private readonly privates: HrPrivateService,
    @Inject(BrandingService) private readonly branding: BrandingService,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
    @Inject(PdfRenderingService) private readonly renderer: PdfRenderingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Réglages ───────────────────────────────────────────────────────────────

  private async settingsDoc(
    organizationId: string,
  ): Promise<HrGeneratedDocumentSettingsLean | null> {
    return this.settingsModel
      .findOne({ organizationId })
      .lean<HrGeneratedDocumentSettingsLean>()
      .exec();
  }

  async settings(organizationId: string): Promise<GeneratedDocumentSettingsView> {
    const s = await this.settingsDoc(organizationId);
    return {
      templateId: s?.templateId ?? 'classique',
      place: s?.place ?? null,
      signatory: s?.signatory ? { name: s.signatory.name, title: s.signatory.title } : null,
      attestationIntro: s?.attestationIntro ?? null,
      attestationClosing: s?.attestationClosing ?? null,
      defaults: {
        attestationIntro: DEFAULT_ATTESTATION_INTRO,
        attestationClosing: DEFAULT_ATTESTATION_CLOSING,
      },
      templates: GENERATED_DOCUMENT_TEMPLATES.map((id) => ({
        id,
        label: GENERATED_DOCUMENT_TEMPLATE_LABELS[id],
        version: GENERATED_TEMPLATE_VERSIONS[id],
      })),
      fields: GENERATED_DOCUMENT_FIELDS,
      revision: s?.revision ?? 0,
    };
  }

  async putSettings(
    organizationId: string,
    input: PutGeneratedDocumentSettingsInput,
    actor: GeneratedDocActor,
  ): Promise<GeneratedDocumentSettingsView> {
    const current = await this.settingsDoc(organizationId);
    const revision = current?.revision ?? 0;
    if (input.expectedRevision !== revision) staleRevision(revision);
    const set = {
      templateId: input.templateId,
      place: input.place,
      signatory: input.signatory,
      attestationIntro: input.attestationIntro,
      attestationClosing: input.attestationClosing,
      updatedBy: actor.userId,
    };
    if (!current) {
      try {
        await this.settingsModel.create({ organizationId, ...set, revision: 1, _schemaVersion: 1 });
      } catch (err) {
        if (isDuplicateKey(err)) staleRevision(revision);
        throw err;
      }
    } else {
      const res = await this.settingsModel
        .updateOne({ organizationId, revision }, { $set: set, $inc: { revision: 1 } })
        .exec();
      if (res.matchedCount !== 1) staleRevision(revision);
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.generated_document_settings.updated',
      targetType: 'organization',
      targetId: organizationId,
      // La forme seulement : jamais le texte ni le nom du signataire.
      metadata: {
        templateId: input.templateId,
        customIntro: input.attestationIntro !== null,
        customClosing: input.attestationClosing !== null,
        defaultSignatory: input.signatory !== null,
      },
    });
    return this.settings(organizationId);
  }

  // ── Registre ───────────────────────────────────────────────────────────────

  async list(
    organizationId: string,
    viewer: HrViewer,
    employeeId: string,
  ): Promise<GeneratedDocumentPage> {
    this.employeeOf(viewer, employeeId);
    const rows = await this.registry
      .find({ organizationId, employeeId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(200)
      .lean<HrGeneratedDocumentLean[]>()
      .exec();
    return { items: rows.map(generatedViewOf) };
  }

  // ── Génération ─────────────────────────────────────────────────────────────

  private employeeOf(viewer: HrViewer, employeeId: string): EmployeeLean {
    const e = viewer.byId.get(employeeId);
    if (!e || e.status === 'anonymized') employeeNotFound();
    return e;
  }

  /** Aperçu : même rendu, filigrane, aucun numéro tiré, rien de stocké. */
  async preview(
    organizationId: string,
    viewer: HrViewer,
    employeeId: string,
    input: GenerateHrDocumentInput,
    actor: GeneratedDocActor,
  ): Promise<Buffer> {
    const prepared = await this.prepare(organizationId, viewer, employeeId, input, actor);
    const year = Number(hrToday().slice(0, 4));
    const number = `${GENERATED_DOCUMENT_PREFIXES[input.kind]}-${year}-····`;
    return this.render(prepared, input, number, true);
  }

  async generate(
    organizationId: string,
    viewer: HrViewer,
    employeeId: string,
    input: GenerateHrDocumentInput,
    actor: GeneratedDocActor,
  ): Promise<GeneratedDocResult> {
    const prepared = await this.prepare(organizationId, viewer, employeeId, input, actor);
    const { number, year, seq } = await this.draw(organizationId, input.kind);
    const pdf = await this.render(prepared, input, number, false);
    const file = classifyHrDocument({ buffer: pdf });
    const sensitive = prepared.sensitive;
    const label = `${prepared.content.title} ${number}`;
    const document = await this.documents.upload(
      organizationId,
      employeeId,
      {
        category: 'attestation',
        label,
        issuedOn: input.issuedOn,
        expiresOn: null,
        sensitive,
        visibleToEmployee: input.visibleToEmployee ?? true,
      },
      file,
      `${input.kind === 'attestation' ? 'attestation' : 'certificat-de-travail'}-${number}.pdf`,
      actor,
    );
    const options = prepared.options;
    const created = await this.registry.create({
      organizationId,
      employeeId,
      kind: input.kind,
      number,
      year,
      seq,
      templateId: templateRef(prepared.templateId),
      documentId: document.id,
      issuedOn: input.issuedOn,
      place: input.place,
      signatory: input.signatory,
      options,
      sensitive,
      createdBy: actor.userId,
      _schemaVersion: 1,
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'hr.generated_document.created',
      targetType: 'hr_generated_document',
      targetId: String(created._id),
      // Jamais un nom, une adresse, un texte ni un numéro CNSS.
      metadata: {
        employeeId,
        kind: input.kind,
        number,
        templateId: templateRef(prepared.templateId),
        documentId: document.id,
        sensitive,
        ...options,
      },
    });
    const lean = await this.registry.findById(created._id).lean<HrGeneratedDocumentLean>().exec();
    return { generated: generatedViewOf(lean!), document };
  }

  // ── Interne ────────────────────────────────────────────────────────────────

  private async draw(
    organizationId: string,
    kind: GenerateHrDocumentInput['kind'],
  ): Promise<{ number: string; year: number; seq: number }> {
    const year = Number(hrToday().slice(0, 4));
    const prefix = GENERATED_DOCUMENT_PREFIXES[kind];
    const bump = () =>
      this.counters
        .findOneAndUpdate(
          { organizationId, kind: prefix, year },
          { $inc: { last: 1 }, $setOnInsert: { _schemaVersion: 1 } },
          { upsert: true, new: true },
        )
        .lean<HrCounter>()
        .exec();
    let c: HrCounter | null;
    try {
      c = await bump();
    } catch (err) {
      // Première création concurrente du compteur : la seconde bute sur l'index unique.
      if (!isDuplicateKey(err)) throw err;
      c = await bump();
    }
    const seq = c!.last;
    return { number: generatedDocumentNumber(kind, year, seq), year, seq };
  }

  private async prepare(
    organizationId: string,
    viewer: HrViewer,
    employeeId: string,
    input: GenerateHrDocumentInput,
    actor: GeneratedDocActor,
  ): Promise<{
    content: DocContent;
    org: DocOrganization;
    identity: { primaryColor: string | null; secondaryColor: string | null; font: string | null };
    templateId: GeneratedDocumentTemplateId;
    sensitive: boolean;
    options: Record<string, boolean>;
    pattern: RenderPattern | null;
  }> {
    const e = this.employeeOf(viewer, employeeId);
    const today = hrToday();
    const settings = await this.settingsDoc(organizationId);
    const templateId = input.templateId ?? settings?.templateId ?? 'classique';

    let orgName = 'Organisation';
    try {
      orgName = (await this.organizations.findOrgById(organizationId)).name;
    } catch {
      /* nom par défaut */
    }
    const fiscal = (await this.connection
      .collection('organization_fiscal_profiles')
      .findOne({ organizationId })) as FiscalLike | null;
    const employer = organizationOf(orgName, fiscal);
    const { identity, logos, logoChoice, state } =
      await this.branding.currentLogosForRender(organizationId);
    // ADR-0073 § 4 : motif courant, dans la couleur de l'identité.
    const docTheme = themeOf({
      primaryColor: identity.primaryColor,
      secondaryColor: identity.secondaryColor,
      font: identity.font,
    });
    const pattern = await this.branding.currentPatternForRender(
      organizationId,
      docTheme.accentInk,
      state,
    );

    const department =
      e.departmentId && isValidObjectId(e.departmentId)
        ? ((
            await this.departments
              .findOne({ _id: e.departmentId, organizationId })
              .lean<{ name: string }>()
              .exec()
          )?.name ?? null)
        : null;
    const contractTypeLabel =
      viewer.settings.contractTypes.find((t) => t.key === e.contractType)?.label ?? null;
    const firstName = e.preferredName?.trim() || e.firstName;
    const docEmployee: DocEmployee = {
      displayName: `${firstName} ${e.lastName}`,
      jobTitle: e.jobTitle,
      startDate: e.startDate,
      endDate: e.endDate ?? null,
      employeeNumber: e.employeeNumber ?? null,
      department,
      contractTypeLabel,
    };

    let content: DocContent;
    let sensitive = false;
    let options: Record<string, boolean>;
    if (input.kind === 'attestation') {
      const exited = e.status === 'exited' || (e.endDate !== null && e.endDate < today);
      if (exited || e.startDate > today) {
        conflict(
          'GENERATED_DOC_EMPLOYEE_NOT_ACTIVE',
          'Une attestation de travail se délivre à un collaborateur en poste : pour un départ, générez le certificat de travail.',
        );
      }
      let personalAddress: string | null = null;
      if (input.includePersonalAddress) {
        if (!viewer.actions.has('hr.sensitive.read')) sensitiveForbidden(viewer.role);
        const revealed = await this.privates.reveal(
          organizationId,
          employeeId,
          ['personalContact'],
          {
            ...actor,
            self: false,
          },
        );
        const address = revealed.sections.personalContact?.address ?? null;
        if (!address) {
          unprocessable(
            'GENERATED_DOC_NO_ADDRESS',
            'Aucune adresse personnelle n’est renseignée dans les données sensibles de ce collaborateur.',
          );
        }
        personalAddress = address;
        sensitive = true;
      }
      options = {
        includeContractType: input.includeContractType ?? false,
        includeDepartment: input.includeDepartment ?? false,
        includeEmployeeNumber: input.includeEmployeeNumber ?? false,
        includePersonalAddress: personalAddress !== null,
      };
      content = attestationContent(docEmployee, employer.name, {
        title: input.title ?? ATTESTATION_TITLES[0],
        intro: settings?.attestationIntro ?? null,
        closing: settings?.attestationClosing ?? null,
        includeContractType: options['includeContractType']!,
        includeDepartment: options['includeDepartment']!,
        includeEmployeeNumber: options['includeEmployeeNumber']!,
        personalAddress,
      });
    } else {
      if (!e.endDate) {
        conflict(
          'GENERATED_DOC_NO_END_DATE',
          'Le certificat de travail se délivre à la fin du contrat : enregistrez d’abord la sortie du collaborateur.',
        );
      }
      for (const j of input.jobs ?? []) {
        if (j.from < e.startDate || j.to > e.endDate) {
          unprocessable(
            'GENERATED_DOC_JOB_OUT_OF_SERVICE',
            'Chaque emploi doit se situer entre la date d’entrée et la date de sortie.',
          );
        }
      }
      options = {
        customJobs: (input.jobs ?? []).length > 0,
        socialSecurityNumber: Boolean(input.socialSecurityNumber),
      };
      content = certificateContent({ ...docEmployee, endDate: e.endDate }, employer.name, {
        jobs: input.jobs ?? null,
        socialSecurityNumber: input.socialSecurityNumber ?? null,
      });
    }

    return {
      content,
      org: {
        ...employer,
        initials: initialsOf(employer.name),
        // ADR-0073 § 1 : le choix unique de l'organisation, repli sur l'autre forme.
        logo:
          logoOrderFor(logoChoice)
            .map((v) => logos[v])
            .find((l) => l !== null) ?? null,
        logoLight: logos.light ?? null,
      },
      identity: {
        primaryColor: identity.primaryColor,
        secondaryColor: identity.secondaryColor,
        font: identity.font,
      },
      templateId,
      sensitive,
      options,
      pattern,
    };
  }

  private async render(
    p: Awaited<ReturnType<HrGeneratedDocumentsService['prepare']>>,
    input: GenerateHrDocumentInput,
    number: string,
    preview: boolean,
  ): Promise<Buffer> {
    const html = generatedDocumentHtml({
      templateId: p.templateId,
      content: p.content,
      org: p.org,
      identity: p.identity,
      number,
      issuedOn: input.issuedOn,
      place: input.place,
      signatory: input.signatory,
      preview,
      pattern: p.pattern,
    });
    // Date de métadonnées figée à la date de la pièce : même pièce ⇒ mêmes octets.
    return this.renderer.render(html, { fixedDate: new Date(`${input.issuedOn}T00:00:00Z`) });
  }
}
