// Onglet Fiscalité (S25b — ADR-0021 §13, chantier C).
//
// Codé contre le CONTRAT §10 : les réponses de l'API sont simulées ici. Ce que
// ces tests protègent en priorité :
// - une seule nouvelle tentative après la ré-authentification, jamais une boucle ;
// - le jeton e-MCF ne voyage que dans le corps d'un POST/PUT, jamais dans l'URL,
//   et n'est jamais rangé dans une reprise d'action ;
// - aucune alerte inventée sur une date qu'on n'a pas.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, type NormalizedInvoicingView, type PointOfSaleView } from '@/lib/api';

import {
  alerteValidite,
  avecReauth,
  bandeauDesactivation,
  changementExigeMotif,
  corpsDepuisFormulaire,
  erreurDgi,
  erreurFormatJeton,
  erreurMotif,
  erreursFormulaire,
  erreursParChamp,
  formulaireDepuisProfil,
  jetonMasque,
  libelleEtat,
  libellePrerequis,
  lireReprise,
  messageFiscal,
  modeReauthExige,
  pointsOrdonnes,
  prerequisManquants,
  prerequisManquantsDeErreur,
  serialiserReprise,
  tonEtat,
} from './fiscal-model';

/** Erreur telle que la produit `jsonRequest` dans `lib/api.ts`. */
function erreurApi(status: number, detail: Record<string, unknown>): Error {
  return Object.assign(new Error(String(detail['message'] ?? `HTTP ${status}`)), {
    status,
    detail,
  });
}

const reauthRequise = (): Error =>
  erreurApi(401, { code: 'REAUTH_REQUIRED', message: 'Ré-authentification requise' });

function vueFacture(partiel: Partial<NormalizedInvoicingView> = {}): NormalizedInvoicingView {
  return {
    state: 'disabled',
    environment: 'test',
    firstActivatedAt: null,
    activatedAt: null,
    deactivatedAt: null,
    deactivationReason: null,
    prerequisites: {
      fiscalProfileComplete: true,
      countryIsCd: true,
      activePointOfSaleInEnvironment: true,
      productionAvailable: false,
      nifAvailable: true,
    },
    canActivate: true,
    pointsOfSale: [],
    ...partiel,
  };
}

function point(partiel: Partial<PointOfSaleView> = {}): PointOfSaleView {
  return {
    id: '6712f0c4e1a2b3c4d5e6f701',
    label: 'Boutique Gombe',
    environment: 'test',
    expectedNim: null,
    enabled: true,
    status: 'active',
    token: { configured: true, last4: 'x9Zq', updatedAt: '2026-10-20T09:00:00.000Z' },
    dgi: null,
    lastTest: null,
    ...partiel,
  };
}

