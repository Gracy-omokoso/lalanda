// Tests unitaires de l'intégration WhatsApp — ADR-0065. Aucun appel réel à Meta.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  WhatsAppApi,
  WhatsAppApiError,
  realWhatsAppHttp,
  whatsappErrorKind,
} from './whatsapp-api.js';
import {
  kinshasaMonth,
  whatsappApiBase,
  whatsappApiVersion,
  whatsappEnabled,
  whatsappMonthlyLimit,
} from './whatsapp-config.js';
import {
  generateWhatsAppCode,
  hashWhatsAppCode,
  hubSignature,
  safeEqualText,
  verifyHubSignature,
  verifyWhatsAppCode,
} from './whatsapp-security.js';
import {
  WHATSAPP_TEMPLATES,
  codeTemplateMessage,
  linkSuffix,
  templateForEvent,
  templateParam,
  workTemplateMessage,
} from './whatsapp-templates.js';
import { optOutWord } from './whatsapp.service.js';

const AUTH = 'secret-de-test-non-production-0123456789abcdef';
const APP_SECRET = 'fedcba9876543210fedcba9876543210';
const CREDS = { phoneNumberId: '109876543210987', accessToken: 'EAAG-jeton', apiVersion: 'v24.0' };

describe('réglages', () => {
  it('plafond mensuel : défaut prudent 1 000, bornes respectées', () => {
    expect(whatsappMonthlyLimit(null)).toBe(1000);
    expect(whatsappMonthlyLimit('250')).toBe(250);
    expect(whatsappMonthlyLimit('0')).toBe(0);
    expect(whatsappMonthlyLimit('-3')).toBe(1000);
    expect(whatsappMonthlyLimit('beaucoup')).toBe(1000);
    expect(whatsappMonthlyLimit('9999999')).toBe(1000);
  });

  it('version de la Graph API, interrupteur, mois de Kinshasa', () => {
    expect(whatsappApiVersion(undefined)).toBe('v24.0');
    expect(whatsappApiVersion('v25.0')).toBe('v25.0');
    expect(whatsappApiVersion('v25.0/../x')).toBe('v24.0');
    expect(whatsappEnabled({})).toBe(true);
    expect(whatsappEnabled({ WHATSAPP_ENABLED: 'FALSE' })).toBe(false);
    expect(whatsappEnabled({ WHATSAPP_ENABLED: 'true' })).toBe(true);
    // 31 déc. 23 h 30 UTC = 1er janv. 0 h 30 à Kinshasa (UTC+1).
    expect(kinshasaMonth(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01');
  });

  it('faux Meta local seulement hors production, en boucle locale', () => {
    expect(whatsappApiBase({ WHATSAPP_API_BASE_URL: 'http://127.0.0.1:3499/' })).toBe(
      'http://127.0.0.1:3499',
    );
    expect(
      whatsappApiBase({ WHATSAPP_API_BASE_URL: 'http://127.0.0.1:3499', NODE_ENV: 'production' }),
    ).toBe('https://graph.facebook.com');
    expect(whatsappApiBase({ WHATSAPP_API_BASE_URL: 'https://evil.example/' })).toBe(
      'https://graph.facebook.com',
    );
  });
});

describe('sécurité', () => {
  it('signature X-Hub-Signature-256 : corps exact, clé exacte, format strict', () => {
    const body = '{"object":"whatsapp_business_account"}';
    const sig = hubSignature(APP_SECRET, body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyHubSignature({ appSecret: APP_SECRET, signature: sig, rawBody: body })).toBe(true);
    expect(verifyHubSignature({ appSecret: APP_SECRET, signature: sig, rawBody: `${body} ` })).toBe(
      false,
    );
    expect(verifyHubSignature({ appSecret: 'autre', signature: sig, rawBody: body })).toBe(false);
    expect(verifyHubSignature({ appSecret: APP_SECRET, signature: undefined, rawBody: body })).toBe(
      false,
    );
    expect(
      verifyHubSignature({ appSecret: APP_SECRET, signature: 'sha256=abc', rawBody: body }),
    ).toBe(false);
  });

  it('jeton de vérification comparé à temps constant', () => {
    expect(safeEqualText('jeton-verif', 'jeton-verif')).toBe(true);
    expect(safeEqualText('jeton-veri', 'jeton-verif')).toBe(false);
    expect(safeEqualText(undefined, 'jeton-verif')).toBe(false);
    expect(safeEqualText('', '')).toBe(false);
  });

  it('code : 6 chiffres ; empreinte liée à l’organisation, la personne et le numéro', () => {
    for (let i = 0; i < 50; i += 1) expect(generateWhatsAppCode()).toMatch(/^\d{6}$/);
    const ref = { organizationId: 'o1', userId: 'u1', phone: '+243812345612', code: '012345' };
    const h = hashWhatsAppCode(ref, AUTH);
    expect(h).not.toContain('012345');
    expect(verifyWhatsAppCode(ref, h, AUTH)).toBe(true);
    expect(verifyWhatsAppCode({ ...ref, code: '012346' }, h, AUTH)).toBe(false);
    expect(verifyWhatsAppCode({ ...ref, userId: 'u2' }, h, AUTH)).toBe(false);
    expect(verifyWhatsAppCode({ ...ref, organizationId: 'o2' }, h, AUTH)).toBe(false);
    expect(verifyWhatsAppCode({ ...ref, phone: '+243812345613' }, h, AUTH)).toBe(false);
    expect(() => hashWhatsAppCode(ref, 'court')).toThrow();
  });

  it('« STOP » et « ARRET » reconnus, accents et ponctuation ignorés', () => {
    expect(optOutWord(' stop ')).toBe('STOP');
    expect(optOutWord('Arrêt !')).toBe('ARRET');
    expect(optOutWord('arrêter')).toBe('ARRETER');
    expect(optOutWord('Bonjour')).toBe('BONJOUR');
  });
});

describe('modèles', () => {
  it('liste fermée, en français, catégories Meta', () => {
    expect(Object.keys(WHATSAPP_TEMPLATES)).toEqual([
      'lalanda_tache_assignee',
      'lalanda_mention',
      'lalanda_echeance_depassee',
      'lalanda_notification_projet',
      'lalanda_code_verification',
    ]);
    expect(WHATSAPP_TEMPLATES.lalanda_code_verification.category).toBe('AUTHENTICATION');
    for (const t of Object.values(WHATSAPP_TEMPLATES)) {
      if (t.name !== 'lalanda_code_verification') expect(t.category).toBe('UTILITY');
    }
  });

  it('règles Meta : variables numérotées, ni en tête ni en fin, jamais adjacentes', () => {
    for (const t of Object.values(WHATSAPP_TEMPLATES)) {
      const vars = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(vars).toEqual(t.params.map((_, i) => i + 1));
      expect(t.examples).toHaveLength(t.params.length);
      expect(t.body.trimStart().startsWith('{{')).toBe(false);
      expect(t.body.trimEnd().endsWith('}}')).toBe(false);
      expect(t.body).not.toMatch(/\}\}\s*\{\{/);
      // Aucune donnée financière dans le texte figé.
      expect(t.body).not.toMatch(/montant|facture|USD|CDF|€|\$/i);
    }
  });

  it('le guide de la dirigeante recopie le texte EXACT à soumettre à Meta', () => {
    const guide = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/integrations/whatsapp.md'),
      'utf8',
    );
    for (const t of Object.values(WHATSAPP_TEMPLATES)) {
      expect(guide, t.name).toContain(`\`${t.name}\``);
      expect(guide, t.name).toContain(t.body);
      if (t.footer) expect(guide, t.name).toContain(t.footer);
      if (t.button.type === 'URL') expect(guide, t.name).toContain(t.button.url);
      for (const ex of t.examples) expect(guide, `${t.name} exemple`).toContain(ex);
    }
  });

  it('événement → modèle : trois dédiés, un générique', () => {
    expect(templateForEvent('task_assigned')).toBe('lalanda_tache_assignee');
    expect(templateForEvent('mentioned')).toBe('lalanda_mention');
    expect(templateForEvent('task_overdue')).toBe('lalanda_echeance_depassee');
    expect(templateForEvent('comment_on_followed')).toBe('lalanda_notification_projet');
    expect(templateForEvent('project_at_risk')).toBe('lalanda_notification_projet');
  });

  it('variables assainies (une ligne, bornée, jamais vide) ; lien relatif seulement', () => {
    expect(templateParam('a\n\tb     c')).toBe('a b c');
    expect(templateParam('')).toBe('—');
    expect(templateParam('{{1}}x')).toBe('1x');
    expect(templateParam('x'.repeat(300))).toHaveLength(200);
    expect(linkSuffix('/projets/abc?tache=def')).toBe('projets/abc?tache=def');
    expect(linkSuffix('https://evil.example/')).toBe('projets');
    expect(linkSuffix('//evil.example')).toBe('projets');
  });

  it('message d’une notification : composants corps et bouton', () => {
    const m = workTemplateMessage({
      to: '+243812345612',
      event: 'task_assigned',
      eventLabel: 'Une tâche m’est assignée',
      title: '#3 Maquette — assignée par Gracy',
      projectName: 'Refonte',
      organizationName: 'Go freelance',
      href: '/projets/p1?tache=t1',
    });
    expect(m).toEqual({
      to: '+243812345612',
      name: 'lalanda_tache_assignee',
      language: 'fr',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: '#3 Maquette — assignée par Gracy' },
            { type: 'text', text: 'Refonte' },
            { type: 'text', text: 'Go freelance' },
          ],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: 'projets/p1?tache=t1' }],
        },
      ],
    });
    const g = workTemplateMessage({
      ...m,
      event: 'comment_on_followed',
      eventLabel: 'Commentaire',
      title: 'T',
      projectName: null,
      organizationName: 'O',
      href: '/projets/p1',
    });
    expect(g.name).toBe('lalanda_notification_projet');
    expect(g.components[0]).toEqual({
      type: 'body',
      parameters: [
        { type: 'text', text: 'Commentaire' },
        { type: 'text', text: 'T' },
        { type: 'text', text: '—' },
        { type: 'text', text: 'O' },
      ],
    });
    const c = codeTemplateMessage('+243812345612', '482913');
    expect(c.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: '482913' }] },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: '482913' }],
      },
    ]);
  });
});

