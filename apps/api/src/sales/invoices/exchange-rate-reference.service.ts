// Taux de référence USD → CDF — ADR-0023 § S25e.4 (1).
//
// Source par défaut : le taux officiel publié par la DGI, entrée `type: "USD"`
// du dernier instantané `currencyRates` de l'environnement
// (`edef_reference_snapshots`), avec sa date DGI conservée telle quelle
// (décalage horaire compris), `fetchedAt` et `sha256` de l'instantané. Le
// nombre JSON est lu par `decimalFromJsonRate` (moteur), jamais conservé en
// `number`.
//
// Indisponible si : aucun instantané, aucune entrée USD lisible, ou instantané
// relevé avant la veille (fuseau de Kinshasa).

import { decimalFromJsonRate, type DecimalString } from '@lalanda/engine';
import { Inject, Injectable } from '@nestjs/common';

import { EdefReferenceSnapshotsService } from '../../edef/edef-reference-snapshots.service.js';
import { NormalizedInvoicingStateReader } from '../../fiscal/normalized-invoicing-state.reader.js';
import type { DgiEnvironment, ExchangeRateReference } from './invoice.contract.js';
import { notFound } from './invoices.errors.js';

/** Tolérance du contrôle `curRate` : ±1 % du taux de référence (règle DGI). */
export const EXCHANGE_RATE_TOLERANCE_PERCENT: DecimalString = '1';

export interface ExchangeRateReferenceValue {
  rate: DecimalString;
  date: string;
  environment: DgiEnvironment;
  fetchedAt: Date;
  sha256: string;
}

const KINSHASA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Kinshasa',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Jour civil à Kinshasa, `AAAA-MM-JJ` (comparable comme chaîne). */
export function kinshasaDay(at: Date): string {
  return KINSHASA_DAY.format(at);
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ExchangeRateReferenceService {
  constructor(
    @Inject(EdefReferenceSnapshotsService)
    private readonly snapshots: EdefReferenceSnapshotsService,
    @Inject(NormalizedInvoicingStateReader) private readonly state: NormalizedInvoicingStateReader,
  ) {}

  /** Taux de référence de l'environnement, ou `null` s'il est indisponible. */
  async forEnvironment(
    environment: DgiEnvironment,
    now: Date = new Date(),
  ): Promise<ExchangeRateReferenceValue | null> {
    const snapshot = await this.snapshots.latest(environment, 'currencyRates');
    if (snapshot === null || !Array.isArray(snapshot.payload)) return null;
    // Relevé avant la veille : trop ancien pour servir de référence.
    if (kinshasaDay(snapshot.fetchedAt) < kinshasaDay(new Date(now.getTime() - ONE_DAY_MS))) {
      return null;
    }
    for (const entry of snapshot.payload as unknown[]) {
      if (entry === null || typeof entry !== 'object') continue;
      const { type, rate, date } = entry as Record<string, unknown>;
      if (typeof type !== 'string' || type.trim().toUpperCase() !== 'USD') continue;
      if (typeof rate !== 'number' || typeof date !== 'string' || date.trim() === '') continue;
      const decimal = decimalFromJsonRate(rate);
      if (decimal === null) continue;
      return {
        rate: decimal,
        date,
        environment,
        fetchedAt: snapshot.fetchedAt,
        sha256: snapshot.sha256,
      };
    }
    return null;
  }

  /** `GET /sales/exchange-rate-reference` : 404 si indisponible. */
  async view(organizationId: string): Promise<ExchangeRateReference> {
    const { environment } = await this.state.read(organizationId);
    const ref = await this.forEnvironment(environment);
    if (ref === null) {
      notFound(
        'EXCHANGE_RATE_REFERENCE_UNAVAILABLE',
        'Aucun taux de référence récent : rafraîchissez les listes du point de vente avant de normaliser.',
      );
    }
    return {
      currency: 'USD',
      rate: ref.rate,
      date: ref.date,
      source: 'dgi_snapshot',
      environment: ref.environment,
      fetchedAt: ref.fetchedAt.toISOString(),
      tolerancePercent: EXCHANGE_RATE_TOLERANCE_PERCENT,
    };
  }
}
