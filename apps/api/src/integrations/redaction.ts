// Passe de rédaction des messages fournisseur — ADR-0013 §4, dernier point.
//
// « Les API renvoient parfois la clé dans le message. » Stripe le fait
// (`Invalid API Key provided: sk_live_****`), OpenAI aussi selon les erreurs, et
// un transport SMTP recopie volontiers l'identifiant complet. Sans cette passe,
// un secret invalide ressortirait dans `lastTest.detail`, donc dans la vue de
// lecture — et donc par l'API, exactement ce que le contrat d'écriture seule
// interdit.
//
// Cette passe est la DERNIÈRE barrière, pas la seule : elle ne connaît que les
// secrets qu'on lui donne. C'est pourquoi les messages externes sont en plus
// tronqués et normalisés avant d'être stockés.

import { REDACTED } from './secret-value.js';

/** Longueur maximale d'un `detail` conservé — un message long est un vecteur. */
export const MAX_DETAIL_LENGTH = 300;

/**
 * Remplace toute occurrence d'un secret connu par `[redacted]`.
 *
 * Les valeurs de moins de 8 caractères sont ignorées : remplacer une chaîne de
 * 3 caractères dans un message la mutilerait sans rien protéger (le fragment est
 * trop court pour être une clé) et rendrait le message illisible.
 */
export function redactSecrets(message: string, secrets: readonly string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    out = out.split(secret).join(REDACTED);
  }
  return out;
}

/**
 * Assainit un message d'erreur externe avant journalisation ou stockage :
 * rédaction des secrets connus, aplatissement des sauts de ligne, troncature.
 *
 * L'aplatissement n'est pas cosmétique : une trace de pile multi-ligne stockée
 * dans `lastTest.detail` révélerait des chemins de fichiers serveur et des noms
 * de dépendances — de la reconnaissance offerte à qui accède à `/admin`.
 */
export function sanitizeProviderMessage(raw: unknown, secrets: readonly string[]): string {
  const text =
    raw instanceof Error
      ? raw.message
      : typeof raw === 'string'
        ? raw
        : (JSON.stringify(raw) ?? '');
  const flattened = text.replace(/\s+/g, ' ').trim();
  const redacted = redactSecrets(flattened, secrets);
  return redacted.length > MAX_DETAIL_LENGTH
    ? `${redacted.slice(0, MAX_DETAIL_LENGTH)}…`
    : redacted;
}
