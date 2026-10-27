// Logique pure des modèles de facture sur mesure (ADR-0029) — testée sans DOM.

import type {
  InvoicePalette,
  InvoiceTemplateOptions,
  TemplatePackageIssue,
  TemplatePackageReport,
  TemplatePackageView,
} from '@/lib/api';

/** Options saisies pour un paquet ; `null` = suivre l'identité, puis le manifeste. */
export interface SelectionPaquet {
  palette: InvoicePalette | null;
  accent: string | null;
  font: string | null;
}

export const SELECTION_VIDE: SelectionPaquet = { palette: null, accent: null, font: null };

function semver(v: string): number[] {
  return v.split('.').map((n) => Number.parseInt(n, 10) || 0);
}

/** `a` avant `b` si sa version est plus RÉCENTE. */
export function compareVersionsDesc(a: string, b: string): number {
  const x = semver(a);
  const y = semver(b);
  for (let i = 0; i < 3; i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  }
  return 0;
}

export interface GroupeModele {
  templateId: string;
  name: string;
  versions: TemplatePackageView[];
}

/** Paquets regroupés par modèle (« editeur.nom »), versions de la plus récente à la plus ancienne. */
export function regrouperParModele(packages: readonly TemplatePackageView[]): GroupeModele[] {
  const groupes = new Map<string, TemplatePackageView[]>();
  for (const p of packages) groupes.set(p.templateId, [...(groupes.get(p.templateId) ?? []), p]);
  return [...groupes.entries()]
    .map(([templateId, versions]) => {
      const tri = [...versions].sort((a, b) => compareVersionsDesc(a.version, b.version));
      return { templateId, name: tri[0]!.name, versions: tri };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Options affichées : saisie, puis couleur et police de la marque, puis défaut du manifeste. */
export function optionsPaquet(
  p: TemplatePackageView,
  sel: SelectionPaquet,
  identite: { primaryColor: string | null; font: string | null },
): InvoiceTemplateOptions {
  const fonts = p.options.fonts.map((f) => f.id);
  const palette =
    sel.palette && p.options.palettes.includes(sel.palette)
      ? sel.palette
      : p.options.palettes.includes('brand')
        ? 'brand'
        : p.options.palettes[0]!;
  return {
    palette,
    accent: sel.accent ?? identite.primaryColor ?? p.options.accent,
    font:
      sel.font && fonts.includes(sel.font)
        ? sel.font
        : identite.font && fonts.includes(identite.font)
          ? identite.font
          : p.options.font,
  };
}

/** Une ligne lisible : « gabarit.html:12:5 — message (CODE) [cas : avoir] ». */
export function ligneProbleme(i: TemplatePackageIssue): string {
  const ou = i.file
    ? `${i.file}${i.line !== undefined ? `:${i.line}${i.column !== undefined ? `:${i.column}` : ''}` : ''} — `
    : '';
  return `${ou}${i.message} (${i.code})${i.case ? ` [cas : ${i.case}]` : ''}`;
}

/** Rapport de validation porté par une erreur `422 TEMPLATE_PACKAGE_INVALID`, sinon `null`. */
export function rapportDeRefus(err: unknown): TemplatePackageReport | null {
  const d = (err as { detail?: unknown } | null)?.detail as
    { code?: string; details?: { report?: TemplatePackageReport } } | undefined;
  return d?.code === 'TEMPLATE_PACKAGE_INVALID' && d.details?.report ? d.details.report : null;
}

/** Empreinte abrégée pour l'affichage (12 premiers caractères). */
export function empreinteCourte(sha256: string): string {
  return sha256.slice(0, 12);
}

/** Taille lisible. */
export function taille(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Kio`;
  return `${(octets / 1024 / 1024).toFixed(1).replace('.', ',')} Mio`;
}
