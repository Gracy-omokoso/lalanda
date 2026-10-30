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
//
// ADR-0040 — C9 (CSV v2) : colonnes FACULTATIVES ajoutées en fin de ligne — un
// fichier ADR-0035 reste accepté tel quel.
//   - `compte` (contacts et opportunités) : nom d'un compte de l'organisation
//     (non fusionné). Inconnu ou porté par plusieurs comptes → erreur de ligne
//     (préciser le NIF). Avec `nif_client`, le nom doit être celui du compte du
//     client. Sans `compte`, l'ancien rattachement (NIF, entreprise, prospect)
//     est inchangé.
//   - `responsable` (opportunités) : e-mail d'un membre de l'organisation
//     détenant EFFECTIVEMENT `crm.manage` (droits effectifs, ADR-0041 A3).
//   - `motif_perte`, `detail_perte` (opportunités) : motif exigé pour une
//     opportunité perdue si les réglages l'imposent ; aucun motif par défaut
//     (l'ADR n'en prévoit pas) : un ancien fichier sans motif donne une erreur
//     de ligne explicite (`lostReasonCell`).
// Validation SANS écriture (l'essai à blanc ne crée rien, pas même un prospect) ;
// la construction des documents n'a lieu qu'à l'import réel.

import { BadRequestException, HttpException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { ZodError } from 'zod';

import { AuditService } from '../authz/audit.service.js';
import { can } from '../authz/permissions.js';
import { MembersService } from '../organizations/members.service.js';
import { WorkMembersService } from '../work/work-members.service.js';
import {
  CrmAccount,
  type CrmAccountDocument,
  type CrmAccountLean,
} from './accounts/crm-account.schema.js';
import { normalizeNif } from '../fiscal/fiscal.dto.js';
import { Customer, type CustomerDocument } from '../sales/customer.schema.js';
import { normalizeForSearch } from '../sales/search.js';
import { ContactsService } from './contacts.service.js';
import {
  amountFromSheet,
  headerKey,
  lostReasonCell,
  parseCsv,
  toCsv,
  uniqueMatch,
} from './crm-csv.js';
import { CrmSettingsService, type CrmActor } from './crm-settings.service.js';
import type { PipelineStage } from './crm-model.js';
import { CrmOpportunity, type CrmOpportunityDocument } from './crm.schemas.js';
import {
  CreateContactSchema,
  CreateOpportunitySchema,
  MAX_IMPORT_ROWS,
  type ContactInput,
} from './crm.dto.js';

type CreateOpportunity = Extract<
  ReturnType<typeof CreateOpportunitySchema.safeParse>,
  { success: true }
>['data'];
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
  // ADR-0040 — C9
  'compte',
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
  // ADR-0040 — C9
  'compte',
  'responsable',
  'motif_perte',
  'detail_perte',
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

/** Message d'une erreur HTTP levée par un service (corps `{ message }` ou texte). */
function httpMessage(e: HttpException): string {
  const body = e.getResponse();
  if (typeof body === 'string') return body;
  const m = (body as { message?: unknown }).message;
  return typeof m === 'string' ? m : e.message;
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
    // ADR-0040 — C9
    @InjectModel(CrmAccount.name) private readonly accounts: Model<CrmAccountDocument>,
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(WorkMembersService) private readonly workMembers: WorkMembersService,
    @InjectModel(CrmOpportunity.name)
    private readonly opportunityDocs: Model<CrmOpportunityDocument>,
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

  // ── ADR-0040 — C9 : rattachements v2 ──────────────────────────────────────

  /**
   * Résout la colonne `compte` (et sa cohérence avec `nif_client`) de chaque
   * ligne. Lecture seule, strictement dans l'organisation ; comptes fusionnés
   * exclus. Rend `undefined` quand la colonne est vide (ancien rattachement).
   */
  private async accountResolver(
    organizationId: string,
    rows: readonly { cells: Record<string, string> }[],
    customerIdsByNif: Map<string, string>,
  ): Promise<
    (cells: Record<string, string>) => { accountId: string } | { error: string } | undefined
  > {
    const names = [
      ...new Set(
        rows.map((r) => normalizeForSearch(r.cells['compte'] ?? '')).filter((n) => n !== ''),
      ),
    ];
    if (names.length === 0) return () => undefined;
    const byName = new Map<string, CrmAccountLean[]>();
    const byCustomer = new Map<string, CrmAccountLean>();
    const docs = await this.accounts
      .find({
        organizationId,
        mergedInto: null,
        $or: [
          { sortName: { $in: names } },
          { customerId: { $in: [...new Set(customerIdsByNif.values())] } },
        ],
      })
      .lean<CrmAccountLean[]>()
      .exec();
    for (const d of docs) {
      if (names.includes(d.sortName))
        byName.set(d.sortName, [...(byName.get(d.sortName) ?? []), d]);
      if (d.customerId) byCustomer.set(d.customerId, d);
    }
    return (cells) => {
      const raw = (cells['compte'] ?? '').trim();
      if (raw === '') return undefined;
      const name = normalizeForSearch(raw);
      const nif = cells['nif_client'] ?? '';
      if (nif !== '') {
        const customerId = customerIdsByNif.get(normalizeNif(nif));
        const account = customerId ? byCustomer.get(customerId) : undefined;
        if (!account || account.sortName !== name) {
          return { error: `le compte « ${raw} » n’est pas celui du client de NIF « ${nif} ».` };
        }
        return { accountId: String(account._id) };
      }
      const match = uniqueMatch(byName.get(name) ?? []);
      if (match.kind === 'none') return { error: `compte inconnu : « ${raw} ».` };
      if (match.kind === 'many') {
        return {
          error: `compte ambigu : « ${raw} » désigne ${match.count} comptes ; précisez le NIF du client.`,
        };
      }
      return { accountId: String(match.value._id) };
    };
  }

  /**
   * Responsables désignés par e-mail : membres de l'organisation détenant
   * EFFECTIVEMENT `crm.manage` (titre et écart, ADR-0041 A3). Erreur de ligne
   * sinon. Clé : e-mail en minuscules.
   */
  private async ownerResolver(
    organizationId: string,
    rows: readonly { cells: Record<string, string> }[],
  ): Promise<(raw: string) => { ownerId: string } | { error: string } | undefined> {
    if (!rows.some((r) => (r.cells['responsable'] ?? '').trim() !== '')) return () => undefined;
    const memberIds = (await this.members.list(organizationId)).map((m) => m.userId);
    const identities = await this.members.identitiesOf(memberIds);
    const permissions = await this.workMembers.permissions(organizationId, memberIds);
    const byEmail = new Map<string, string>();
    for (const id of memberIds) {
      const email = identities.get(id)?.email;
      if (email) byEmail.set(email.trim().toLowerCase(), id);
    }
    return (raw) => {
      const email = raw.trim().toLowerCase();
      if (email === '') return undefined;
      const userId = byEmail.get(email);
      if (!userId) {
        return { error: `responsable inconnu : « ${raw} » n’est pas membre de l’organisation.` };
      }
      const p = permissions.get(userId);
      if (!p || !can(p.role, 'crm.manage', p.context)) {
        return {
          error: `« ${raw} » ne peut pas être responsable : le droit de gérer le CRM lui manque.`,
        };
      }
      return { ownerId: userId };
    };
  }

  /** E-mails des utilisateurs (export de la colonne `responsable`). */
  private async emailsOfUsers(ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const valid = [...new Set(ids.filter((i): i is string => typeof i === 'string'))];
    const identities = await this.members.identitiesOf(valid);
    return new Map(
      [...identities].flatMap(([id, who]) => (who.email ? [[id, who.email] as const] : [])),
    );
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
        c.accountName,
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
    const owners = await this.emailsOfUsers(items.map((o) => o.ownerId));
    const lostIds = items.filter((o) => o.status === 'lost').map((o) => new Types.ObjectId(o.id));
    const details = new Map(
      lostIds.length === 0
        ? []
        : (
            await this.opportunityDocs
              .find({ organizationId, _id: { $in: lostIds } })
              .select({ lostReason: 1 })
              .lean<{ _id: Types.ObjectId; lostReason?: string | null }[]>()
              .exec()
          ).map((d) => [String(d._id), d.lostReason ?? null] as const),
    );
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
        o.accountName,
        o.ownerId ? (owners.get(o.ownerId) ?? null) : null,
        o.lostReasonKey,
        details.get(o.id) ?? null,
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
    const accountOf = await this.accountResolver(organizationId, parsed.rows, byNif);
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
      const account = accountOf(cells);
      if (account && 'error' in account) {
        errors.push({ line, message: account.error });
        continue;
      }
      const r = CreateContactSchema.safeParse({
        name: cells['nom'],
        jobTitle: orNull(cells['fonction']),
        email: orNull(cells['email']),
        phone: orNull(cells['telephone']),
        // ADR-0040 — C9 : le compte fait foi ; sinon, ancien rattachement.
        ...(account
          ? { accountId: account.accountId, customerId: null, companyName: null }
          : {
              customerId,
              companyName: customerId === null ? orNull(cells['entreprise']) : null,
            }),
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
    const stageOf = (raw: string): PipelineStage | null => {
      if (raw === '') return settings.stages.find((s) => s.kind === 'open')!;
      const k = headerKey(raw);
      const byKey = settings.stages.find((s) => s.key === k);
      if (byKey) return byKey;
      const n = normalizeForSearch(raw);
      return settings.stages.find((s) => normalizeForSearch(s.label) === n) ?? null;
    };
    const byNif = await this.customerIdsByNif(
      organizationId,
      parsed.rows.map((r) => r.cells['nif_client'] ?? ''),
    );
    const accountOf = await this.accountResolver(organizationId, parsed.rows, byNif);
    const ownerOf = await this.ownerResolver(organizationId, parsed.rows);
    const errors: RowError[] = [];
    const valid: { line: number; stageKey: string; input: CreateOpportunity }[] = [];
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
      const account = accountOf(cells);
      if (account && 'error' in account) {
        errors.push({ line, message: account.error });
        continue;
      }
      const owner = ownerOf(cells['responsable'] ?? '');
      if (owner && 'error' in owner) {
        errors.push({ line, message: owner.error });
        continue;
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
      const stage = stageOf(cells['etape'] ?? '');
      if (stage === null) {
        errors.push({ line, message: `étape inconnue : « ${cells['etape']} ».` });
        continue;
      }
      const lost = lostReasonCell({
        raw: cells['motif_perte'] ?? '',
        stageKind: stage.kind,
        required: settings.lostReasonRequired,
        reasons: settings.lostReasons,
      });
      if (!lost.ok) {
        errors.push({ line, message: lost.message });
        continue;
      }
      const detail = orNull(cells['detail_perte']);
      if (detail !== null && stage.kind !== 'lost') {
        errors.push({ line, message: 'détail de perte réservé aux opportunités perdues.' });
        continue;
      }
      const montant = cells['montant'] ?? '';
      const r = CreateOpportunitySchema.safeParse({
        title: cells['titre'],
        // ADR-0040 — C9 : le compte fait foi ; sinon, ancien rattachement.
        ...(account
          ? { accountId: account.accountId, customerId: null, prospectName: null }
          : {
              customerId,
              prospectName: customerId === null ? orNull(cells['prospect']) : null,
            }),
        ...(owner ? { ownerId: owner.ownerId } : {}),
        contactId,
        amount: montant === '' ? null : amountFromSheet(montant),
        currency: (cells['devise'] ?? '') === '' ? 'CDF' : (cells['devise'] ?? '').toUpperCase(),
        expectedCloseDate: orNull(cells['cloture_prevue']),
        stageKey: stage.key,
        lostReasonKey: lost.key,
        lostReasonDetail: detail,
      });
      if (!r.success) {
        errors.push({ line, message: zodMessages(r.error) });
        continue;
      }
      valid.push({ line, stageKey: stage.key, input: r.data });
    }
    if (errors.length > 0) importRejected(errors);
    if (dryRun) return { dryRun, rows: valid.length, created: 0 };

    // Import réel : documents construits (références revérifiées par le service
    // des opportunités) ; une erreur reste une erreur de ligne, rien n'est inséré.
    const docs: Record<string, unknown>[] = [];
    for (const { line, stageKey, input } of valid) {
      try {
        docs.push(
          await this.opportunities.build(
            organizationId,
            stageKey,
            input.opportunity,
            actor,
            'import',
            input.lost,
          ),
        );
      } catch (e) {
        if (!(e instanceof HttpException)) throw e;
        errors.push({ line, message: httpMessage(e) });
      }
    }
    if (errors.length > 0) importRejected(errors);
    const created = await this.opportunities.insertMany(docs);
    await this.audited(organizationId, actor, 'crm.opportunities_imported', { rows: created });
    return { dryRun, rows: docs.length, created };
  }
}
