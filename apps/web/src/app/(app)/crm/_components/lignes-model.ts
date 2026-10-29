// Lignes d'articles d'une opportunité — ADR-0040 § 2.3 et § 2.6. Logique pure.
//
// La saisie est relue en chaînes décimales canoniques, sans aucune conversion en
// nombre : le montant estimé tiré des lignes est CALCULÉ PAR L'API (composition
// des devis, total hors taxes) et seulement affiché ici.

import type { OpportunityLine, OpportunityLineBody, OpportunityWarning } from '@/lib/api-crm';

export const MAX_LIGNES = 50;

export interface FormulaireLigne {
  catalogItemId: string | null;
  label: string;
  quantite: string;
  unite: string;
  /** Prix unitaire hors taxes ; `''` : sans prix. */
  prix: string;
  remise: string;
}

export function ligneVide(): FormulaireLigne {
  return { catalogItemId: null, label: '', quantite: '1', unite: '', prix: '', remise: '' };
}

const virgule = (v: string | null): string => (v === null ? '' : v.replace('.', ','));

export function formulaireLignes(lines: readonly OpportunityLine[]): FormulaireLigne[] {
  return lines.map((l) => ({
    catalogItemId: l.catalogItemId,
    label: l.label,
    quantite: virgule(l.quantity),
    unite: l.unit ?? '',
    prix: virgule(l.unitPrice),
    remise: virgule(l.discountPercent),
  }));
}

/** Lit un décimal saisi (« 1 234,5 ») : chaîne canonique, ou une erreur. */
export function lireDecimal(
  saisie: string,
  decimales: number,
): { ok: true; valeur: string } | { ok: false } {
  const s = saisie.replace(/[\s  ]/g, '').replace(',', '.');
  const motif = new RegExp(`^\\d{1,13}(\\.\\d{0,${decimales}})?$`);
  if (!motif.test(s)) return { ok: false };
  const [entier = '', dec = ''] = s.split('.');
  const e = entier.replace(/^0+(?=\d)/, '');
  const d = dec.replace(/0+$/, '');
  return { ok: true, valeur: d === '' ? e : `${e}.${d}` };
}

const estZero = (v: string): boolean => /^0+(\.0*)?$/.test(v);

export function preparerLignes(
  lignes: readonly FormulaireLigne[],
): { ok: true; corps: OpportunityLineBody[] } | { ok: false; erreurs: Record<number, string> } {
  const erreurs: Record<number, string> = {};
  if (lignes.length > MAX_LIGNES) {
    erreurs[MAX_LIGNES] = `${MAX_LIGNES} lignes au plus.`;
  }
  const corps = lignes.map((l, i): OpportunityLineBody => {
    const fautes: string[] = [];
    const label = l.label.trim();
    if (label === '' && l.catalogItemId === null) fautes.push('libellé obligatoire');
    if (label.length > 200) fautes.push('libellé : 200 caractères au plus');
    const q = lireDecimal(l.quantite, 3);
    if (!q.ok || estZero(q.valeur)) fautes.push('quantité positive (3 décimales au plus)');
    let unitPrice: string | null = null;
    if (l.prix.trim() !== '') {
      const p = lireDecimal(l.prix, 2);
      if (p.ok) unitPrice = p.valeur;
      else fautes.push('prix invalide (2 décimales au plus)');
    }
    let discountPercent: string | null = null;
    if (l.remise.trim() !== '') {
      const r = lireDecimal(l.remise.replace('%', ''), 2);
      if (!r.ok || (r.valeur.split('.')[0] ?? '').length > 2) {
        fautes.push('remise : 0 à moins de 100 %');
      } else discountPercent = r.valeur;
    }
    if (fautes.length > 0) erreurs[i] = `Ligne ${i + 1} : ${fautes.join(', ')}.`;
    return {
      catalogItemId: l.catalogItemId,
      label: label === '' ? null : label,
      quantity: q.ok ? q.valeur : '1',
      unit: l.unite.trim() === '' ? null : l.unite.trim(),
      unitPrice,
      discountPercent,
    };
  });
  return Object.keys(erreurs).length > 0 ? { ok: false, erreurs } : { ok: true, corps };
}

/** Avertissements d'écriture (§ 2.6) : une ligne sans prix compte pour zéro. */
export function messagesAvertissements(warnings: readonly OpportunityWarning[]): string[] {
  return warnings.map(
    (w) => `Ligne ${w.lineIndex + 1} sans prix : elle compte pour zéro dans le montant estimé.`,
  );
}
