import { defaultLeadFormFields, type CrmLeadFormView } from '@lalanda/shared/crm';
import { describe, expect, it } from 'vitest';

import {
  changerChamp,
  corpsReglages,
  extraitHtml,
  lienPublic,
  manquesActivation,
  messageFormulaire,
  problemesChamps,
} from './formulaire-public-model';

const VUE: CrmLeadFormView = {
  id: 'f1',
  enabled: false,
  token: 'AbCdEfGhIjKlMnOpQrStUvWxYz012345',
  publicPath: '/f/AbCdEfGhIjKlMnOpQrStUvWxYz012345',
  tokenRotatedAt: null,
  title: 'Contactez-nous',
  intro: null,
  fields: defaultLeadFormFields(),
  consentText: 'J’accepte d’être recontacté au sujet de ma demande.',
  privacyPolicyUrl: '  ',
  successMessage: 'Merci.',
  assigneeUserId: null,
  createOpportunity: false,
  opportunityCurrency: 'USD',
  showBranding: true,
  stats: { submissions: 0, lastSubmissionAt: null },
  revision: 3,
  createdAt: '',
  updatedAt: '',
};

describe('réglages du formulaire public — modèle', () => {
  it('lien public et extrait HTML échappé (un lien, jamais une iframe)', () => {
    const url = lienPublic('https://app.lalanda.cd/', VUE.publicPath);
    expect(url).toBe('https://app.lalanda.cd/f/AbCdEfGhIjKlMnOpQrStUvWxYz012345');
    const html = extraitHtml(url, 'Écrivez-nous <vite>');
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('&lt;vite&gt;');
    expect(html).not.toContain('iframe');
  });

  it('le nom reste obligatoire ; masquer rend facultatif ; obligatoire affiche', () => {
    let f = changerChamp(VUE.fields, 'name', 'enabled', false);
    expect(f.find((c) => c.key === 'name')).toMatchObject({ enabled: true, required: true });
    f = changerChamp(f, 'email', 'enabled', false);
    expect(f.find((c) => c.key === 'email')).toMatchObject({ enabled: false, required: false });
    expect(problemesChamps(f).length).toBeGreaterThan(0);
    f = changerChamp(f, 'phone', 'required', true);
    expect(problemesChamps(f)).toEqual([]);
    f = changerChamp(f, 'source', 'required', true);
    expect(f.find((c) => c.key === 'source')).toMatchObject({ enabled: true, required: true });
  });

  it('activer : liste de ce qui manque', () => {
    expect(manquesActivation(VUE)).toEqual([
      'le lien de votre politique de confidentialité',
      'le responsable des demandes',
    ]);
    expect(
      manquesActivation({ ...VUE, privacyPolicyUrl: 'https://x.cd/p', assigneeUserId: 'u1' }),
    ).toEqual([]);
  });

  it('corps : politique vide → null, révision reprise', () => {
    const c = corpsReglages(VUE, true);
    expect(c).toMatchObject({ expectedRevision: 3, enabled: true, privacyPolicyUrl: null });
  });

  it('messages : code de tête, puis code d’un champ, 403', () => {
    expect(messageFormulaire({ status: 403 }, 'r')).toMatch(/rôle/);
    expect(messageFormulaire({ status: 409, detail: { code: 'LEAD_FORM_EXISTS' } }, 'r')).toMatch(
      /déjà/,
    );
    expect(
      messageFormulaire(
        {
          status: 400,
          detail: {
            code: 'INVALID_REQUEST',
            details: { issues: [{ code: 'CRM_ASSIGNEE_NOT_ELIGIBLE', message: 'x' }] },
          },
        },
        'r',
      ),
    ).toMatch(/ne gère pas le CRM/);
  });
});