describe('client HTTP', () => {
  function client(responses: Array<{ status: number; body: unknown }>) {
    const api = new WhatsAppApi();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const sleeps: number[] = [];
    api.http = async (url, init) => {
      calls.push({ url, init });
      const r = responses.shift() ?? { status: 200, body: { messages: [{ id: 'wamid.X' }] } };
      return new Response(JSON.stringify(r.body), { status: r.status });
    };
    api.sleep = async (ms) => {
      sleeps.push(ms);
    };
    return { api, calls, sleeps };
  }

  it('le fetch réel refuse de partir sous vitest', async () => {
    await expect(realWhatsAppHttp('https://graph.facebook.com/x', {})).rejects.toThrow(/refusé/);
  });

  it('POST /<version>/<phoneNumberId>/messages, jeton en Bearer, numéro sans « + »', async () => {
    const { api, calls } = client([{ status: 200, body: { messages: [{ id: 'wamid.ABC' }] } }]);
    const id = await api.sendTemplate(CREDS, codeTemplateMessage('+243812345612', '111222'));
    expect(id).toBe('wamid.ABC');
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v24.0/109876543210987/messages');
    expect((calls[0]!.init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer EAAG-jeton',
    );
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '243812345612',
      type: 'template',
      template: { name: 'lalanda_code_verification', language: { code: 'fr' } },
    });
  });

  it('limite de débit : deux nouvelles tentatives bornées, puis échec « rate_limited »', async () => {
    const ok = client([
      { status: 429, body: { error: { code: 130429 } } },
      { status: 200, body: { messages: [{ id: 'wamid.OK' }] } },
    ]);
    expect(await ok.api.sendTemplate(CREDS, codeTemplateMessage('+243812345612', '1'))).toBe(
      'wamid.OK',
    );
    expect(ok.sleeps).toEqual([1000]);
    const ko = client([
      { status: 400, body: { error: { code: 131056 } } },
      { status: 400, body: { error: { code: 131056 } } },
      { status: 400, body: { error: { code: 131056 } } },
    ]);
    const err = await ko.api
      .sendTemplate(CREDS, codeTemplateMessage('+243812345612', '1'))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhatsAppApiError);
    expect((err as WhatsAppApiError).kind).toBe('rate_limited');
    expect(ko.sleeps).toEqual([1000, 4000]);
    expect(ko.calls).toHaveLength(3);
  });

  it('erreurs classées ; jamais le jeton ni le message libre de Meta', async () => {
    const { api } = client([
      {
        status: 401,
        body: { error: { code: 190, message: 'jeton EAAG-jeton invalide +243812345612' } },
      },
    ]);
    const err = (await api
      .sendTemplate(CREDS, codeTemplateMessage('+243812345612', '1'))
      .catch((e: unknown) => e)) as WhatsAppApiError;
    expect(err.kind).toBe('provider');
    expect(`${err.message} ${JSON.stringify(err)}`).not.toMatch(/EAAG|243812345612/);
    expect(whatsappErrorKind(131026, 400)).toBe('recipient');
    expect(whatsappErrorKind(132001, 400)).toBe('other');
    expect(whatsappErrorKind(null, 401)).toBe('provider');
    expect(whatsappErrorKind(null, 429)).toBe('rate_limited');
  });
});
