// Import et export CSV du CRM — ADR-0035 § 2.
//
// Export : contacts ou opportunités de l'organisation, au format `crm-csv.ts`,
// journalisé en audit STRICT (données personnelles : un export non tracé n'est
// pas émis, docs/12 « les exports sensibles sont journalisés »).
//
// Import : TOUT OU RIEN. Chaque ligne passe par les MÊMES règles que l'API
// (schémas Zod de `crm.dto.ts`) ; la moindre erreur renvoie 400 avec le numéro de
// ligne et rien n'est créé. Rattachements : client par NIF, contact par e-mail,
// étape par clé ou par libellé.

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { ZodError } from 'zod';

import { AuditService } from '../authz/audit.service.js';
import { normalizeNif } from '../fiscal/fiscal.dto.js';
import { Customer, type CustomerDocument } from '../sales/customer.schema.js';
import { normalizeForSearch } from '../sales/search.js';
import { ContactsService } from './contacts.service.js';
import { amountFromSheet, headerKey, parseCsv, toCsv } from './crm-csv.js';
import { CrmSettingsService, type CrmActor } from './crm-settings.service.js';
import {
  CreateContactSchema,
  CreateOpportunitySchema,
  MAX_IMPORT_ROWS,
  type ContactInput,
} from './crm.dto.js';
import { OpportunitiesService } from './opportunities.service.js';

const EXPORT_LIMIT = 10_000;

export const CONTACT_COLUMNS = [
  'nom',
  'fonction',
  'email',
  'telephone',
  'entreprise',
  'nif_client',
  'notes',
] as const;

export const OPPORTUNITY_COLUMNS = [
  'titre',
  'etape',
  'montant',
  'devise',
  'cloture_prevue',
  'prospect',
  'nif_client',
  'email_contact',
] as const;

export interface CsvFile {
  body: string;
  fileName: string;
}

export interface ImportResult {
  dryRun: boolean;
  rows: number;
  created: number;
}

type CustomerLean = Customer & { _id: Types.ObjectId };

interface RowError {
  line: number;
  message: string;
}

function zodMessages(error: ZodError): string {
  return error.issues
    .map((i) => (i.path.length > 0 ? `${i.path.join('.')} : ${i.message}` : i.message))
    .join(' ; ');
}

function importRejected(errors: RowError[]): never {
  throw new BadRequestException({
    code: 'CSV_IMPORT_INVALID',
    message: 'Le fichier contient des erreurs : rien n’a été importé.',
    details: { errors: errors.slice(0, 100) },
  });
}

function fileUnreadable(message: string): never {
  throw new BadRequestException({ code: 'CSV_UNREADABLE', message });
}

const today = () => new Date().toISOString().slice(0, 10);
const orNull = (v: string | undefined) => (v === undefined || v === '' ? null : v);