describe('ré-authentification : une seule nouvelle tentative', () => {
  it('reconnaît les deux exigences, et elles seules', () => {
    expect(modeReauthExige(reauthRequise())).toBe('password');
    expect(modeReauthExige(erreurApi(401, { code: 'REAUTH_GOOGLE_REQUIRED' }))).toBe('google');
    // Une session expirée n'est pas une demande de mot de passe.
    expect(modeReauthExige(erreurApi(401, { code: 'UNAUTHORIZED' }))).toBeNull();
    expect(modeReauthExige(erreurApi(403, { code: 'REAUTH_REQUIRED' }))).toBeNull();
    expect(modeReauthExige(new Error('réseau'))).toBeNull();
  });

  it('rejoue UNE fois après une fenêtre ouverte', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(reauthRequise())
      .mockResolvedValueOnce('ok');
    const demander = vi.fn(async () => true);
    await expect(avecReauth(operation, demander)).resolves.toBe('ok');
    expect(demander).toHaveBeenCalledWith('password');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('ne redemande pas une seconde fois : la seconde exigence remonte telle quelle', async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(reauthRequise());
    const demander = vi.fn(async () => true);
    await expect(avecReauth(operation, demander)).rejects.toMatchObject({ status: 401 });
    expect(demander).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('relance l’erreur d’origine si la personne annule, sans rejouer', async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(reauthRequise());
    await expect(avecReauth(operation, async () => false)).rejects.toMatchObject({
      detail: { code: 'REAUTH_REQUIRED' },
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('ne demande rien pour une autre erreur', async () => {
    const demander = vi.fn(async () => true);
    const refus = erreurApi(422, { code: 'EMCF_TOKEN_REJECTED' });
    await expect(avecReauth(() => Promise.reject(refus), demander)).rejects.toBe(refus);
    expect(demander).not.toHaveBeenCalled();
  });

  it('passe le mode Google à la demande', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(erreurApi(401, { code: 'REAUTH_GOOGLE_REQUIRED' }))
      .mockResolvedValueOnce('ok');
    const demander = vi.fn(async () => true);
    await avecReauth(operation, demander);
    expect(demander).toHaveBeenCalledWith('google');
  });
});

describe('reprise après la connexion Google', () => {
  const t0 = Date.parse('2026-10-20T09:00:00.000Z');

  it('relit une action sans jeton, dans les dix minutes', () => {
    const brut = serialiserReprise({ type: 'deactivate', reason: 'Fermeture de la boutique' }, t0);
    expect(lireReprise(brut, t0 + 60_000)).toEqual({
      type: 'deactivate',
      reason: 'Fermeture de la boutique',
    });
    expect(lireReprise(brut, t0 + 11 * 60_000)).toBeNull();
  });

  it('refuse toute reprise qui porterait un jeton, ou une forme inconnue', () => {
    const avecJeton = JSON.stringify({
      action: { type: 'activate', environment: 'test', token: 'abcdefghijklmnopqrstuvwxyz' },
      at: t0,
    });
    expect(lireReprise(avecJeton, t0)).toBeNull();
    expect(lireReprise(JSON.stringify({ action: { type: 'create_pos' }, at: t0 }), t0)).toBeNull();
    expect(lireReprise('pas du json', t0)).toBeNull();
    expect(lireReprise(null, t0)).toBeNull();
  });
});

describe('le jeton ne voyage que dans le corps d’un POST ou d’un PUT', () => {
  const JETON = 'jeton-secret-de-test_0123456789.ABCDEF';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function espionFetch(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(point()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('création d’un point de vente : POST, jeton dans le corps seulement', async () => {
    const fetchMock = espionFetch();
    await api.createPointOfSale({
      label: 'Boutique',
      environment: 'test',
      expectedNim: null,
      token: JETON,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(url).not.toContain(JETON);
    expect(url).toMatch(/\/organizations\/current\/normalized-invoicing\/points-of-sale$/);
    expect(JSON.stringify(init.headers ?? {})).not.toContain(JETON);
    expect(JSON.parse(String(init.body))).toMatchObject({ token: JETON });
  });

  it('remplacement : PUT, jeton dans le corps seulement', async () => {
    const fetchMock = espionFetch();
    await api.replacePointOfSaleToken('pos/1', JETON);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect(url).not.toContain(JETON);
    // L'identifiant est encodé : il ne peut pas réécrire le chemin.
    expect(url).toMatch(/\/points-of-sale\/pos%2F1\/token$/);
    expect(JSON.parse(String(init.body))).toEqual({ token: JETON });
  });

  it('aucune autre méthode ne prend de jeton : test et retrait partent sans', async () => {
    const fetchMock = espionFetch();
    await api.testPointOfSale('p1');
    await api.disablePointOfSale('p1');
    await api.updatePointOfSale('p1', { label: 'Nouveau nom' });
    for (const [url, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      expect(url).not.toContain(JETON);
      expect(String(init.body ?? '')).not.toContain(JETON);
    }
    const [, testInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(testInit.method).toBe('POST');
    expect(testInit.body).toBeUndefined();
  });

  it('ré-authentification Google : POST sans mot de passe', async () => {
    const fetchMock = espionFetch();
    await api.confirmMeReauth();
    await api.confirmMeReauth('mot-de-passe');
    const [url1, init1] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, init2] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url1).toMatch(/\/me\/reauth$/);
    expect(JSON.parse(String(init1.body))).toEqual({});
    expect(JSON.parse(String(init2.body))).toEqual({ password: 'mot-de-passe' });
  });
});

describe('points de vente', () => {
  it('nomme chaque état en mots', () => {
    expect(libelleEtat('token_expired')).toBe('Jeton expiré');
    expect(libelleEtat('nif_mismatch')).toBe('NIF différent de la fiche');
    expect(libelleEtat('token_missing')).toBe('Jeton manquant');
    expect(libelleEtat('failing')).toBe('Dernier test en échec');
    expect(libelleEtat('active')).toBe('Actif');
    expect(libelleEtat('disabled')).toBe('Retiré');
    expect(tonEtat('active')).toBe('succes');
    expect(tonEtat('token_expired')).toBe('echec');
  });

  it('avertit à moins de 30 jours, et seulement alors', () => {
    const maintenant = Date.parse('2026-10-20T00:00:00.000Z');
    expect(alerteValidite('2026-12-31T00:00:00.000Z', maintenant)).toBeNull();
    const bientot = alerteValidite('2026-11-05T00:00:00.000Z', maintenant);
    expect(bientot).toMatchObject({ niveau: 'bientot', jours: 16 });
    expect(bientot?.texte).toContain('16 jours');
    expect(alerteValidite('2026-10-21T00:00:00.000Z', maintenant)?.texte).toContain('1 jour ');
    expect(alerteValidite('2026-10-01T00:00:00.000Z', maintenant)).toMatchObject({
      niveau: 'expire',
    });
  });

  it('n’invente aucune alerte sur une date absente ou invalide', () => {
    expect(alerteValidite(null)).toBeNull();
    expect(alerteValidite(undefined)).toBeNull();
    expect(alerteValidite('pas une date')).toBeNull();
  });

  it('ne montre jamais que le suffixe du jeton', () => {
    expect(jetonMasque({ configured: true, last4: 'x9Zq', updatedAt: null })).toBe('****x9Zq');
    expect(jetonMasque({ configured: true, last4: null, updatedAt: null })).toBe('****');
    expect(jetonMasque({ configured: false, last4: null, updatedAt: null })).toBe('Aucun jeton');
  });

  it('contrôle le format du jeton avant envoi, sans le décoder', () => {
    expect(erreurFormatJeton('')).not.toBeNull();
    expect(erreurFormatJeton('court')).toContain('20');
    expect(erreurFormatJeton('a'.repeat(19) + ' ')).not.toBeNull();
    expect(erreurFormatJeton('eyJhbGciOiJIUzI1NiJ9.e30.abc-def_ghi')).toBeNull();
  });

  it('range d’abord ce qui demande une action, les retirés à la fin', () => {
    const ordre = pointsOrdonnes([
      point({ id: '1', label: 'B', status: 'disabled' }),
      point({ id: '2', label: 'A', status: 'active' }),
      point({ id: '3', label: 'C', status: 'token_expired' }),
    ]);
    expect(ordre.map((p) => p.id)).toEqual(['3', '2', '1']);
  });
});

describe('facture normalisée', () => {
  it('liste les prérequis manquants, la production fermée seulement en production', () => {
    expect(prerequisManquants(vueFacture())).toEqual([]);
    const vide = vueFacture({
      canActivate: false,
      prerequisites: {
        fiscalProfileComplete: false,
        countryIsCd: false,
        activePointOfSaleInEnvironment: false,
        productionAvailable: false,
        nifAvailable: false,
      },
    });
    expect(prerequisManquants(vide)).toEqual([
      'fiscal_profile',
      'country_cd',
      'active_point_of_sale',
      'nif_elsewhere',
    ]);
    expect(prerequisManquants({ ...vide, environment: 'production' })).toContain(
      'production_unavailable',
    );
  });

  it('traduit chaque prérequis, et laisse visible un code inconnu', () => {
    expect(libellePrerequis('fiscal_profile')).toContain('fiche fiscale');
    expect(libellePrerequis('production_unavailable')).toBe(
      'La production sera ouverte après l’homologation de Lalanda par la DGI.',
    );
    expect(libellePrerequis('nif_elsewhere')).toContain('autre organisation');
    expect(libellePrerequis('nouveau_code')).toContain('nouveau_code');
  });

  it('lit la liste `missing` d’un refus 409', () => {
    const refus = erreurApi(409, {
      code: 'NORMALIZED_INVOICING_PREREQUISITES',
      details: { missing: ['nif_elsewhere', 42] },
    });
    expect(prerequisManquantsDeErreur(refus)).toEqual(['nif_elsewhere']);
    expect(prerequisManquantsDeErreur(reauthRequise())).toBeNull();
  });

  it('exige un motif de 20 à 500 caractères', () => {
    expect(erreurMotif('trop court')).toContain('20');
    expect(erreurMotif('   ' + 'x'.repeat(19) + '   ')).not.toBeNull();
    expect(erreurMotif('Fermeture définitive de la boutique')).toBeNull();
    expect(erreurMotif('x'.repeat(501))).toContain('500');
  });

  it('demande un motif pour production → test pendant l’activation, et seulement alors', () => {
    expect(changementExigeMotif({ state: 'enabled', environment: 'production' }, 'test')).toBe(
      true,
    );
    expect(changementExigeMotif({ state: 'disabled', environment: 'production' }, 'test')).toBe(
      false,
    );
    expect(changementExigeMotif({ state: 'enabled', environment: 'test' }, 'production')).toBe(
      false,
    );
  });

  it('affiche le bandeau de désactivation avec date et motif, et seulement désactivée', () => {
    const desactivee = vueFacture({
      firstActivatedAt: '2026-10-01T09:00:00.000Z',
      deactivatedAt: '2026-10-19T09:00:00.000Z',
      deactivationReason: 'Changement de logiciel de caisse',
    });
    const texte = bandeauDesactivation(desactivee);
    expect(texte).toContain('Facture normalisée désactivée le');
    expect(texte).toContain('motif : Changement de logiciel de caisse');
    expect(bandeauDesactivation({ ...desactivee, state: 'enabled' })).toBeNull();
    expect(bandeauDesactivation(vueFacture())).toBeNull();
  });
});

describe('erreurs de l’API', () => {
  it('range les erreurs Zod par champ, sous details.issues comme à la racine', () => {
    const contrat = erreurApi(400, {
      code: 'INVALID_REQUEST',
      details: {
        issues: [
          { path: ['headOffice', 'city'], message: 'Requis' },
          { path: ['email'], message: 'Adresse invalide' },
          { path: [], message: 'ignoré' },
        ],
      },
    });
    expect(erreursParChamp(contrat)).toEqual({
      'headOffice.city': 'Requis',
      email: 'Adresse invalide',
    });
    const ancien = erreurApi(400, {
      code: 'INVALID_REQUEST',
      issues: [{ path: ['nif'], message: 'Format' }],
    });
    expect(erreursParChamp(ancien)).toEqual({ nif: 'Format' });
  });

  it('lit le chemin déjà joint que sert l’API fiscale réelle', () => {
    const reel = erreurApi(400, {
      code: 'INVALID_REQUEST',
      message: 'Corps de requête invalide.',
      details: {
        issues: [
          { path: 'headOffice.city', code: 'too_small', message: 'Requis' },
          { path: 'nif', code: 'invalid_string', message: 'NIF : 5 à 20 lettres ou chiffres' },
        ],
      },
    });
    expect(erreursFormulaire(reel).champs).toEqual({
      city: 'Requis',
      nif: 'NIF : 5 à 20 lettres ou chiffres',
    });
  });

  it('affiche le message du serveur pour un 400 sans champ fautif', () => {
    const dejaActivee = erreurApi(400, {
      code: 'INVALID_REQUEST',
      message: 'La facture normalisée est déjà activée dans l’autre environnement.',
    });
    expect(messageFiscal(dejaActivee, 'repli')).toContain('déjà activée');
    expect(messageFiscal(erreurApi(500, { code: 'EMCF_TOKEN_UNREADABLE' }), 'r')).toContain(
      'illisible',
    );
  });

  it('rattache les erreurs au formulaire, et garde visibles les chemins inconnus', () => {
    const err = erreurApi(400, {
      code: 'INVALID_REQUEST',
      details: {
        issues: [
          { path: ['headOffice', 'city'], message: 'Requis' },
          { path: ['headOffice'], message: 'Adresse incomplète' },
        ],
      },
    });
    expect(erreursFormulaire(err)).toEqual({
      champs: { city: 'Requis' },
      autres: ['headOffice : Adresse incomplète'],
    });
  });

  it('place le verrou du NIF sous le champ NIF', () => {
    const verrou = erreurApi(409, { code: 'FISCAL_IDENTITY_LOCKED' });
    expect(erreursFormulaire(verrou).champs.nif).toContain('NIF');
  });

  it('montre le code et le libellé DGI tels quels', () => {
    const err = erreurApi(422, {
      code: 'EMCF_TOKEN_REJECTED',
      details: { dgiErrorCode: 'E-401', dgiMessage: 'Jeton invalide' },
    });
    expect(erreurDgi(err)).toEqual({ code: 'E-401', message: 'Jeton invalide' });
    expect(messageFiscal(err, 'repli')).toContain('Rien n’a été enregistré');
    expect(erreurDgi(reauthRequise())).toBeNull();
  });

  it('précise la nature d’une panne DGI', () => {
    const err = erreurApi(502, { code: 'EDEF_UNREACHABLE', details: { kind: 'timeout' } });
    expect(messageFiscal(err, 'repli')).toContain('délai dépassé');
    expect(messageFiscal({}, 'repli')).toBe('repli');
  });
});

describe('fiche fiscale : formulaire et corps', () => {
  it('part d’un formulaire vide, siège en RDC par défaut', () => {
    const f = formulaireDepuisProfil(null);
    expect(f.country).toBe('CD');
    expect(f.legalForm).toBe('');
    expect(f.vatRegistered).toBe(false);
  });

  it('envoie un corps complet : vides à null, « autre » seulement si choisi', () => {
    const f = {
      ...formulaireDepuisProfil(null),
      legalName: '  Exemple SARL ',
      legalForm: 'sarl' as const,
      legalFormOther: 'restée d’une saisie précédente',
      nif: 'a 000-0000x',
      line1: '1, avenue Exemple',
      city: 'Kinshasa',
      country: 'cd',
      phone: '+243 800 000 000',
      email: 'facturation@exemple.cd',
      vatRegistered: true,
    };
    const corps = corpsDepuisFormulaire(f);
    expect(corps).toEqual({
      legalName: 'Exemple SARL',
      tradeName: null,
      legalForm: 'sarl',
      legalFormOther: null,
      // La normalisation du NIF appartient au serveur.
      nif: 'a 000-0000x',
      rccm: null,
      nationalId: null,
      vatRegistered: true,
      headOffice: {
        line1: '1, avenue Exemple',
        line2: null,
        commune: null,
        city: 'Kinshasa',
        province: null,
        country: 'CD',
      },
      phone: '+243 800 000 000',
      email: 'facturation@exemple.cd',
    });
    expect(corpsDepuisFormulaire({ ...f, legalForm: 'autre' }).legalFormOther).toBe(
      'restée d’une saisie précédente',
    );
  });
});
