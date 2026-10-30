// Aperçu d'un document de vente et envoi par e-mail — règles d'affichage (ADR-0042).
//
// Pur : aucune requête, aucun DOM. L'API reste juge (droit, document envoyable,
// adresses) ; ces fonctions évitent un aller-retour inutile et disent la raison
// d'un bouton désactivé.

import type { DocumentEmailInput, DocumentEmailResult } from '@/lib/api';

export type GenreDocument = 'facture' | 'devis';

/** Même borne que l'API (`z.email()` est plus strict ; elle tranche). */
const ADRESSE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function adresseValide(v: string): boolean {
  const t = v.trim();
  return t.length > 0 && t.length <= 254 && ADRESSE.test(t);
}

/** « a@b.cd, c@d.cd ; e@f.cd » → liste, sans vides. */
export function lireCopies(v: string): string[] {
  return v
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

export interface FormulaireEnvoi {
  to: string;
  cc: string;
  subject: string;
  message: string;
}

export type ErreursEnvoi = Partial<Record<keyof FormulaireEnvoi, string>>;

/** Vérification locale du formulaire ; `null` quand il est envoyable. */
export function verifierEnvoi(f: FormulaireEnvoi): {
  erreurs: ErreursEnvoi;
  corps: DocumentEmailInput | null;
} {
  const erreurs: ErreursEnvoi = {};
  if (!adresseValide(f.to)) erreurs.to = 'Saisissez une adresse e-mail valide.';
  const cc = lireCopies(f.cc);
  if (cc.length > 5) erreurs.cc = 'Cinq adresses en copie au plus.';
  else if (cc.some((c) => !adresseValide(c))) erreurs.cc = 'Une adresse en copie est invalide.';
  else {
    const vues = new Set([f.to.trim().toLowerCase()]);
    for (const c of cc) {
      if (vues.has(c.toLowerCase())) {
        erreurs.cc = 'Une adresse figure deux fois.';
        break;
      }
      vues.add(c.toLowerCase());
    }
  }
  const sujet = f.subject.trim();
  if (sujet === '') erreurs.subject = 'L’objet est obligatoire.';
  else if (sujet.length > 200) erreurs.subject = 'L’objet dépasse 200 caractères.';
  if (f.message.length > 5000) erreurs.message = 'Le message dépasse 5 000 caractères.';
  if (Object.keys(erreurs).length > 0) return { erreurs, corps: null };
  return {
    erreurs,
    corps: { to: f.to.trim(), cc, subject: sujet, message: f.message },
  };
}

/** Raison affichée quand le droit d'envoyer manque (ADR-0042 § 1). */
export function raisonSansDroit(genre: GenreDocument): string {
  return genre === 'facture'
    ? 'Envoi réservé aux rôles qui émettent les factures (droit « Émettre et normaliser »).'
    : 'Envoi réservé aux rôles qui préparent les devis.';
}

/** Phrase de confirmation avant envoi. */
export function phraseConfirmation(corps: DocumentEmailInput, fichier: string | null): string {
  const copie = corps.cc.length > 0 ? ` (copie : ${corps.cc.join(', ')})` : '';
  return `Envoyer ${fichier ?? 'le document'} à ${corps.to}${copie} ?`;
}

/** Message de résultat d'un envoi abouti côté API. */
export function messageResultat(r: DocumentEmailResult): { ok: boolean; texte: string } {
  if (r.delivered) {
    const copie = r.cc.length > 0 ? `, copie à ${r.cc.join(', ')}` : '';
    return { ok: true, texte: `E-mail envoyé à ${r.to}${copie}.` };
  }
  switch (r.reason) {
    case 'MAIL_NOT_CONFIGURED':
      return {
        ok: false,
        texte: 'L’envoi d’e-mails n’est pas configuré sur ce serveur : rien n’est parti.',
      };
    default:
      return {
        ok: false,
        texte: 'Le service d’envoi a refusé le message : rien n’est parti. Réessayez plus tard.',
      };
  }
}

/** Message d'une erreur HTTP de l'envoi (400, 403, 404, 409, 429…). */
export function messageErreurEnvoi(err: unknown): string {
  if (typeof err !== 'object' || err === null) return 'Envoi impossible.';
  const e = err as { status?: unknown; detail?: unknown; message?: unknown };
  const detail = (typeof e.detail === 'object' && e.detail !== null ? e.detail : {}) as {
    code?: unknown;
    message?: unknown;
  };
  if (e.status === 403) return 'Votre rôle ne permet pas d’envoyer ce document.';
  if (e.status === 404) return 'Document introuvable.';
  if (detail.code === 'INVALID_REQUEST') return 'Vérifiez les adresses, l’objet et le message.';
  if (typeof detail.message === 'string' && detail.message !== '') return detail.message;
  return 'Envoi impossible.';
}

/**
 * L'iframe affichera-t-elle le PDF ? `navigator.pdfViewerEnabled` est `false`
 * sur les navigateurs sans lecteur intégré (la plupart des téléphones Android) :
 * on propose alors « Ouvrir le PDF ». Absent (anciens navigateurs) : on essaie.
 */
export function lecteurPdfIntegre(nav: { pdfViewerEnabled?: boolean } | undefined): boolean {
  return nav?.pdfViewerEnabled !== false;
}
