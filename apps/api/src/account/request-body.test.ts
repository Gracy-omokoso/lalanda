import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { readRequestBody } from './request-body.js';

/** Flux minimal imitant une requête : des morceaux, et des en-têtes qui mentent. */
function requete(morceaux: Buffer[], headers: Record<string, unknown> = {}): Readable & {
  headers: Record<string, unknown>;
} {
  const flux = Readable.from(morceaux) as Readable & { headers: Record<string, unknown> };
  flux.headers = headers;
  return flux;
}

describe('lecture du corps avec plafond', () => {
  it('lit un corps normal en entier', async () => {
    const r = await readRequestBody(requete([Buffer.from('abc'), Buffer.from('def')]), 100);
    expect(r.ok && r.body.toString()).toBe('abcdef');
  });

  it('refuse immédiatement sur un Content-Length au-delà du plafond', async () => {
    // Refus économique : aucun octet n'est lu.
    const r = await readRequestBody(requete([Buffer.alloc(1)], { 'content-length': '99999' }), 100);
    expect(r).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });

  it('refuse un corps trop gros MALGRÉ un Content-Length menteur', async () => {
    // Le cœur du test : `Content-Length: 10` annoncé, 4 Mio envoyés. Sans le
    // compteur sur le flux, le processus ingérerait tout ce qu'on lui envoie.
    const r = await readRequestBody(
      requete([Buffer.alloc(1024), Buffer.alloc(4 * 1024 * 1024)], { 'content-length': '10' }),
      2048,
    );
    expect(r).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });

  it('refuse un corps trop gros SANS Content-Length du tout', async () => {
    const r = await readRequestBody(requete([Buffer.alloc(5000)]), 2048);
    expect(r).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });

  it('abandonne dès l’octet de trop, sans consommer la suite', async () => {
    let morceauxLus = 0;
    const gros = Array.from({ length: 50 }, () => Buffer.alloc(1024));
    const flux = new Readable({
      read() {
        morceauxLus += 1;
        this.push(gros.shift() ?? null);
      },
    }) as Readable & { headers: Record<string, unknown> };
    flux.headers = {};

    const r = await readRequestBody(flux, 2048);
    expect(r).toEqual({ ok: false, reason: 'TOO_LARGE' });
    // Garde anti-vacuité : si tout avait été lu, ce compteur vaudrait ~50.
    expect(morceauxLus).toBeLessThan(10);
  });

  it('accepte exactement le plafond, refuse le plafond + 1', async () => {
    expect((await readRequestBody(requete([Buffer.alloc(100)]), 100)).ok).toBe(true);
    expect((await readRequestBody(requete([Buffer.alloc(101)]), 100)).ok).toBe(false);
  });

  it('rend un corps vide plutôt que d’échouer sur une requête sans corps', async () => {
    // Le refus du fichier vide appartient à la validation, pas à la lecture.
    const r = await readRequestBody(requete([]), 100);
    expect(r.ok && r.body.length).toBe(0);
  });

  it('signale une connexion interrompue', async () => {
    const flux = new Readable({
      read() {
        this.destroy(new Error('connexion perdue'));
      },
    }) as Readable & { headers: Record<string, unknown> };
    flux.headers = {};
    expect(await readRequestBody(flux, 100)).toEqual({ ok: false, reason: 'ABORTED' });
  });
});
