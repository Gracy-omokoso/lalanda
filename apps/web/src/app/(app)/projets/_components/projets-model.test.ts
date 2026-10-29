import { TAG_COLORS } from '@lalanda/ui';
import { WORK_LABEL_COLORS } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import type { OrgAction } from '@/lib/api';

import { ONGLETS_PROJET, ongletDuChemin, ongletsVisibles } from './onglets-projet';
import {
  aujourdhui,
  etatEcheance,
  formatJour,
  formatMinutes,
  formulaireProjet,
  hrefTache,
  lireDuree,
  messageWork,
  peutGerer,
  peutLire,
  peutTravailler,
  preparerProjet,
  progression,
} from './projets-model';

describe('permissions — actions servies par le serveur, jamais un rôle', () => {
  it('lecteur, contributeur, gestionnaire', () => {
    const lecteur: OrgAction[] = ['work.read'];
    const contributeur: OrgAction[] = ['work.read', 'work.update'];
    const gestionnaire: OrgAction[] = ['work.read', 'work.update', 'work.manage'];
    expect([peutLire(lecteur), peutTravailler(lecteur), peutGerer(lecteur)]).toEqual([
      true,
      false,
      false,
    ]);
    expect(peutTravailler(contributeur)).toBe(true);
    expect(peutGerer(contributeur)).toBe(false);
    expect(peutGerer(gestionnaire)).toBe(true);
    expect(peutLire(null)).toBe(false);
  });
});

describe('onglets du projet (point de branchement L3b)', () => {
  it('Calendrier et Chronologie sont réservés mais jamais affichés tant qu’ils ne sont pas livrés', () => {
    const segs = ONGLETS_PROJET.map((o) => o.segment);
    expect(segs).toContain('calendrier');
    expect(segs).toContain('chronologie');
    const visibles = ongletsVisibles(['work.read', 'work.manage']).map((o) => o.segment);
    expect(visibles).toEqual(['liste', 'kanban', 'reglages']);
  });
  it('Réglages exige work.manage', () => {
    expect(ongletsVisibles(['work.read']).map((o) => o.segment)).toEqual(['liste', 'kanban']);
    expect(ongletsVisibles(null).map((o) => o.segment)).toEqual(['liste', 'kanban']);
  });
  it('un onglet livré par L3b apparaît sans autre changement', () => {
    const l3b = ONGLETS_PROJET.map((o) => (o.segment === 'calendrier' ? { ...o, livre: true } : o));
    expect(ongletsVisibles(['work.read'], l3b).map((o) => o.segment)).toEqual([
      'liste',
      'kanban',
      'calendrier',
    ]);
  });
  it('lit le segment du chemin', () => {
    expect(ongletDuChemin('/projets/abc/kanban')).toBe('kanban');
    expect(ongletDuChemin('/projets/abc')).toBeNull();
    expect(ongletDuChemin('/projets/mes-taches')).toBeNull();
  });
});

describe('étiquettes — la palette du design system est celle du contrat', () => {
  it('mêmes clés, même ordre', () => {
    expect([...TAG_COLORS]).toEqual([...WORK_LABEL_COLORS]);
  });
});

