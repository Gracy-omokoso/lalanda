import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newObjectId } from '../storage/object-key.js';
import {
  AVATAR_URL_TTL_SECONDS,
  avatarUrlFor,
  mintAvatarToken,
  verifyAvatarToken,
} from './avatar-url.js';

const MAINTENANT = Date.parse('2026-08-10T12:00:00.000Z');

let secretInitial: string | undefined;

beforeEach(() => {
  secretInitial = process.env['AUTH_SECRET'];
  process.env['AUTH_SECRET'] = 'secret-de-test-32-octets-au-moins!!';
});

afterEach(() => {
  if (secretInitial === undefined) delete process.env['AUTH_SECRET'];
  else process.env['AUTH_SECRET'] = secretInitial;
});

describe('jeton d’URL d’avatar', () => {
  it('fait l’aller-retour sur un identifiant d’objet valide', () => {
    const id = newObjectId();
    expect(verifyAvatarToken(mintAvatarToken(id, MAINTENANT), MAINTENANT)).toBe(id);
  });

  it('refuse une signature forgée — sans la clé, aucun jeton ne se fabrique', () => {
    const id = newObjectId();
    const exp = Math.floor(MAINTENANT / 1000) + 3600;
    for (const forge of [
      `${id}.${exp}.`,
      `${id}.${exp}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
      `${id}.${exp}.x`,
      id,
      `${id}.${exp}`,
    ]) {
      expect(verifyAvatarToken(forge, MAINTENANT), forge).toBeNull();
    }
  });

  it('refuse un jeton dont l’identifiant a été substitué (photo d’autrui)', () => {
    // Le scénario réel : un appelant reçoit son propre jeton et remplace
    // l'identifiant par celui d'une autre photo. La signature ne suit pas.
    const mien = newObjectId();
    const autre = newObjectId();
    const [, exp, sig] = mintAvatarToken(mien, MAINTENANT).split('.') as [string, string, string];
    expect(verifyAvatarToken(`${autre}.${exp}.${sig}`, MAINTENANT)).toBeNull();
  });

  it('refuse une expiration repoussée par l’appelant', () => {
    const id = newObjectId();
    const [, , sig] = mintAvatarToken(id, MAINTENANT).split('.') as [string, string, string];
    const loin = Math.floor(MAINTENANT / 1000) + 10 * 365 * 24 * 3600;
    expect(verifyAvatarToken(`${id}.${loin}.${sig}`, MAINTENANT)).toBeNull();
  });

  it('expire, et pas une seconde plus tôt', () => {
    const id = newObjectId();
    const jeton = mintAvatarToken(id, MAINTENANT);
    const echeance = MAINTENANT + AVATAR_URL_TTL_SECONDS * 1000;
    expect(verifyAvatarToken(jeton, echeance - 1000)).toBe(id);
    expect(verifyAvatarToken(jeton, echeance)).toBeNull();
    expect(verifyAvatarToken(jeton, echeance + 60_000)).toBeNull();
  });

  it('refuse une forme d’identifiant qui n’en est pas une (traversée de chemin)', () => {
    // Sans ce filtre, un identifiant contrôlé par l'appelant deviendrait un
    // fragment de clé d'objet — et `../` remonterait dans le bucket.
    for (const mauvais of ['../../secret', 'avatars/x', '', 'z'.repeat(32)]) {
      const exp = Math.floor(MAINTENANT / 1000) + 3600;
      expect(verifyAvatarToken(`${mauvais}.${exp}.sig`, MAINTENANT)).toBeNull();
    }
  });

  it('est lié à AUTH_SECRET : un secret différent invalide le jeton', () => {
    const id = newObjectId();
    const jeton = mintAvatarToken(id, MAINTENANT);
    process.env['AUTH_SECRET'] = 'un-autre-secret-completement-different';
    expect(verifyAvatarToken(jeton, MAINTENANT)).toBeNull();
  });

  it('ne laisse pas fuir AUTH_SECRET dans le jeton', () => {
    process.env['AUTH_SECRET'] = 'VALEUR-SECRETE-RECONNAISSABLE-0123456789';
    const jeton = mintAvatarToken(newObjectId(), MAINTENANT);
    expect(jeton).not.toContain('VALEUR-SECRETE');
    // Contrôle anti-vacuité du détecteur : il repère bien la chaîne quand elle
    // est là.
    expect(`x${process.env['AUTH_SECRET']}x`).toContain('VALEUR-SECRETE');
  });

  it('refuse plutôt que de signer avec une valeur de repli quand AUTH_SECRET manque', () => {
    delete process.env['AUTH_SECRET'];
    expect(() => mintAvatarToken(newObjectId(), MAINTENANT)).toThrow(/AUTH_SECRET/);
  });

  it('construit une URL absolue sur API_URL', () => {
    const apiInitial = process.env['API_URL'];
    process.env['API_URL'] = 'https://api.lalanda.test/';
    const id = newObjectId();
    const url = avatarUrlFor(id, MAINTENANT);
    expect(url.startsWith('https://api.lalanda.test/account/avatar/')).toBe(true);
    expect(url).not.toContain('//account'); // slash final normalisé
    expect(verifyAvatarToken(url.split('/account/avatar/')[1]!, MAINTENANT)).toBe(id);
    if (apiInitial === undefined) delete process.env['API_URL'];
    else process.env['API_URL'] = apiInitial;
  });

  it('ne contient AUCUN identifiant d’utilisateur — seulement l’objet et la date', () => {
    const id = newObjectId();
    const jeton = mintAvatarToken(id, MAINTENANT);
    const [porte] = jeton.split('.') as [string];
    expect(porte).toBe(id);
    // Deux jetons frappés pour le MÊME objet à la même seconde sont identiques :
    // rien d'autre que l'objet et la date n'y entre.
    expect(mintAvatarToken(id, MAINTENANT)).toBe(jeton);
  });
});
