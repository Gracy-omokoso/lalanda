// E-mail du brief du matin : contenu déterministe et échappement (ADR-0033 § 8).

import { buildMorningBrief } from '@lalanda/engine';
import { describe, expect, it } from 'vitest';

import { renderMorningBrief } from '../mail/mail.templates.js';
import { emailContent, factLine } from './morning-brief-email.job.js';
import { kinshasaClock, kinshasaMonthStart } from './morning-brief.service.js';

const NOW = '2026-10-21T08:00:00.000Z';

function brief(): ReturnType<typeof buildMorningBrief> {
  return buildMorningBrief({
    now: NOW,
    sales: {
      invoices: [
        {
          id: 'x',
          type: 'FV',
          status: 'issued',
          testSeries: false,
          currency: 'CDF',
          issuedAt: '2026-10-02T09:00:00.000Z',
          frozenAt: null,
          updatedAt: '2026-10-02T09:00:00.000Z',
          groups: [{ group: 'B', ht: '1250000.00' }],
          outstanding: null,
          creditNoteOriginId: null,
          normalizationPhase: null,
        },
      ],
      truncated: false,
    },
    cash: { status: 'to_fill' },
    dueDates: { status: 'unavailable' },
    work: { status: 'unavailable' },
  });
}

describe('contenu de l’e-mail', () => {
  it('reprend les faits clés formatés, sans montant nul inutile, et les recommandations', () => {
    const c = emailContent(brief(), 'Boulangerie');
    expect(c.dateLabel).toBe('mercredi 21 octobre 2026');
    expect(c.facts).toContain('Chiffre d’affaires HT du mois (CDF) : 1 250 000,00 CDF');
    expect(c.facts.some((f) => f.includes('(USD)'))).toBe(false);
    expect(c.facts).toContain('Trésorerie disponible : à renseigner');
    expect(c.facts).toContain('Factures dont l’échéance est dépassée : non disponible');
    expect(c.recommendations).toHaveLength(1);
  });

  it('un fait masqué se dit masqué, jamais zéro', () => {
    const masque = buildMorningBrief({
      now: NOW,
      sales: 'hidden',
      cash: { status: 'to_fill' },
      dueDates: { status: 'unavailable' },
      work: { status: 'unavailable' },
    }).facts.find((f) => f.id === 'ca_mois.CDF');
    expect(masque && factLine(masque)).toBe(
      'Chiffre d’affaires HT du mois (CDF) : masqué pour votre rôle',
    );
  });

  it('porte les tâches PERSONNELLES du destinataire et l’alerte R8 (ADR-0039 § 6.5)', () => {
    const t = (mine: boolean, dueDate: string) => ({
      projectId: 'p1',
      dueDate,
      isMilestone: false,
      mine,
      projectActive: true,
    });
    const b = buildMorningBrief({
      now: NOW,
      sales: 'hidden',
      cash: { status: 'to_fill' },
      dueDates: { status: 'unavailable' },
      work: {
        status: 'known',
        tasks: [
          t(true, '2026-10-20'),
          t(true, '2026-10-19'),
          t(true, '2026-10-21'),
          t(false, '2026-10-01'),
        ],
        truncated: false,
      },
    });
    const c = emailContent(b, 'Boulangerie');
    expect(c.facts).toContain('Mes tâches en retard : 2');
    expect(c.facts).toContain('Mes tâches du jour : 1');
    // Les tâches des autres membres ne sont pas des faits personnels de l'e-mail.
    expect(c.facts.some((f) => f.startsWith('Tâches en retard dans l’organisation'))).toBe(false);
    expect(c.alerts.some((a) => a.startsWith('Tâches en retard — 2 tâches'))).toBe(true);
  });

  it('sans work.read, les tâches se disent masquées', () => {
    const b = buildMorningBrief({
      now: NOW,
      sales: 'hidden',
      cash: { status: 'to_fill' },
      dueDates: { status: 'unavailable' },
      work: 'hidden',
    });
    expect(emailContent(b, 'X').facts).toContain('Mes tâches en retard : masqué pour votre rôle');
  });

  it('échappe le nom de l’organisation (saisie utilisateur) et n’embarque aucun texte d’IA', () => {
    const mail = renderMorningBrief(
      emailContent(brief(), '<script>alert(1)</script>'),
      'https://app.lalanda.co/organisation/brief',
    );
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.subject).toContain('brief du matin');
    expect(mail.text).toContain('https://app.lalanda.co/organisation/brief');
  });
});

describe('horloge de Kinshasa', () => {
  it('jour et heure locale (UTC+1)', () => {
    expect(kinshasaClock(new Date('2026-10-21T23:30:00.000Z'))).toEqual({
      day: '2026-10-22',
      hour: 0,
    });
  });
  it('début du mois civil local, en UTC', () => {
    expect(kinshasaMonthStart(new Date('2026-10-21T08:00:00.000Z')).toISOString()).toBe(
      '2026-09-30T23:00:00.000Z',
    );
  });
});