describe('dates et durées', () => {
  it('formatJour ne dépend pas du fuseau du navigateur', () => {
    expect(formatJour('2026-11-03')).toBe('3 nov. 2026');
    expect(formatJour('2026-01-31', false)).toBe('31 janv.');
    expect(formatJour(null)).toBe('—');
    expect(formatJour('n’importe quoi')).toBe('—');
  });
  it('aujourd’hui est le jour de Kinshasa (23 h 30 UTC → lendemain)', () => {
    expect(aujourdhui(new Date('2026-10-28T23:30:00Z'))).toBe('2026-10-29');
  });
  it('formatMinutes', () => {
    expect(formatMinutes(90)).toBe('1 h 30');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatMinutes(0)).toBe('0 min');
  });
  it('lireDuree accepte les écritures courantes et borne à une journée', () => {
    expect(lireDuree('90')).toBe(90);
    expect(lireDuree('1h30')).toBe(90);
    expect(lireDuree('1 h 30')).toBe(90);
    expect(lireDuree('2h')).toBe(120);
    expect(lireDuree('1,5 h')).toBe(90);
    expect(lireDuree('45 min')).toBe(45);
    expect(lireDuree('0')).toBeNull();
    expect(lireDuree('25h')).toBeNull();
    expect(lireDuree('abc')).toBeNull();
    expect(lireDuree('')).toBeNull();
  });
  it('etatEcheance', () => {
    const today = '2026-10-29';
    expect(etatEcheance({ done: false, dueDate: '2026-10-28' }, today)).toBe('en_retard');
    expect(etatEcheance({ done: false, dueDate: today }, today)).toBe('aujourdhui');
    expect(etatEcheance({ done: false, dueDate: '2026-10-30' }, today, 1)).toBe('bientot');
    expect(etatEcheance({ done: false, dueDate: '2026-10-31' }, today, 1)).toBeNull();
    expect(etatEcheance({ done: true, dueDate: '2026-10-01' }, today)).toBeNull();
    expect(etatEcheance({ done: false, dueDate: null }, today)).toBeNull();
  });
  it('progression', () => {
    expect(progression({ openTaskCount: 7, doneTaskCount: 3 })).toEqual({
      texte: '3 / 10 tâches terminées',
      pourcent: 30,
    });
    expect(progression({ openTaskCount: 0, doneTaskCount: 0 }).texte).toBe('Aucune tâche');
  });
});

describe('liens', () => {
  it('ouvre le panneau par ?tache=', () => {
    expect(hrefTache('p1', 't1')).toBe('/projets/p1/liste?tache=t1');
    expect(hrefTache('p1', 't1', 'kanban')).toBe('/projets/p1/kanban?tache=t1');
  });
});

describe('erreurs', () => {
  const err = (status: number, detail: unknown) =>
    Object.assign(new Error('x'), { status, detail });
  it('lit le code sous les deux formes', () => {
    expect(messageWork(err(409, { code: 'WORK_DEPENDENCY_CYCLE' }), 'repli')).toMatch(/boucle/);
    expect(
      messageWork(err(409, { error: { code: 'STALE_REVISION', message: 'x' } }), 'repli'),
    ).toMatch(/modifié/);
  });
  it('403, 415, inconnu', () => {
    expect(messageWork(err(403, {}), 'repli')).toMatch(/rôle/);
    expect(messageWork(err(415, 'texte'), 'repli')).toMatch(/PDF/);
    expect(messageWork(err(500, 'texte'), 'repli')).toBe('repli');
    expect(messageWork(null, 'repli')).toBe('repli');
  });
});

describe('formulaire de projet — même schéma que le serveur', () => {
  const id = 'a'.repeat(24);
  it('projet client avec liens', () => {
    const r = preparerProjet({
      ...formulaireProjet(),
      name: '  Chantier Gombe  ',
      customerId: id,
      quoteId: id,
      startDate: '2026-11-01',
      dueDate: '2026-12-01',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.corps.name).toBe('Chantier Gombe');
      expect(r.corps.links).toEqual({ customerId: id, opportunityId: null, quoteIds: [id] });
    }
  });
  it('projet interne : aucun lien envoyé', () => {
    const r = preparerProjet({
      ...formulaireProjet(),
      name: 'Site web',
      kind: 'internal',
      customerId: id,
    });
    expect(r.ok && r.corps.links).toBeUndefined();
  });
  it('erreurs par champ', () => {
    const r = preparerProjet({
      ...formulaireProjet(),
      name: ' ',
      startDate: '2026-12-01',
      dueDate: '2026-11-01',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.champs['name']).toBeDefined();
      expect(r.champs['dueDate']).toMatch(/précède/);
    }
  });
});
