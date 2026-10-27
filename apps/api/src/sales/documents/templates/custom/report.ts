// Rapport de validation d'un paquet de modèle — ADR-0029 § 5.
//
// Chaque problème porte un CODE STABLE (documenté dans docs/modeles-facture/),
// un message en français qui dit quoi corriger, et, quand on le connaît, le
// fichier, la ligne et la colonne, et le cas de la batterie de rendu concerné.
// Le même rapport sert l'API (`422 TEMPLATE_PACKAGE_INVALID`) et la commande
// locale `modele:valider`.

export interface PackageIssue {
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  /** Cas de la batterie de rendu (« avoir », « document riche »…). */
  case?: string;
}

/** Au-delà, le rapport est tronqué : un paquet très fautif n'inonde pas la réponse. */
export const MAX_REPORTED_ISSUES = 100;

export class IssueList {
  readonly errors: PackageIssue[] = [];
  readonly warnings: PackageIssue[] = [];
  truncated = false;

  error(issue: PackageIssue): void {
    if (this.errors.length >= MAX_REPORTED_ISSUES) {
      this.truncated = true;
      return;
    }
    this.errors.push(issue);
  }

  warn(issue: PackageIssue): void {
    if (this.warnings.length < MAX_REPORTED_ISSUES) this.warnings.push(issue);
  }

  get ok(): boolean {
    return this.errors.length === 0;
  }
}

/** Position (1-based) d'un index dans un texte. */
export function positionOf(text: string, index: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      last = i;
    }
  }
  return { line, column: index - last };
}

/** Une ligne lisible par problème (commande locale). */
export function formatIssue(i: PackageIssue): string {
  const where = i.file
    ? `${i.file}${i.line !== undefined ? `:${i.line}${i.column !== undefined ? `:${i.column}` : ''}` : ''} — `
    : '';
  const cas = i.case ? ` [cas : ${i.case}]` : '';
  return `${where}${i.message} (${i.code})${cas}`;
}
