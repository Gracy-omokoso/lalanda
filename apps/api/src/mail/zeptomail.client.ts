// Client ZeptoMail (Zoho) — S22m, ADR-0014 § Envoi par API.
//
// ── Pourquoi PAS le paquet `zeptomail` de Zoho ───────────────────────────────
//
// Deux raisons, et la seconde suffirait seule.
//
//  1. `registry.npmjs.org` est injoignable depuis le poste de développement
//     (IPv6 non routé) : `pnpm add zeptomail` échoue en ETIMEDOUT. Le dépôt a
//     déjà ce réflexe — `storage/sigv4.ts` parle SigV4 à la main plutôt que
//     d'importer `@aws-sdk`, et `integrations/connection-tests.ts` explique
//     pourquoi.
//  2. Le `SendMailClient` de Zoho n'est qu'une enveloppe autour d'un POST JSON.
//     ADR-0013 §10 nomme la chaîne d'approvisionnement npm comme « le maillon
//     faible » du dispositif de secrets : ajouter un arbre de dépendances au
//     processus qui détient `SECRETS_MASTER_KEY` pour économiser dix lignes
//     serait un mauvais échange.
//
// Si le paquet devient installable et que l'API se complique (pièces jointes,
// gabarits Zoho, lots), la décision se rediscutera à ce moment-là et pour cet
// usage-là. Le point d'attache est ce fichier, et lui seul.
//
// ── Ce qui n'apparaît JAMAIS dans une exception levée d'ici ───────────────────
// docs/17 § Journalisation. Le jeton ne figure dans aucun message : il ne voyage
// que dans l'en-tête `Authorization`. Les messages d'erreur reprennent le code
// HTTP et le texte rendu par Zoho, jamais la requête émise.

import type { MailMessage, ZeptoMailCredentials } from './mail.types.js';

/** Route d'envoi par défaut. Zoho expose aussi `.eu` et `.in` — voir `apiUrl`. */
export const ZEPTOMAIL_DEFAULT_API_URL = 'https://api.zeptomail.com/v1.1/email';

/**
 * Préfixe imposé par Zoho dans l'en-tête `Authorization` : ni `Bearer`, ni `Basic`.
 *
 * La console Zoho affiche la ligne d'en-tête ENTIÈRE, préfixe compris. Un
 * opérateur qui copie ce qu'il voit colle donc souvent « Zoho-enczapikey wSsV… »
 * dans la variable d'environnement. `normaliserJeton` retire le préfixe s'il est
 * là : le doubler produit un 401 que personne ne relie à un copier-coller.
 */
const AUTH_PREFIX = 'Zoho-enczapikey';

/**
 * Délai maximal d'un envoi.
 *
 * Sans plafond, une API muette retient la requête HTTP qui a déclenché l'email —
 * une inscription resterait en attente derrière un incident Zoho. Dix secondes :
 * au-delà, l'envoi est compté en échec, journalisé, et l'opération métier
 * continue (ADR-0014 § « Aucune méthode ne lève sur échec d'envoi »).
 */
export const ZEPTOMAIL_TIMEOUT_MS = 10_000;

/** Jeton nu, que l'opérateur ait collé le jeton seul ou la ligne d'en-tête entière. */
export function normaliserJeton(brut: string): string {
  const t = brut.trim();
  return t.toLowerCase().startsWith(`${AUTH_PREFIX.toLowerCase()} `)
    ? t.slice(AUTH_PREFIX.length + 1).trim()
    : t;
}

/** Adresse et nom affichés, extraits d'un expéditeur au format `"Nom <adresse>"`. */
export interface Expediteur {
  address: string;
  name: string;
}

/**
 * Découpe `"Lalanda <no-reply@lalanda.co>"` en `{ name, address }`.
 *
 * ZeptoMail veut les deux SÉPARÉS, là où SMTP accepte la forme composée. La
 * conversion vit ici plutôt que dans le fournisseur d'identifiants pour qu'une
 * seule variable (`MAIL_FROM`) serve les deux chemins : deux variables pour la
 * même adresse finiraient par diverger, et l'expéditeur affiché dépendrait alors
 * du transport en vigueur — écart invisible en développement, visible par les
 * destinataires en production.
 *
 * Sans chevrons, la chaîne entière est prise pour l'adresse et le nom reste vide :
 * `SMTP_FROM=no-reply@lalanda.co` est une configuration légitime.
 */
export function decouperExpediteur(from: string): Expediteur {
  const m = /^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/.exec(from);
  if (m) return { name: (m[1] ?? '').replace(/^"|"$/g, '').trim(), address: m[2] ?? '' };
  return { name: '', address: from.trim() };
}

/**
 * Remet un message à l'API ZeptoMail.
 *
 * LÈVE en cas d'échec — jeton refusé, erreur d'API, panne réseau, délai dépassé.
 * C'est délibéré : la décision de ne pas faire tomber l'opération métier
 * appartient au transport (`mail.transport.ts`), qui journalise et retourne
 * `delivered: false`. Une fonction qui avalerait l'erreur ici priverait le
 * transport de ce qu'il doit écrire dans les journaux.
 */
export async function envoyerViaZeptoMail(
  creds: ZeptoMailCredentials,
  message: MailMessage,
): Promise<void> {
  const from = decouperExpediteur(creds.from);

  const res = await fetch(creds.apiUrl, {
    method: 'POST',
    headers: {
      authorization: `${AUTH_PREFIX} ${normaliserJeton(creds.token)}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      from: { address: from.address, name: from.name || 'Lalanda' },
      to: [{ email_address: { address: message.to } }],
      subject: message.subject,
      htmlbody: message.html,
      // La variante texte est transmise, pas seulement le HTML : ADR-0014 §2
      // impose « une variante texte COMPLÈTE lien compris ». La perdre ici
      // rendrait les emails illisibles pour un client qui refuse le HTML, sans
      // qu'aucun test de gabarit ne s'en aperçoive — les gabarits, eux, la
      // produiraient toujours.
      textbody: message.text,
    }),
    signal: AbortSignal.timeout(ZEPTOMAIL_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await messageDErreur(res);
    throw new Error(
      `ZeptoMail a refusé l'envoi (HTTP ${res.status}${detail ? ` : ${detail}` : ''})`,
    );
  }
}

/** Texte d'erreur rendu par Zoho, borné, ou chaîne vide si la réponse est illisible. */
async function messageDErreur(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown; code?: unknown } };
    const code = typeof body.error?.code === 'string' ? body.error.code : '';
    const message = typeof body.error?.message === 'string' ? body.error.message : '';
    // Borné à 200 caractères : ce texte part dans les journaux, et une réponse
    // d'API n'a aucune raison d'y déverser un pavé.
    return [code, message].filter(Boolean).join(' — ').slice(0, 200);
  } catch {
    // Une réponse non-JSON ne doit pas masquer l'échec : le code HTTP a déjà été
    // capturé par l'appelant, le corps n'était qu'un confort de diagnostic.
    return '';
  }
}
