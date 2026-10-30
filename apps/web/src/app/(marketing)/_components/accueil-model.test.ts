import { describe, expect, it } from 'vitest';

import { NAV_APPS } from '../../(app)/_components/nav-model';

import {
  APPS_PAR_MODULE,
  appNav,
  BLOCS_RUN,
  MODULES_PUBLICS,
  POINTS_EQUIPE,
  ROLES_EQUIPE,
} from './accueil-model';

describe('accueil public — rien que du livré', () => {
  it('présente les trois modules dans l’ordre BUILD → RUN → GROW', () => {
    expect(MODULES_PUBLICS.map((m) => m.label)).toEqual(['BUILD', 'RUN', 'GROW']);
    expect(MODULES_PUBLICS.map((m) => m.verb)).toEqual(['Concevoir', 'Exploiter', 'Croître']);
  });

  it('ne cite que des applications de la navigation, dans leur module', () => {
    for (const m of MODULES_PUBLICS) {
      for (const id of m.apps) {
        expect(appNav(id).module).toBe(m.id);
      }
    }
  });

  it('cite toutes les applications de chaque module (aucune oubliée)', () => {
    for (const m of MODULES_PUBLICS) {
      const attendues = NAV_APPS.filter((a) => a.module === m.id).map((a) => a.id);
      expect([...APPS_PAR_MODULE[m.id]].sort()).toEqual([...attendues].sort());
    }
  });

  it('détaille six blocs RUN, chacun adossé à une application RUN existante', () => {
    expect(BLOCS_RUN.map((b) => b.app)).toEqual([
      'factures',
      'devis',
      'encaissements',
      'tresorerie',
      'projets',
      'crm',
    ]);
    for (const b of BLOCS_RUN) expect(appNav(b.app).module).toBe('run');
  });

  it('marque la normalisation DGI en production comme non ouverte', () => {
    const dgi = BLOCS_RUN.find((b) => b.app === 'factures')!.points.filter((p) =>
      p.texte.includes('homologation'),
    );
    expect(dgi).toHaveLength(1);
    expect(dgi[0]!.etat).toBe('bientot');
  });

  it('marque les autorisations sur mesure comme non ouvertes, et elles seules', () => {
    const bientot = POINTS_EQUIPE.filter((p) => p.etat === 'bientot').map((p) => p.titre);
    expect(bientot).toEqual(['Autorisations sur mesure']);
  });

  it('cite le rôle Commercial parmi les rôles attribuables', () => {
    expect(ROLES_EQUIPE).toContain('Commercial');
    expect(ROLES_EQUIPE).toHaveLength(8);
  });

  it('lève sur une application inconnue', () => {
    expect(() => appNav('inexistante')).toThrow();
  });
});
