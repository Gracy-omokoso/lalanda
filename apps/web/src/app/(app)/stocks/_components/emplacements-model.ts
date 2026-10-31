// Emplacements — ADR-0046 § 2.2. Logique pure : formulaire (fenêtre modale,
// `stock.manage`) et gestes. À plat : ni allées ni casiers (décision ouverte n° 8).

import { STOCK_LIMITS } from '@lalanda/shared/stock';

import type { OrgAction } from '@/lib/api';
import type { StockLocationInput, StockLocationKind, StockLocationView } from '@/lib/api-stock';

import { peutGererStocks } from './stocks-model';

export interface FormulaireEmplacement {
  name: string;
  kind: StockLocationKind;
  address: string;
  responsibleUserId: string;
}

export function formulaireEmplacement(l: StockLocationView | null): FormulaireEmplacement {
  return {
    name: l?.name ?? '',
    kind: l?.kind ?? 'warehouse',
    address: l?.address ?? '',
    responsibleUserId: l?.responsibleUserId ?? '',
  };
}

export function preparerEmplacement(
  f: FormulaireEmplacement,
): { ok: true; corps: StockLocationInput } | { ok: false; champs: Record<string, string> } {
  const champs: Record<string, string> = {};
  const name = f.name.trim();
  if (name === '') champs['name'] = 'Le nom de l’emplacement est obligatoire.';
  else if (name.length > STOCK_LIMITS.locationName) champs['name'] = '120 caractères au plus.';
  if (f.address.trim().length > STOCK_LIMITS.locationAddress) {
    champs['address'] = '300 caractères au plus.';
  }
  if (Object.keys(champs).length > 0) return { ok: false, champs };
  return {
    ok: true,
    corps: {
      name,
      kind: f.kind,
      address: f.address.trim() === '' ? null : f.address.trim(),
      responsibleUserId: f.responsibleUserId === '' ? null : f.responsibleUserId,
    },
  };
}

export const RAISON_EMPLACEMENT_DEFAUT =
  'L’emplacement par défaut reçoit les entrées automatiques : il ne s’archive pas.';

export interface GesteEmplacement {
  id: 'modifier' | 'archiver';
  libelle: string;
  actif: boolean;
  raison: string | null;
}

/** Gestes sur un emplacement (`stock.manage`) ; l'API refuse s'il reste du stock. */
export function gestesEmplacement(
  l: StockLocationView,
  actions: readonly OrgAction[] | null,
): GesteEmplacement[] {
  if (!peutGererStocks(actions)) return [];
  return [
    { id: 'modifier', libelle: 'Modifier', actif: true, raison: null },
    {
      id: 'archiver',
      libelle: 'Archiver',
      actif: !l.isDefault,
      raison: l.isDefault ? RAISON_EMPLACEMENT_DEFAUT : null,
    },
  ];
}
