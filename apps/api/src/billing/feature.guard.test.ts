// `FeatureGuard` et `@RequireFeature` (ADR-0053 § 6.3 — lot P4).
//
// Deux familles de propriétés :
//
// 1. CÂBLAGE, par introspection de tous les contrôleurs décorés : la garde s'exécute
//    APRÈS `AuthGuard` et `PermissionsGuard` (ordre imposé par l'ADR), chaque clé du
//    catalogue est posée quelque part, et chaque contrôleur décoré sert bien l'un des
//    préfixes de routes que le catalogue annonce pour sa fonctionnalité.
// 2. DÉCISION, avec un service simulé : lecture toujours permise, case ouverte partout
//    permise SANS lecture, case fermée → 403 FEATURE_NOT_IN_PLAN, service absent →
//    refus (jamais d'ouverture par défaut).

import 'reflect-metadata';

import {
  ForbiddenException,
  InternalServerErrorException,
  UseGuards,
  type ExecutionContext,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { FEATURE_KEYS, FEATURES, isFeatureKey } from '@lalanda/shared/pricing';

import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import type { FeatureAccessService } from '../admin/features/feature-access.service.js';
import { FeatureGuard, RequireFeature } from './feature.guard.js';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fichiersDecores(): string[] {
  const trouves: string[] = [];
  const parcourir = (dossier: string): void => {
    for (const e of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, e.name);
      if (e.isDirectory()) {
        if (e.name !== '__tests__') parcourir(chemin);
      } else if (
        e.name.endsWith('.controller.ts') &&
        readFileSync(chemin, 'utf8').includes('@RequireFeature(')
      ) {
        trouves.push(chemin);
      }
    }
  };
  parcourir(RACINE);
  return trouves.sort();
}

interface Pose {
  fichier: string;
  cle: string;
  chemin: string;
  gardes: string;
}

/**
 * Lecture du SOURCE (rapide, sans charger cent contrôleurs) : chaque `@RequireFeature`
 * suit un `@Controller(...)` et précède immédiatement le `@UseGuards(...)` de la classe.
 */
function poses(): Pose[] {
  const out: Pose[] = [];
  for (const fichier of fichiersDecores()) {
    const lignes = readFileSync(fichier, 'utf8').split('\n');
    lignes.forEach((l, i) => {
      const m = /^@RequireFeature\('([a-z_]+)'\)/.exec(l);
      if (!m) return;
      const ctrl = /^@Controller\(\s*'([^']*)'/.exec(lignes[i - 1] ?? '');
      out.push({
        fichier: relative(RACINE, fichier),
        cle: m[1]!,
        chemin: ctrl ? `/${ctrl[1]}` : '',
        gardes: lignes[i + 1] ?? '',
      });
    });
  }
  return out;
}

describe('câblage de @RequireFeature', () => {
  const toutes = poses();

  it('chaque pose suit `@Controller` et précède `@UseGuards(AuthGuard, PermissionsGuard…)`', () => {
    expect(toutes.length).toBeGreaterThan(80);
    const fautifs = toutes
      .filter(
        (p) => p.chemin === '' || !/^@UseGuards\(AuthGuard, PermissionsGuard\b/.test(p.gardes),
      )
      .map((p) => p.fichier);
    expect(fautifs).toEqual([]);
  });

  it('ainsi placée, la garde s’exécute APRÈS AuthGuard et PermissionsGuard', () => {
    @RequireFeature('crm')
    @UseGuards(AuthGuard, PermissionsGuard)
    class Sonde {}
    const gardes = Reflect.getMetadata(GUARDS_METADATA, Sonde) as unknown[];
    expect(gardes).toEqual([AuthGuard, PermissionsGuard, FeatureGuard]);
  });

  it('chaque clé du catalogue est posée, et seulement sur les préfixes qu’il annonce', () => {
    expect(FEATURE_KEYS.filter((k) => !toutes.some((p) => p.cle === k))).toEqual([]);
    const normalise = (s: string) => s.replace(/:[A-Za-z]+/g, ':p');
    const horsPrefixe = toutes
      .filter((p) => {
        if (!isFeatureKey(p.cle)) return true;
        const c = normalise(p.chemin);
        return !FEATURES[p.cle].apiPrefixes.some((pre) => {
          const n = normalise(pre);
          return c === n || c.startsWith(`${n}/`) || n.startsWith(`${c}/`);
        });
      })
      .map((p) => `${p.fichier} (${p.chemin}) → ${p.cle}`);
    expect(horsPrefixe).toEqual([]);
  });
});

function contexte(method: string, req: Record<string, unknown> = {}): ExecutionContext {
  class Cible {}
  RequireFeature('crm')(Cible);
  const handler = () => undefined;
  return {
    getHandler: () => handler,
    getClass: () => Cible,
    switchToHttp: () => ({ getRequest: () => ({ method, ...req }) }),
  } as unknown as ExecutionContext;
}

function service(ouvertPartout: boolean, allowed: boolean) {
  return {
    isOpenEverywhere: vi.fn(() => ouvertPartout),
    decide: vi.fn(async () =>
      allowed
        ? { allowed: true, source: 'plan' }
        : { allowed: false, code: 'FEATURE_NOT_IN_PLAN', minimalPlan: 'pro' },
    ),
  };
}

describe('décision de FeatureGuard', () => {
  const reflector = new Reflector();
  const req = { user: { id: 'u1' }, orgId: 'o1' };

  it('lecture : toujours permise, sans consulter le service', async () => {
    const s = service(false, false);
    const g = new FeatureGuard(reflector, s as unknown as FeatureAccessService);
    await expect(g.canActivate(contexte('GET', req))).resolves.toBe(true);
    expect(s.isOpenEverywhere).not.toHaveBeenCalled();
  });

  it('grille ouverte partout : permise sans aucune décision en base', async () => {
    const s = service(true, false);
    const g = new FeatureGuard(reflector, s as unknown as FeatureAccessService);
    await expect(g.canActivate(contexte('POST', req))).resolves.toBe(true);
    expect(s.decide).not.toHaveBeenCalled();
  });

  it('case fermée : 403 FEATURE_NOT_IN_PLAN avec l’offre minimale', async () => {
    const s = service(false, false);
    const g = new FeatureGuard(reflector, s as unknown as FeatureAccessService);
    const err = await g.canActivate(contexte('POST', req)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: 'FEATURE_NOT_IN_PLAN',
      feature: 'crm',
      minimalPlan: 'pro',
    });
    expect(s.decide).toHaveBeenCalledWith('o1', 'crm');
  });

  it('l’organisation évaluée est celle de PermissionsGuard (`targetOrgId`) si elle existe', async () => {
    const s = service(false, true);
    const g = new FeatureGuard(reflector, s as unknown as FeatureAccessService);
    await g.canActivate(contexte('PATCH', { ...req, targetOrgId: 'o2' }));
    expect(s.decide).toHaveBeenCalledWith('o2', 'crm');
  });

  it('service absent sur un geste : refus, jamais d’ouverture par défaut', async () => {
    const g = new FeatureGuard(reflector, undefined);
    await expect(g.canActivate(contexte('DELETE', req))).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    await expect(g.canActivate(contexte('GET', req))).resolves.toBe(true);
  });

  it('route sans @RequireFeature : la garde n’ajoute rien', async () => {
    const g = new FeatureGuard(reflector, undefined);
    const ctx = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ method: 'POST' }) }),
    } as unknown as ExecutionContext;
    await expect(g.canActivate(ctx)).resolves.toBe(true);
  });
});
