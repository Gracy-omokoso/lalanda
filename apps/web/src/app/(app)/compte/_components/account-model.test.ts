// Tests de la logique pure de l'espace compte (S20b). Aucun DOM requis :
// vitest en environnement node suffit (cf. apps/web/vitest.config.ts).

import { describe, expect, it } from 'vitest';

import {
  COMMON_TIMEZONES,
  accountErrorMessage,
  formatSessionDate,
  profileIsDirty,
  timezoneOffsetLabel,
  timezoneOptions,
  validateEmail,
  validateName,
} from './account-model';

describe('timezoneOptions (S20b)', () => {
  it('renvoie la liste de référence quand rien n’est à ajouter', () => {
    expect(timezoneOptions('Africa/Kinshasa', 'Europe/Paris')).toEqual([...COMMON_TIMEZONES]);
  });

  it('ajoute le fuseau enregistré s’il sort de la liste — il ne doit jamais être perdu', () => {
    const options = timezoneOptions('Pacific/Auckland');
    expect(options).toContain('Pacific/Auckland');
    // La liste de référence reste en tête, l'ajout vient après.
    expect(options.slice(0, COMMON_TIMEZONES.length)).toEqual([...COMMON_TIMEZONES]);
  });

  it('ajoute le fuseau détecté par le navigateur', () => {
    expect(timezoneOptions('Africa/Kinshasa', 'Asia/Tokyo')).toContain('Asia/Tokyo');
  });

  it('ne produit aucun doublon, même si courant et détecté sont identiques', () => {
    const options = timezoneOptions('Asia/Tokyo', 'Asia/Tokyo');
    expect(options.filter((t) => t === 'Asia/Tokyo')).toHaveLength(1);
  });

  it('ignore les valeurs vides, nulles ou en espaces', () => {
    for (const value of [null, undefined, '', '   ']) {
      expect(timezoneOptions(value, value)).toEqual([...COMMON_TIMEZONES]);
    }
  });

  it('n’expose que des fuseaux IANA réellement résolubles', () => {
    for (const tz of COMMON_TIMEZONES) {
      expect(() => new Intl.DateTimeFormat('fr-FR', { timeZone: tz })).not.toThrow();
    }
  });
});

describe('timezoneOffsetLabel (S20b)', () => {
  it('donne un décalage UTC lisible', () => {
    // Kinshasa est à UTC+01:00 toute l'année (pas d'heure d'été).
    expect(timezoneOffsetLabel('Africa/Kinshasa', new Date('2026-01-15T12:00:00Z'))).toBe('UTC+01:00');
  });

  it('suit l’heure d’été là où elle existe', () => {
    const hiver = timezoneOffsetLabel('Europe/Paris', new Date('2026-01-15T12:00:00Z'));
    const ete = timezoneOffsetLabel('Europe/Paris', new Date('2026-07-15T12:00:00Z'));
    expect(hiver).toBe('UTC+01:00');
    expect(ete).toBe('UTC+02:00');
  });

  it('renvoie null sur un fuseau inconnu plutôt qu’un décalage inventé', () => {
    expect(timezoneOffsetLabel('Mars/Olympus_Mons')).toBeNull();
  });
});

describe('formatSessionDate (S20b)', () => {
  it('formate une date ISO dans le fuseau demandé', () => {
    const label = formatSessionDate('2026-03-10T08:30:00Z', 'Africa/Kinshasa');
    // 08:30 UTC → 09:30 à Kinshasa (UTC+1).
    expect(label).toContain('09:30');
  });

  it('rend une date différente selon le fuseau', () => {
    const iso = '2026-03-10T08:30:00Z';
    expect(formatSessionDate(iso, 'Africa/Kinshasa')).not.toBe(formatSessionDate(iso, 'Asia/Tokyo'));
  });

  it('dégrade sur le fuseau local plutôt que de casser, si le fuseau est invalide', () => {
    const label = formatSessionDate('2026-03-10T08:30:00Z', 'Mars/Olympus_Mons');
    expect(label).not.toBe('—');
    expect(label.length).toBeGreaterThan(0);
  });

  it('renvoie le tiret cadratin de docs/04 pour une date absente ou illisible', () => {
    expect(formatSessionDate('pas-une-date')).toBe('—');
    expect(formatSessionDate('')).toBe('—');
  });
});

describe('profileIsDirty (S20b)', () => {
  const saved = { name: 'Alice', locale: 'fr', timezone: 'Africa/Kinshasa' };

  it('est faux quand rien n’a changé', () => {
    expect(profileIsDirty({ ...saved }, saved)).toBe(false);
  });

  it('ignore les espaces de bord du nom — retaper un espace n’est pas une modification', () => {
    expect(profileIsDirty({ ...saved, name: '  Alice  ' }, saved)).toBe(false);
  });

  it('détecte un changement sur chacun des trois champs', () => {
    expect(profileIsDirty({ ...saved, name: 'Alicia' }, saved)).toBe(true);
    expect(profileIsDirty({ ...saved, timezone: 'Europe/Paris' }, saved)).toBe(true);
    expect(profileIsDirty({ ...saved, locale: 'en' }, saved)).toBe(true);
  });
});

describe('validateName / validateEmail (S20b)', () => {
  it('refuse un nom vide ou uniquement composé d’espaces', () => {
    expect(validateName('')).not.toBeNull();
    expect(validateName('   ')).not.toBeNull();
  });

  it('refuse un nom au-delà de 120 caractères — même borne que zod côté API', () => {
    expect(validateName('a'.repeat(120))).toBeNull();
    expect(validateName('a'.repeat(121))).not.toBeNull();
  });

  it('accepte un nom normal', () => {
    expect(validateName('Alice Compte')).toBeNull();
  });

  it('refuse une adresse manifestement incomplète', () => {
    for (const value of ['', 'alice', 'alice@', '@exemple.com', 'alice@exemple']) {
      expect(validateEmail(value)).not.toBeNull();
    }
  });

  it('accepte une adresse plausible', () => {
    expect(validateEmail('alice@exemple.com')).toBeNull();
    expect(validateEmail('  alice@exemple.com  ')).toBeNull();
  });
});

describe('accountErrorMessage (S20b)', () => {
  it('traduit les codes métier de l’API', () => {
    expect(accountErrorMessage({ code: 'INVALID_PASSWORD' }, 'x')).toContain('Mot de passe');
    expect(accountErrorMessage({ code: 'EMAIL_TAKEN' }, 'x')).toContain('déjà utilisée');
    expect(accountErrorMessage({ code: 'SESSION_NOT_FOUND' }, 'x')).toContain('n’existe plus');
  });

  it('retombe sur le message de l’API pour un code non traduit', () => {
    expect(accountErrorMessage({ code: 'LAST_OWNER', message: 'Message serveur' }, 'x')).toBe(
      'Message serveur',
    );
  });

  it('retombe sur le message par défaut quand il n’y a rien d’exploitable', () => {
    expect(accountErrorMessage(undefined, 'Échec')).toBe('Échec');
    expect(accountErrorMessage({}, 'Échec')).toBe('Échec');
  });
});
