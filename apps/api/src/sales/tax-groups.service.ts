// Liste des groupes de taxation proposée par le catalogue — ADR-0022 § S25c.4, § O5.
//
// 1. environnement DGI de l'organisation (`test` par défaut) ;
// 2. dernier instantané `taxGroups` de CET environnement : les lettres A à P
//    présentes, avec leur taux ;
// 3. sinon, la liste par défaut sourcée et datée (`DEFAULT_TAX_GROUPS`), SANS
//    aucun taux (ADR-0019 : un taux n'est jamais codé en dur).
//
// Le catalogue n'a besoin que de la lettre ; le taux n'intervient qu'au calcul
// de la facture (S25e), qui figera alors son propre instantané.

import {
  DEFAULT_TAX_GROUPS,
  type ItemType,
  type TaxGroupDefinition,
  type TaxGroupLetter,
} from '@lalanda/engine';
import { Inject, Injectable } from '@nestjs/common';

import { EdefReferenceSnapshotsService } from '../edef/edef-reference-snapshots.service.js';
import { NormalizedInvoicingStateReader } from '../fiscal/normalized-invoicing-state.reader.js';
import type { EdefEnvironment } from '../platform-config/dgi-platform.config.js';

export interface TaxGroupView {
  letter: TaxGroupLetter;
  label: string;
  /** Taux en %, chaîne décimale ; `null` quand `source = "default"`. */
  ratePercent: string | null;
  itemTypes: ItemType[];
  outOfScopeAllowed: boolean;
}

export interface TaxGroupList {
  source: 'dgi_snapshot' | 'default';
  environment: EdefEnvironment;
  fetchedAt: string | null;
  sha256: string | null;
  groups: TaxGroupView[];
}

/**
 * Taux reçu de la DGI (nombre JSON, entier ou décimal) → chaîne décimale, par
 * sa représentation la plus courte. `null` si la valeur n'est pas un décimal
 * positif ordinaire (négatif, non fini, notation exponentielle) : le groupe
 * n'est alors pas proposé plutôt que proposé avec un taux douteux.
 */
export function rateFromSnapshot(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const s = String(value);
  return /^\d+(\.\d+)?$/.test(s) ? s : null;
}

function view(def: TaxGroupDefinition, ratePercent: string | null): TaxGroupView {
  return {
    letter: def.letter,
    label: def.label,
    ratePercent,
    itemTypes: [...def.itemTypes],
    outOfScopeAllowed: def.outOfScopeAllowed,
  };
}

@Injectable()
export class TaxGroupsService {
  constructor(
    @Inject(NormalizedInvoicingStateReader) private readonly state: NormalizedInvoicingStateReader,
    @Inject(EdefReferenceSnapshotsService)
    private readonly snapshots: EdefReferenceSnapshotsService,
  ) {}

  async list(organizationId: string): Promise<TaxGroupList> {
    const { environment } = await this.state.read(organizationId);
    const snapshot = await this.snapshots.latest(environment, 'taxGroups');
    const payload =
      snapshot && snapshot.payload !== null && typeof snapshot.payload === 'object'
        ? (snapshot.payload as Record<string, unknown>)
        : null;

    if (snapshot === null || payload === null) {
      return {
        source: 'default',
        environment,
        fetchedAt: null,
        sha256: null,
        groups: DEFAULT_TAX_GROUPS.map((def) => view(def, null)),
      };
    }

    const groups: TaxGroupView[] = [];
    for (const def of DEFAULT_TAX_GROUPS) {
      // Les clés de l'instantané sont des lettres minuscules (`TaxGroupsSchema`).
      const rate = rateFromSnapshot(payload[def.letter.toLowerCase()]);
      if (rate !== null) groups.push(view(def, rate));
    }
    return {
      source: 'dgi_snapshot',
      environment,
      fetchedAt: snapshot.fetchedAt.toISOString(),
      sha256: snapshot.sha256,
      groups,
    };
  }

  /** Lettres proposées en ce moment à l'organisation. */
  async availableLetters(organizationId: string): Promise<ReadonlySet<TaxGroupLetter>> {
    const list = await this.list(organizationId);
    return new Set(list.groups.map((g) => g.letter));
  }
}
