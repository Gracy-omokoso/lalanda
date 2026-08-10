// Lecture du corps binaire d'une requête, avec plafond appliqué PENDANT la lecture.
//
// ── Pourquoi pas `multer` ni `express.raw` ───────────────────────────────────
//
// Un seul fichier, un seul champ, aucun nom de fichier utile (il est écrit par
// le client et ne fait autorité sur rien — le type est déduit du contenu). Le
// multipart n'apporterait donc que son analyseur et ses dépendances. Le corps
// brut se lit en une vingtaine de lignes, et ces lignes font ce qu'aucune option
// de configuration ne fait aussi lisiblement : ABANDONNER dès l'octet de trop.
//
// ── Deux plafonds, et ils ne se remplacent pas ───────────────────────────────
//
// `Content-Length` est écrit par le CLIENT : il permet un refus immédiat et
// économique, mais il peut mentir — dans les deux sens. Le compteur sur le flux
// est le seul qui fasse autorité, parce qu'il compte les octets réellement
// reçus. Sans lui, un `Content-Length: 10` suivi de 4 Gio remplirait la mémoire
// du processus. Un test le vérifie.

import type { Readable } from 'node:stream';

export type BodyRead = { ok: true; body: Buffer } | { ok: false; reason: 'TOO_LARGE' | 'ABORTED' };

export function readRequestBody(
  req: Readable & { headers?: Record<string, unknown> },
  limitBytes: number,
): Promise<BodyRead> {
  // Refus économique sur l'annonce du client — jamais une autorisation.
  const annonce = Number(req.headers?.['content-length']);
  if (Number.isFinite(annonce) && annonce > limitBytes) {
    return Promise.resolve({ ok: false, reason: 'TOO_LARGE' });
  }

  return new Promise<BodyRead>((resolve) => {
    const morceaux: Buffer[] = [];
    let recus = 0;
    let termine = false;

    const conclure = (r: BodyRead): void => {
      if (termine) return;
      termine = true;
      resolve(r);
    };

    req.on('data', (morceau: Buffer) => {
      recus += morceau.length;
      if (recus > limitBytes) {
        // On coupe la connexion : continuer à lire pour « bien terminer » la
        // requête reviendrait à accepter d'ingérer autant que l'appelant en
        // envoie, c'est-à-dire à n'avoir aucun plafond.
        req.destroy();
        conclure({ ok: false, reason: 'TOO_LARGE' });
        return;
      }
      morceaux.push(morceau);
    });

    req.on('end', () => conclure({ ok: true, body: Buffer.concat(morceaux) }));
    req.on('error', () => conclure({ ok: false, reason: 'ABORTED' }));
    req.on('aborted', () => conclure({ ok: false, reason: 'ABORTED' }));
  });
}