@Injectable()
export class CrmCsvService {
  constructor(
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(OpportunitiesService) private readonly opportunities: OpportunitiesService,
    @Inject(CrmSettingsService) private readonly settings: CrmSettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async nifsOf(
    organizationId: string,
    ids: readonly (string | null)[],
  ): Promise<Map<string, string>> {
    const valid = [...new Set(ids.filter((i): i is string => typeof i === 'string'))];
    if (valid.length === 0) return new Map();
    const docs = await this.customers
      .find({ _id: { $in: valid.map((i) => new Types.ObjectId(i)) }, organizationId })
      .select({ nif: 1 })
      .lean<CustomerLean[]>()
      .exec();
    return new Map(docs.flatMap((d) => (d.nif ? [[String(d._id), d.nif] as const] : [])));
  }

  private async customerIdsByNif(
    organizationId: string,
    nifs: readonly string[],
  ): Promise<Map<string, string>> {
    const valid = [...new Set(nifs.filter((n) => n !== '').map(normalizeNif))];
    if (valid.length === 0) return new Map();
    const docs = await this.customers
      .find({ organizationId, nif: { $in: valid } })
      .select({ nif: 1 })
      .lean<CustomerLean[]>()
      .exec();
    return new Map(docs.map((d) => [d.nif!, String(d._id)]));
  }

  private async audited(
    organizationId: string,
    actor: CrmActor,
    action: string,
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action,
      targetType: 'crm',
      targetId: organizationId,
      metadata,
    });
  }

  // ── Export ───────────────────────────────────────────────────────────────

  async exportContacts(organizationId: string, actor: CrmActor): Promise<CsvFile> {
    const items = await this.contacts.all(organizationId, EXPORT_LIMIT);
    const nifs = await this.nifsOf(
      organizationId,
      items.map((c) => c.customerId),
    );
    const body = toCsv(
      CONTACT_COLUMNS,
      items.map((c) => [
        c.name,
        c.jobTitle,
        c.email,
        c.phone,
        c.customerName ?? c.companyName,
        c.customerId ? (nifs.get(c.customerId) ?? null) : null,
        c.notes,
      ]),
    );
    await this.audited(organizationId, actor, 'crm.contacts_exported', { rows: items.length });
    return { body, fileName: `contacts-${today()}.csv` };
  }

  async exportOpportunities(organizationId: string, actor: CrmActor): Promise<CsvFile> {
    const items = await this.opportunities.all(organizationId, EXPORT_LIMIT);
    const nifs = await this.nifsOf(
      organizationId,
      items.map((o) => o.customerId),
    );
    const contactIds = items.flatMap((o) => (o.contactId ? [o.contactId] : []));
    const emails = new Map<string, string>();
    for (const c of await Promise.all(
      [...new Set(contactIds)].map((id) =>
        this.contacts.requireOwn(organizationId, id).catch(() => null),
      ),
    )) {
      if (c?.email) emails.set(String(c._id), c.email);
    }
    const body = toCsv(
      OPPORTUNITY_COLUMNS,
      items.map((o) => [
        o.title,
        o.stageKey,
        o.amount,
        o.currency,
        o.expectedCloseDate,
        o.prospectName ?? o.customerName,
        o.customerId ? (nifs.get(o.customerId) ?? null) : null,
        o.contactId ? (emails.get(o.contactId) ?? null) : null,
      ]),
    );
    await this.audited(organizationId, actor, 'crm.opportunities_exported', {
      rows: items.length,
    });
    return { body, fileName: `opportunites-${today()}.csv` };
  }

  // ── Import ───────────────────────────────────────────────────────────────

  async importContacts(
    organizationId: string,
    csv: string,
    dryRun: boolean,
    actor: CrmActor,
  ): Promise<ImportResult> {
    const parsed = parseCsv(csv, { required: ['nom'], maxRows: MAX_IMPORT_ROWS });
    if (!parsed.ok) fileUnreadable(parsed.message);
    const byNif = await this.customerIdsByNif(
      organizationId,
      parsed.rows.map((r) => r.cells['nif_client'] ?? ''),
    );
    const errors: RowError[] = [];
    const inputs: ContactInput[] = [];
    for (const { line, cells } of parsed.rows) {
      const nif = cells['nif_client'] ?? '';
      let customerId: string | null = null;
      if (nif !== '') {
        customerId = byNif.get(normalizeNif(nif)) ?? null;
        if (customerId === null) {
          errors.push({ line, message: `aucun client de NIF « ${nif} ».` });
          continue;
        }
      }
      const r = CreateContactSchema.safeParse({
        name: cells['nom'],
        jobTitle: orNull(cells['fonction']),
        email: orNull(cells['email']),
        phone: orNull(cells['telephone']),
        customerId,
        companyName: customerId === null ? orNull(cells['entreprise']) : null,
        notes: orNull(cells['notes']),
      });
      if (!r.success) errors.push({ line, message: zodMessages(r.error) });
      else inputs.push(r.data);
    }
    if (errors.length > 0) importRejected(errors);
    const created = dryRun ? 0 : await this.contacts.createMany(organizationId, inputs, actor);
    if (!dryRun) {
      await this.audited(organizationId, actor, 'crm.contacts_imported', { rows: created });
    }
    return { dryRun, rows: inputs.length, created };
  }

  async importOpportunities(
    organizationId: string,
    csv: string,
    dryRun: boolean,
    actor: CrmActor,
  ): Promise<ImportResult> {
    const parsed = parseCsv(csv, { required: ['titre'], maxRows: MAX_IMPORT_ROWS });
    if (!parsed.ok) fileUnreadable(parsed.message);
    const settings = await this.settings.get(organizationId);
    const stageOf = (raw: string): string | null => {
      if (raw === '') return settings.stages.find((s) => s.kind === 'open')!.key;
      const k = headerKey(raw);
      const byKey = settings.stages.find((s) => s.key === k);
      if (byKey) return byKey.key;
      const n = normalizeForSearch(raw);
      return settings.stages.find((s) => normalizeForSearch(s.label) === n)?.key ?? null;
    };
    const byNif = await this.customerIdsByNif(
      organizationId,
      parsed.rows.map((r) => r.cells['nif_client'] ?? ''),
    );
    const errors: RowError[] = [];
    const docs: Record<string, unknown>[] = [];
    for (const { line, cells } of parsed.rows) {
      const nif = cells['nif_client'] ?? '';
      let customerId: string | null = null;
      if (nif !== '') {
        customerId = byNif.get(normalizeNif(nif)) ?? null;
        if (customerId === null) {
          errors.push({ line, message: `aucun client de NIF « ${nif} ».` });
          continue;
        }
      }
      let contactId: string | null = null;
      const email = cells['email_contact'] ?? '';
      if (email !== '') {
        const contact = await this.contacts.findByEmail(organizationId, email);
        if (contact === null) {
          errors.push({ line, message: `aucun contact d’e-mail « ${email} ».` });
          continue;
        }
        contactId = String(contact._id);
      }
      const stageKey = stageOf(cells['etape'] ?? '');
      if (stageKey === null) {
        errors.push({ line, message: `étape inconnue : « ${cells['etape']} ».` });
        continue;
      }
      const montant = cells['montant'] ?? '';
      const r = CreateOpportunitySchema.safeParse({
        title: cells['titre'],
        customerId,
        prospectName: customerId === null ? orNull(cells['prospect']) : null,
        contactId,
        amount: montant === '' ? null : amountFromSheet(montant),
        currency: (cells['devise'] ?? '') === '' ? 'CDF' : (cells['devise'] ?? '').toUpperCase(),
        expectedCloseDate: orNull(cells['cloture_prevue']),
        stageKey,
      });
      if (!r.success) {
        errors.push({ line, message: zodMessages(r.error) });
        continue;
      }
      docs.push(
        await this.opportunities.build(
          organizationId,
          stageKey,
          r.data.opportunity,
          actor,
          'import',
        ),
      );
    }
    if (errors.length > 0) importRejected(errors);
    const created = dryRun ? 0 : await this.opportunities.insertMany(docs);
    if (!dryRun) {
      await this.audited(organizationId, actor, 'crm.opportunities_imported', { rows: created });
    }
    return { dryRun, rows: docs.length, created };
  }
}
