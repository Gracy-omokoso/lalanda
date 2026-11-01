// Contrat du formulaire public de prospects (ADR-0048) : règles des champs,
// activation, validation d'une soumission.

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  CreateLeadFormBody,
  LEAD_FORM_DEFAULT_CONSENT,
  LEAD_FORM_FIELD_KEYS,
  PublicLeadSubmissionBody,
  UpdateLeadFormBody,
  defaultLeadFormFields,
  leadFormFieldIssues,
  validateLeadSubmission,
} from './index.js';

const ID = '64B7F0C2A1B2C3D4E5F60718';

function codes(schema: z.ZodType, input: unknown): string[] {
  const r = schema.safeParse(input);
  if (r.success) return [];
  return r.error.issues.map((i) => {
    const c = (i as { params?: { code?: unknown } }).params?.code;
    return typeof c === 'string' ? c : i.code;
  });
}

const base = () => ({
  expectedRevision: 1,
  enabled: false,
  title: 'Contactez-nous',
  intro: '',
  fields: defaultLeadFormFields(),
  consentText: LEAD_FORM_DEFAULT_CONSENT,
  privacyPolicyUrl: 'https://exemple.cd/confidentialite',
  successMessage: 'Merci.',
  assigneeUserId: ID,
  createOpportunity: false,
  opportunityCurrency: 'USD' as const,
  showBranding: true,
});

describe('formulaire public — réglages', () => {
  it('création : désactivée, valeurs par défaut, champ inconnu refusé', () => {
    const r = CreateLeadFormBody.parse({});
    expect(r.title).toBe('Contactez-nous');
    expect(r.consentText).toBe(LEAD_FORM_DEFAULT_CONSENT);
    expect(r.privacyPolicyUrl).toBeNull();
    expect(codes(CreateLeadFormBody, { enabled: true })).toContain('unrecognized_keys');
  });

  it('les champs par défaut respectent la liste fermée et ses règles', () => {
    const f = defaultLeadFormFields();
    expect(f.map((x) => x.key)).toEqual([...LEAD_FORM_FIELD_KEYS]);
    expect(leadFormFieldIssues(f)).toEqual([]);
  });

  it('le nom est toujours obligatoire ; e-mail ou téléphone obligatoire', () => {
    const f = defaultLeadFormFields().map((x) =>
      x.key === 'name'
        ? { ...x, required: false }
        : x.key === 'email'
          ? { ...x, required: false }
          : x,
    );
    const c = leadFormFieldIssues(f).map((i) => i.code);
    expect(c).toContain('LEAD_FORM_NAME_REQUIRED');
    expect(c).toContain('LEAD_FORM_CONTACT_REQUIRED');
  });

  it('un champ masqué ne peut pas être obligatoire ; doublon refusé', () => {
    const f = defaultLeadFormFields().map((x) =>
      x.key === 'source' ? { ...x, required: true } : x,
    );
    expect(leadFormFieldIssues(f).map((i) => i.code)).toContain('LEAD_FORM_FIELD_NOT_ENABLED');
    const dup = defaultLeadFormFields();
    dup[1] = { ...dup[0]! };
    expect(leadFormFieldIssues(dup).map((i) => i.code)).toEqual(['LEAD_FORM_FIELDS_INVALID']);
  });

  it('activer exige la politique (https) et le responsable', () => {
    expect(UpdateLeadFormBody.safeParse({ ...base(), enabled: true }).success).toBe(true);
    expect(codes(UpdateLeadFormBody, { ...base(), enabled: true, privacyPolicyUrl: '' })).toContain(
      'LEAD_FORM_POLICY_REQUIRED',
    );
    expect(codes(UpdateLeadFormBody, { ...base(), enabled: true, assigneeUserId: null })).toContain(
      'LEAD_FORM_ASSIGNEE_REQUIRED',
    );
    expect(
      codes(UpdateLeadFormBody, { ...base(), privacyPolicyUrl: 'http://exemple.cd/p' }),
    ).toContain('URL_INVALID');
    // Désactivé : politique et responsable peuvent manquer.
    expect(
      UpdateLeadFormBody.safeParse({ ...base(), privacyPolicyUrl: null, assigneeUserId: null })
        .success,
    ).toBe(true);
  });
});

describe('formulaire public — soumission', () => {
  const shown = defaultLeadFormFields()
    .filter((f) => f.enabled)
    .map((f) => ({ key: f.key, required: f.required }));

  it('valeurs retenues : vide → null, e-mail en minuscules', () => {
    const r = validateLeadSubmission(shown, {
      name: '  Awa Mbuyi ',
      email: 'Awa@Exemple.CD',
      company: '',
      consent: true,
    });
    expect(r.issues).toEqual([]);
    expect(r.values).toMatchObject({ name: 'Awa Mbuyi', email: 'awa@exemple.cd', company: null });
  });

  it('obligatoires, formats, consentement, champ masqué rempli', () => {
    const r = validateLeadSubmission(shown, {
      email: 'pas-un-email',
      phone: 'abc',
      source: 'salon',
    });
    expect(r.issues.map((i) => `${i.path}:${i.code}`).sort()).toEqual([
      'consent:LEAD_FORM_CONSENT_REQUIRED',
      'email:EMAIL_INVALID',
      'name:FIELD_REQUIRED',
      'phone:PHONE_INVALID',
      'source:LEAD_FORM_FIELD_NOT_ENABLED',
    ]);
  });

  it('corps strict et tailles maximales', () => {
    expect(codes(PublicLeadSubmissionBody, { ticket: 't', consent: true, file: 'x' })).toContain(
      'unrecognized_keys',
    );
    expect(
      PublicLeadSubmissionBody.safeParse({ ticket: 't', consent: true, message: 'x'.repeat(2001) })
        .success,
    ).toBe(false);
  });
});
