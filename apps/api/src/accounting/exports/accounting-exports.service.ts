// Exports pour l'expert-comptable (ADR-0049 § 9). ADR-0049 — K6.
//
// - Contenus : écritures (une ligne par ligne d'écriture, colonnes de type FEC + quatre
//   colonnes Lalanda, `exportRows` du moteur), balance générale, balances auxiliaires,
//   grand livre, projets d'états (PDF et `.xlsx`, bandeau sur chaque page et chaque
//   feuille), état des réserves. Format exact : décision ouverte n° 14 (E10).
// - Chaque export : en-tête « Projet — à valider par un expert-comptable » (« SIMULATION »
//   en simulation, dans le nom ET l'en-tête), période, monnaie de tenue, pack et versions
//   des règles, réserves ; empreinte SHA-256 du fichier enregistrée (`accounting_exports`) ;
//   audit STRICT `accounting.export.created` ; limite de débit (guards du contrôleur).
// - Le fichier est conservé une durée limitée ; le journal, lui, reste.
// - Le PDF passe par le moteur PDF partagé (`PdfRenderingService`, un seul Chromium).

import { createHash } from 'node:crypto';

import { exportRows, EXPORT_COLUMNS } from '@lalanda/engine';
import {
  ACCOUNTING_STATEMENT_KINDS,
  type AccountingExportView,
  type AccountingPage,
  type CreateAccountingExportBody,
} from '@lalanda/shared/accounting';
import { forwardRef, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { PdfRenderingService } from '../../reports/pdf-rendering.service.js';
import { notFound, type AccountingActor } from '../accounting.common.js';
import {
  AccountingReportingService,
  reserveViews,
  type ReportingContext,
} from '../reports/accounting-reporting.service.js';
import { AccountingStatementsService } from '../statements/accounting-statements.service.js';
import {
  ACCOUNTING_EXPORT_FILE_TTL_MS,
  AccountingExport,
  AccountingExportFile,
  type AccountingExportFileLean,
  type AccountingExportLean,
} from './accounting-export.schema.js';
import {
  pdfFooterTemplate,
  pdfHeaderTemplate,
  renderCsv,
  renderHtml,
  renderXlsx,
  type ExportDocument,
  type ExportTable,
} from './export-render.js';

const CONTENT_TYPES: Record<string, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

const TITLES: Record<CreateAccountingExportBody['kind'], string> = {
  entries: 'Écritures (une ligne par ligne d’écriture)',
  'trial-balance': 'Balance générale',
  'auxiliary-balance': 'Balances clients et fournisseurs',
  ledger: 'Grand livre',
  statements: 'Projets d’états financiers',
  reserves: 'État des réserves',
};

const A = (key: string, label: string) => ({ key, label, amount: true });
const T = (key: string, label: string) => ({ key, label });

function viewOf(d: AccountingExportLean, fileAvailable: boolean): AccountingExportView {
  return {
    id: String(d._id),
    kind: d.kind as AccountingExportView['kind'],
    format: d.format as AccountingExportView['format'],
    from: d.from,
    to: d.to,
    simulation: d.simulation,
    fileName: d.fileName,
    sha256: d.sha256,
    size: d.size,
    bookCurrency: d.bookCurrency as AccountingExportView['bookCurrency'],
    chartPack: d.chartPack,
    ruleSetVersions: d.ruleSetVersions,
    reserveCodes: d.reserveCodes,
    createdAt: new Date(d.createdAt).toISOString(),
    createdBy: d.createdBy,
    expiresAt: new Date(d.expiresAt).toISOString(),
    fileAvailable,
  };
}

@Injectable()
export class AccountingExportsService {
  constructor(
    @Inject(AccountingReportingService) private readonly reporting: AccountingReportingService,
    @Inject(forwardRef(() => AccountingStatementsService))
    private readonly statements: AccountingStatementsService,
    @Inject(PdfRenderingService) private readonly pdf: PdfRenderingService,
    @Inject(AuditService) private readonly audit: AuditService,
    @InjectModel(AccountingExport.name) private readonly exports: Model<AccountingExportLean>,
    @InjectModel(AccountingExportFile.name)
    private readonly files: Model<AccountingExportFileLean>,
  ) {}

  // ── Contenus ─────────────────────────────────────────────────────────────

  private async document(
    ctx: ReportingContext,
    body: CreateAccountingExportBody,
  ): Promise<{ doc: ExportDocument; ruleSetVersions: number[]; reserveCodes: string[] }> {
    const { from, to } = body;
    const reserves = await this.reporting.reserves(ctx, from, to);
    const env = this.reporting.envelope(ctx, from, to, reserves);
    const pack = ctx.settings.chartPack;
    const ruleSets = new Set<number>();
    for (const e of ctx.entries) {
      const v = e.generation?.ruleSetVersion;
      if (e.date >= from && e.date <= to && typeof v === 'number') ruleSets.add(v);
    }
    const ruleSetVersions = [...ruleSets].sort((a, b) => a - b);
    const preamble: [string, string][] = [
      ['Période', `du ${from} au ${to}`],
      ['Monnaie de tenue', ctx.bookCurrency],
      [
        'Plan comptable',
        pack
          ? `${pack.slug} v${pack.version} (${ctx.pack?.status ?? 'inconnu'})`
          : 'aucun pack choisi',
      ],
      [
        'Versions des règles',
        ruleSetVersions.length > 0 ? ruleSetVersions.join(', ') : 'aucune règle validée',
      ],
      ['Mode', ctx.mode === 'simulation' ? 'SIMULATION — rien n’est enregistré' : 'Actif'],
    ];
    const base = {
      title: TITLES[body.kind],
      banner: env.banner,
      preamble,
      reserves: env.reserves.map((r) => ({ code: r.code, message: r.message })),
    };
    const done = (tables: ExportTable[]) => ({
      doc: { ...base, tables },
      ruleSetVersions,
      reserveCodes: env.reserves.map((r) => r.code),
    });

    switch (body.kind) {
      case 'entries': {
        const labels = Object.fromEntries(ctx.labels);
        const out = exportRows({
          entries: ctx.entries,
          mode: ctx.mode,
          bookCurrency: ctx.bookCurrency,
          from,
          to,
          chartPack: pack ?? { slug: 'aucun', version: 0 },
          journalLabels: ctx.journalLabels,
          accountLabels: labels,
          auxiliaryLabels: labels,
          reserves,
        });
        return {
          ...done([
            {
              title: TITLES.entries,
              notes: [out.header.formatNote],
              columns: EXPORT_COLUMNS.map((c) =>
                c === 'Debit' || c === 'Credit' || c === 'Montantdevise' ? A(c, c) : T(c, c),
              ),
              rows: out.rows,
            },
          ]),
          ruleSetVersions: out.header.ruleSetVersions,
        };
      }
      case 'trial-balance': {
        const tb = this.reporting.trialBalanceOf(ctx, from, to);
        return done([
          {
            title: TITLES['trial-balance'],
            notes: [
              tb.balanced ? 'Contrôle : débits = crédits.' : 'Contrôle : balance déséquilibrée.',
            ],
            columns: [
              T('accountNumber', 'Compte'),
              T('label', 'Libellé'),
              T('confirmation', 'Statut du compte'),
              A('openingDebit', 'À-nouveaux débit'),
              A('openingCredit', 'À-nouveaux crédit'),
              A('periodDebit', 'Mouvements débit'),
              A('periodCredit', 'Mouvements crédit'),
              A('closingDebit', 'Solde débiteur'),
              A('closingCredit', 'Solde créditeur'),
            ],
            rows: [
              ...tb.rows.map((r) => ({
                ...r,
                label: ctx.labels.get(r.accountNumber) ?? r.label,
              })),
              { accountNumber: 'Total', label: null, confirmation: null, ...tb.totals },
            ],
          },
        ]);
      }
      case 'auxiliary-balance': {
        const view = await this.reporting.auxiliaryBalanceFor(ctx, { from, to });
        return done([
          {
            title: TITLES['auxiliary-balance'],
            columns: [
              T('collectiveAccountNumber', 'Compte collectif'),
              T('auxiliaryKind', 'Nature'),
              T('auxiliaryAccountNumber', 'Compte auxiliaire'),
              T('label', 'Libellé'),
              A('openingBalance', 'Solde d’ouverture'),
              A('periodDebit', 'Mouvements débit'),
              A('periodCredit', 'Mouvements crédit'),
              A('closingBalance', 'Solde de clôture'),
              T('byCurrency', 'Soldes par devise de la pièce'),
              T('unletteredLineCount', 'Lignes non lettrées'),
            ],
            rows: view.groups.flatMap((g) =>
              g.rows.map((r) => ({
                ...r,
                auxiliaryKind:
                  g.auxiliaryKind === 'customer'
                    ? 'Client'
                    : g.auxiliaryKind === 'supplier'
                      ? 'Fournisseur'
                      : null,
                byCurrency: r.byCurrency.map((c) => `${c.balance} ${c.currency}`).join(' · '),
              })),
            ),
          },
        ]);
      }
      case 'ledger': {
        const view = await this.reporting.ledgerFor(ctx, { from, to });
        return done([
          {
            title: TITLES.ledger,
            columns: [
              T('accountNumber', 'Compte'),
              T('accountLabel', 'Libellé du compte'),
              T('date', 'Date'),
              T('journalCode', 'Journal'),
              T('number', 'Numéro'),
              T('label', 'Libellé'),
              T('auxiliaryAccountNumber', 'Compte auxiliaire'),
              A('debit', 'Débit'),
              A('credit', 'Crédit'),
              A('balance', 'Solde progressif'),
              A('amount', 'Montant en devise de la pièce'),
              T('currency', 'Devise'),
              T('letteringCode', 'Lettrage'),
              T('sourceNumber', 'Pièce'),
            ],
            rows: view.accounts.flatMap((a) => [
              {
                accountNumber: a.accountNumber,
                accountLabel: a.label,
                label: 'Solde d’ouverture',
                balance: a.openingBalance,
              },
              ...a.lines.map((l) => ({
                ...l,
                accountNumber: a.accountNumber,
                accountLabel: a.label,
              })),
            ]),
          },
        ]);
      }
      case 'statements': {
        const year = Number(from.slice(0, 4));
        const tables: ExportTable[] = [];
        for (const kind of ACCOUNTING_STATEMENT_KINDS) {
          const s = await this.statements.draftForRange(ctx, kind, from, to, year);
          tables.push({
            title: s.label,
            notes: [
              s.disclaimer,
              `Statut : ${s.status}`,
              ...(s.available
                ? []
                : [
                    'Non disponible : le modèle ou la méthode de cet état est une question posée à l’expert-comptable ; Lalanda ne le devine pas.',
                  ]),
            ],
            columns: [
              T('section', 'Section'),
              T('rubric', 'Rubrique'),
              T('toConfirm', 'À confirmer'),
              A('amount', 'Montant'),
            ],
            rows: [
              ...s.sections.flatMap((sec) => [
                ...sec.rubrics.map((r) => ({
                  section: sec.label,
                  rubric: r.label,
                  toConfirm: r.toConfirm ? 'À confirmer par l’expert-comptable' : '',
                  amount: r.amount,
                })),
                { section: sec.label, rubric: 'Total', toConfirm: '', amount: sec.total },
              ]),
              ...(s.result !== null
                ? [{ section: 'Résultat (projet)', rubric: '', toConfirm: '', amount: s.result }]
                : []),
            ],
          });
        }
        return done(tables);
      }
      case 'reserves':
        return done([
          {
            title: TITLES.reserves,
            columns: [T('code', 'Code'), T('message', 'Réserve'), T('details', 'Détails')],
            rows: reserveViews(reserves).map((r) => ({
              code: r.code,
              message: r.message,
              details: JSON.stringify(r.details),
            })),
          },
        ]);
    }
  }

  // ── Routes ───────────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    body: CreateAccountingExportBody,
    actor: AccountingActor,
  ): Promise<AccountingExportView> {
    const ctx = await this.reporting.context(organizationId, body.to, body.from);
    const { doc, ruleSetVersions, reserveCodes } = await this.document(ctx, body);
    let data: Buffer;
    if (body.format === 'csv') data = renderCsv(doc);
    else if (body.format === 'xlsx') data = await renderXlsx(doc);
    else {
      data = await this.pdf.render(renderHtml(doc), {
        margin: { top: '18mm', bottom: '16mm', left: '10mm', right: '10mm' },
        headerTemplate: pdfHeaderTemplate(doc.banner),
        footerTemplate: pdfFooterTemplate(doc.banner),
      });
    }
    const simulation = ctx.mode === 'simulation';
    const stem = `comptabilite-projet_${body.kind}_${body.from}_${body.to}`;
    const fileName = `${simulation ? 'SIMULATION_' : ''}${stem}.${body.format}`;
    const sha256 = createHash('sha256').update(data).digest('hex');
    const id = new Types.ObjectId();
    const expiresAt = new Date(Date.now() + ACCOUNTING_EXPORT_FILE_TTL_MS);
    await this.files.create({
      organizationId,
      exportId: id.toHexString(),
      data,
      expiresAt,
    });
    const created = await this.exports.create({
      _id: id,
      organizationId,
      kind: body.kind,
      format: body.format,
      from: body.from,
      to: body.to,
      mode: ctx.mode,
      simulation,
      fileName,
      contentType: CONTENT_TYPES[body.format]!,
      sha256,
      size: data.length,
      bookCurrency: ctx.bookCurrency,
      chartPack: ctx.settings.chartPack,
      ruleSetVersions,
      reserveCodes,
      createdBy: actor.userId,
      expiresAt,
      _schemaVersion: 1,
    });
    await this.audit.recordStrict({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.export.created',
      targetType: 'accounting_export',
      targetId: id.toHexString(),
      metadata: {
        kind: body.kind,
        format: body.format,
        from: body.from,
        to: body.to,
        simulation,
        sha256,
        size: data.length,
      },
    });
    return viewOf(created.toObject() as unknown as AccountingExportLean, true);
  }

  async list(organizationId: string): Promise<AccountingPage<AccountingExportView>> {
    const docs = await this.exports
      .find({ organizationId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .lean<AccountingExportLean[]>()
      .exec();
    const now = Date.now();
    return {
      items: docs.map((d) => viewOf(d, new Date(d.expiresAt).getTime() > now)),
      nextCursor: null,
    };
  }

  async file(
    organizationId: string,
    id: string,
    actor: AccountingActor,
  ): Promise<{ meta: AccountingExportLean; data: Buffer }> {
    if (!/^[0-9a-f]{24}$/i.test(id)) notFound('ACCOUNTING_EXPORT_NOT_FOUND', 'Export introuvable.');
    const meta = await this.exports
      .findOne({ _id: id, organizationId })
      .lean<AccountingExportLean>()
      .exec();
    if (!meta) notFound('ACCOUNTING_EXPORT_NOT_FOUND', 'Export introuvable.');
    const file = await this.files
      .findOne({ organizationId, exportId: id })
      .lean<AccountingExportFileLean>()
      .exec();
    if (!file || new Date(meta.expiresAt).getTime() <= Date.now()) {
      throw new HttpException(
        {
          code: 'ACCOUNTING_EXPORT_EXPIRED',
          message:
            'Ce fichier n’est plus conservé : son empreinte reste au journal. Préparez un export nouveau.',
        },
        HttpStatus.GONE,
      );
    }
    const data = Buffer.from((file.data as unknown as { buffer?: Buffer }).buffer ?? file.data);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'accounting.export.downloaded',
      targetType: 'accounting_export',
      targetId: id,
      metadata: { sha256: meta.sha256 },
    });
    return { meta, data };
  }
}
