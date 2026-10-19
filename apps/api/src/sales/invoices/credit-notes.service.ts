// Brouillon d'avoir prérempli depuis une facture d'origine — ADR-0023 § S25e.5.
//
// `POST /sales/invoices/:invoiceId/credit-notes` : `scope: 'remaining'` reprend
// toutes les quantités restant à créditer (calculées par le moteur,
// `remainingQuantities`), `'empty'` aucune ligne. Le brouillon est ensuite un
// document comme un autre (`PUT`, gel) ; les contrôles de quantités et de
// montants sont refaits au gel, dans sa transaction.

import { remainingQuantities } from '@lalanda/engine';
import { Inject, Injectable } from '@nestjs/common';

import { NormalizedInvoicingStateReader } from '../../fiscal/normalized-invoicing-state.reader.js';
import { assertCreditableOrigin, creditTypeFor, isZeroQuantity } from './credit-note-rules.js';
import { InvoiceDraftsService } from './invoice-drafts.service.js';
import type { CreditNoteNature, CreditNoteScope, InvoiceView } from './invoice.contract.js';
import type { InvoiceActor } from './invoice.types.js';
import type { LineInput } from './invoices.dto.js';
import { invoiceConflict } from './invoices.errors.js';

@Injectable()
export class CreditNotesService {
  constructor(
    @Inject(InvoiceDraftsService) private readonly drafts: InvoiceDraftsService,
    @Inject(NormalizedInvoicingStateReader) private readonly state: NormalizedInvoicingStateReader,
  ) {}

  async createFromOrigin(
    organizationId: string,
    originId: string,
    body: { nature: CreditNoteNature; scope: CreditNoteScope },
    actor: InvoiceActor,
  ): Promise<InvoiceView> {
    const origin = await this.drafts.requireOwn(organizationId, originId);
    const type = creditTypeFor(origin.type);
    if (type === null) {
      invoiceConflict(
        'CREDIT_NOTE_ORIGIN_TYPE',
        'Un avoir se rattache à une facture de vente ou d’acompte, pas à un autre avoir.',
        { originType: origin.type },
      );
    }
    const settings = await this.state.read(organizationId);
    assertCreditableOrigin(origin, {
      type,
      currency: origin.currency,
      priceMode: origin.priceMode,
      mode: settings.state === 'enabled' ? 'normalized' : 'standard',
      environment: settings.environment,
    });

    let lines: LineInput[] = [];
    if (body.nature !== 'RRR' && body.scope === 'remaining') {
      const remaining = remainingQuantities(
        origin.lines.map((l) => ({ index: l.index, quantity: l.quantity, unitPrice: l.unitPrice })),
        origin.credited ?? [],
      );
      lines = remaining
        .filter((r) => !isZeroQuantity(r.quantity))
        .map((r) => ({ source: 'origin', originLineIndex: r.lineIndex, quantity: r.quantity }));
      if (lines.length === 0) {
        invoiceConflict(
          'CREDIT_NOTE_NOTHING_REMAINING',
          'Toutes les quantités de cette facture ont déjà été créditées.',
        );
      }
    }

    return this.drafts.create(
      organizationId,
      {
        type,
        currency: origin.currency,
        priceMode: origin.priceMode,
        // Remplacé par l'instantané client de l'origine à la composition.
        customer: { customerId: null, walkInName: null },
        pointOfSaleId: origin.pointOfSaleId ?? null,
        lines,
        payments: [],
        comments: { A: null, C: null },
        creditNote: { nature: body.nature, originInvoiceId: String(origin._id) },
        showUsdCounterValue: origin.showUsdCounterValue ?? false,
      },
      actor,
    );
  }
}
