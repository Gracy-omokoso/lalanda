// Logique pure du choix du modèle de facture (ADR-0028 § 8) — testée sans DOM.
//
// Le serveur résout et fige les options (saisie, puis identité, puis défaut du
// modèle) ; `optionsAffichees` reproduit cette règle pour l'affichage seulement.

import type {
  InvoicePalette,
  InvoiceTemplateCatalogEntry,
  InvoiceTemplateId,
  InvoiceTemplateOptions,
  InvoiceTemplatesView,
  PutInvoiceTemplateInput,
} from '@/lib/api';

export const PALETTE_LABELS: Record<InvoicePalette, string> = {
  brand: 'Couleurs de la marque',
  mono: 'Noir et blanc',
};

/** Choix en cours d'édition ; `null` = suivre l'identité, puis le défaut du modèle. */
export interface SelectionModele {
  templateId: InvoiceTemplateId | null;
  palette: InvoicePalette | null;
  accent: string | null;
  font: string | null;
}

export function selectionInitiale(v: InvoiceTemplatesView): SelectionModele {
  if (!v.current) return { templateId: null, palette: null, accent: null, font: null };
  return {
    templateId: v.current.templateId,
    palette: v.current.options.palette,
    accent: v.current.options.accent,
    font: v.current.options.font,
  };
}

/**
 * Changer de modèle remet les options à « suivre » : une police d'un modèle
 * (paire d'Éditoriale) n'existe pas dans un autre. On garde la saisie du modèle
 * enregistré si l'on y revient.
 */
export function choisirModele(
  v: InvoiceTemplatesView,
  id: InvoiceTemplateId | null,
): SelectionModele {
  if (id !== null && v.current?.templateId === id) return selectionInitiale(v);
  return { templateId: id, palette: null, accent: null, font: null };
}

export function optionsAffichees(
  sel: SelectionModele,
  entry: InvoiceTemplateCatalogEntry,
  identity: InvoiceTemplatesView['identity'],
): InvoiceTemplateOptions {
  const fonts = entry.fonts.map((f) => f.id);
  return {
    palette: sel.palette ?? entry.defaults.palette,
    accent: sel.accent ?? identity.primaryColor ?? entry.defaults.accent,
    font:
      sel.font && fonts.includes(sel.font)
        ? sel.font
        : identity.font && fonts.includes(identity.font)
          ? identity.font
          : entry.defaults.font,
  };
}

export function estModifiee(sel: SelectionModele, v: InvoiceTemplatesView): boolean {
  const ref = selectionInitiale(v);
  return (
    sel.templateId !== ref.templateId ||
    sel.palette !== ref.palette ||
    sel.accent !== ref.accent ||
    sel.font !== ref.font
  );
}

export function versEnvoi(sel: SelectionModele, revision: number): PutInvoiceTemplateInput {
  return {
    templateId: sel.templateId,
    options:
      sel.templateId === null
        ? { palette: null, accent: null, font: null }
        : { palette: sel.palette, accent: sel.accent, font: sel.font },
    expectedRevision: revision,
  };
}

/** Clé d'un aperçu : même clé ⇒ même image (inutile de la redemander). */
export function cleApercu(id: InvoiceTemplateId, o: Partial<InvoiceTemplateOptions>): string {
  return [id, o.palette ?? '', o.accent ?? '', o.font ?? ''].join('|');
}
