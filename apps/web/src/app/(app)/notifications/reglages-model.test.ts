// « Mes notifications » — règles d'écran (ADR-0079 § 8).

import {
  notificationSpecOf,
  type NotificationChannelsView,
  type NotificationSettingsView,
} from '@lalanda/shared/notifications';
import { describe, expect, it } from 'vitest';

import {
  basculer,
  canauxDe,
  choisirMode,
  corpsReglages,
  etatCellule,
  groupesCatalogue,
  libelleSort,
  libelleType,
  modeAffiche,
  resumeModule,
  revenirOrigine,
} from './reglages-model';

function vue(over: Partial<NotificationSettingsView> = {}): NotificationSettingsView {
  return {
    mode: null,
    defaultMode: 'essentiel',
    projectLeadMode: 'attenue',
    effectiveMode: 'essentiel',
    overrides: { perroquet: {}, attenue: {}, essentiel: {} },
    customized: { perroquet: false, attenue: false, essentiel: false },
    notifyOwnActions: false,
    quietHours: { enabled: true, start: 21, end: 7 },
    mandatory: [],
    mutedKinds: [],
    migratedFrom: null,
    revision: 2,
    ...over,
  };
}
const spec = (k: string) => notificationSpecOf(k)!;

describe('catalogue groupé', () => {
  it('Projets en tête, familles dans l’ordre, aucun type perdu', () => {
    const g = groupesCatalogue();
    expect(g[0]!.module).toBe('work');
    expect(g[0]!.label).toBe('Projets');
    expect(g[0]!.familles.map((f) => f.label)).toContain('Temps');
    const total = g.flatMap((m) => m.familles.flatMap((f) => f.specs)).length;
    expect(total).toBeGreaterThan(70);
  });
});

describe('modes et surcharges', () => {
  it('mode affiché : le choisi, sinon le défaut', () => {
    expect(modeAffiche(vue())).toBe('essentiel');
    expect(modeAffiche(vue({ mode: 'perroquet' }))).toBe('perroquet');
  });

  it('basculer : surcharge du mode affiché, retirée quand on revient au défaut', () => {
    const s = spec('work.task_assigned');
    const v1 = basculer(vue({ mode: 'perroquet' }), s, 'whatsapp');
    expect(v1.overrides.perroquet).toEqual({ 'work.task_assigned': { whatsapp: false } });
    expect(v1.customized.perroquet).toBe(true);
    expect(v1.overrides.essentiel).toEqual({});
    const v2 = basculer(v1, s, 'whatsapp');
    expect(v2.overrides.perroquet).toEqual({});
    expect(v2.customized.perroquet).toBe(false);
  });

  it('changer de mode ne perd rien ; revenir à l’origine ne vide que le mode affiché', () => {
    const v = basculer(vue({ mode: 'perroquet' }), spec('work.task_assigned'), 'email');
    const autre = choisirMode(v, 'essentiel');
    expect(autre.overrides.perroquet).toEqual(v.overrides.perroquet);
    const v3 = basculer(autre, spec('work.mentioned'), 'bell');
    const origine = revenirOrigine(v3);
    expect(origine.overrides.essentiel).toEqual({});
    expect(origine.overrides.perroquet).toEqual(v.overrides.perroquet);
    expect(choisirMode(v, null).effectiveMode).toBe('essentiel');
  });

  it('corps du PUT', () => {
    expect(corpsReglages(vue({ mode: 'attenue' }))).toEqual({
      expectedRevision: 2,
      mode: 'attenue',
      overrides: { perroquet: {}, attenue: {}, essentiel: {} },
      notifyOwnActions: false,
      quietHours: { enabled: true, start: 21, end: 7 },
    });
  });
});

describe('cellules', () => {
  const canaux: NotificationChannelsView = {
    channels: [],
    whatsappKinds: ['work.task_assigned'],
    whatsappDailyCap: 20,
    whatsappSentToday: 0,
  };

  it('non permis, obligatoire, modèle en attente, réglable', () => {
    expect(etatCellule(vue(), spec('hr.leave_requested'), 'slack', canaux)).toEqual({
      etat: 'non_permis',
    });
    expect(
      etatCellule(
        vue({ mandatory: [{ kind: 'work.mentioned', channel: 'bell' }] }),
        spec('work.mentioned'),
        'bell',
        canaux,
      ),
    ).toEqual({ etat: 'obligatoire' });
    expect(etatCellule(vue(), spec('crm.activity_assigned'), 'whatsapp', canaux).etat).toBe(
      'indisponible',
    );
    expect(etatCellule(vue(), spec('crm.activity_assigned'), 'email', canaux)).toEqual({
      etat: 'reglable',
      coche: true,
    });
    expect(
      etatCellule(
        vue({ mode: 'perroquet' }),
        spec('purchases.approval_requested'),
        'whatsapp',
        canaux,
      ),
    ).toEqual({ etat: 'indisponible', raison: 'Modèle WhatsApp en attente d’approbation' });
    expect(etatCellule(vue(), spec('work.task_assigned'), 'whatsapp', canaux)).toEqual({
      etat: 'reglable',
      coche: true,
    });
  });

  it('type coupé dans l’ancienne page : cloche éteinte', () => {
    expect(canauxDe(vue({ mutedKinds: ['work.mentioned'] }), spec('work.mentioned')).bell).toBe(
      false,
    );
  });

  it('résumé d’un module replié', () => {
    const projets = groupesCatalogue(['work'])[0]!;
    expect(resumeModule(vue(), projets)).toMatch(/^\d+ actifs? sur \d+$/);
  });
});

describe('journal', () => {
  it('libellés des sorts et des types', () => {
    expect(libelleSort('sent', null)).toBe('Envoyée');
    expect(libelleSort('sent', 'grouped')).toBe('Envoyée (regroupée)');
    expect(libelleSort('skipped', 'quiet_hours')).toBe('Ignorée — Heures calmes');
    expect(libelleType('organization.notification_test')).toBe('Notification de test');
    expect(libelleType('work.task_assigned')).toBe('Une tâche m’est assignée');
  });
});
