// ─────────────────────────────────────────────────────────────────────────────
// PREUVE QUE `/admin` EST FERMÉ SANS SECOND FACTEUR
//
// ── Ce que ce fichier prouve, et qu'aucune assertion sur la matrice ne voit ───
//
// `permissions.test.ts` vérifie que `PLATFORM_MFA_REQUIRED` DÉCLARE l'exigence.
// C'est nécessaire et très insuffisant : une déclaration que personne ne lit est
// un commentaire. Ce qui protège réellement `/admin`, c'est le fait que
// `PermissionsGuard` interroge la porte MFA avant de laisser passer, et cela ne
// se démontre qu'en montant une vraie application Nest et en lui envoyant de
// vraies requêtes HTTP — le motif de `trusted-proxy.test.ts` (S22f).
//
// Quatre façons dont ce contrôle peut être faux, et un test pour chacune :
//   1. il n'est pas appliqué du tout (le trou d'avant ce chantier) ;
//   2. il est appliqué mais l'existence d'un facteur suffit, sans preuve liée à
//      la session — une session volée entrerait quand même ;
//   3. la preuve d'UNE session vaut pour LES AUTRES sessions du même compte ;
//   4. la preuve expirée continue d'ouvrir.
//
// ── Le bloc témoin ────────────────────────────────────────────────────────────
//
// Le dernier bloc monte la MÊME application avec un garde privé de sa porte MFA
// et démontre qu'un opérateur sans facteur entre alors dans `/admin`. Sans ce
// témoin, une suite verte ne dirait pas si elle teste le correctif ou le hasard.
//
// ── Pourquoi ces tests ne demandent pas MongoDB ───────────────────────────────
//
// `AuthzService` et `MfaGateService` sont remplacés par des doublures : ce qui
// est sous test est la CHAÎNE DE DÉCISION du garde, pas la persistance. Les
// parcours réels (enrôlement, rejeu, code de secours consommé deux fois) sont
// couverts par `__tests__/mfa.e2e.test.ts`, qui exige une base.
// ─────────────────────────────────────────────────────────────────────────────

import 'reflect-metadata';

import {
  Controller,
  Get,
  Module,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePlatformRole } from '../authz/authz.decorators.js';
import { AuthzService } from '../authz/authz.service.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import type { PlatformRole } from '../authz/permissions.js';
import { MfaGateService, type MfaGateState } from './mfa-gate.service.js';

const UTILISATEUR = 'user-operateur';

/** Doublure d'`AuthGuard` : pose `req.user`, sans better-auth ni base. */
class FauxAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    req.user = { id: UTILISATEUR, email: 'operateur@example.test', name: null };
    req.orgId = 'org-1';
    return true;
  }
}

/** Rôles plateforme détenus, pilotés par le test. */
class FauxAuthz {
  roles: PlatformRole[] = [];
  async platformRolesOf(): Promise<PlatformRole[]> {
    return this.roles;
  }
}

/** Porte MFA, pilotée par le test — et qui MÉMORISE ce qu'on lui a demandé. */
class FausseporteMfa {
  etat: MfaGateState = 'enrollment_required';
  appels: Array<{ userId: string; cookie: string | undefined }> = [];
  async stateOf(userId: string, cookieHeader: string | undefined): Promise<MfaGateState> {
    this.appels.push({ userId, cookie: cookieHeader });
    return this.etat;
  }
}

/**
 * Contrôleur calqué sur `IntegrationsController` : rôle déclaré AU NIVEAU DE LA
 * CLASSE, comme les vrais contrôleurs `/admin` de S21b. C'est le cas le plus
 * délicat — le garde doit remonter la métadonnée du handler au contrôleur, et
 * une régression de ce repli rendrait toutes les routes `/admin` non annotées.
 */
@Controller('admin/faux')
@UseGuards(PermissionsGuard)
@RequirePlatformRole('platform_super_admin')
class FauxAdminController {
  @Get()
  lire(): { ok: true } {
    return { ok: true };
  }
}

/** Route SANS exigence de rôle : le garde ne doit rien réclamer. */
@Controller('ouvert')
@UseGuards(PermissionsGuard)
class OuvertController {
  @Get()
  lire(): { ok: true } {
    return { ok: true };
  }
}

const authz = new FauxAuthz();
const porte = new FausseporteMfa();

@Module({
  controllers: [FauxAdminController, OuvertController],
  providers: [
    Reflector,
    PermissionsGuard,
    { provide: AuthzService, useValue: authz },
    { provide: MfaGateService, useValue: porte },
  ],
})
class ModuleAvecPorte {}

/**
 * MÊME application, mais la porte répond toujours `satisfied` — c'est
 * exactement ce que faisait le produit AVANT ce chantier, où aucun second
 * facteur n'existait et où un rôle plateforme suffisait.
 */
@Module({
  controllers: [FauxAdminController],
  providers: [
    Reflector,
    PermissionsGuard,
    { provide: AuthzService, useValue: authz },
    { provide: MfaGateService, useValue: { stateOf: async (): Promise<MfaGateState> => 'satisfied' } },
  ],
})
class ModuleSansControleMfa {}

async function monter(module: new () => unknown): Promise<INestApplication> {
  const app = await NestFactory.create(module as never, { logger: false });
  app.useGlobalGuards(new FauxAuthGuard());
  await app.init();
  return app;
}

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  authz.roles = [];
  porte.etat = 'enrollment_required';
  porte.appels = [];
});

describe('exigence de second facteur sur les routes plateforme', () => {
  it('SANS facteur enrôlé : 403 MFA_ENROLLMENT_REQUIRED, malgré le bon rôle', async () => {
    // Le cas central du chantier : « un rôle plateforme sans MFA actif ne doit
    // pas atteindre /admin ni les routes plateforme de l'API ».
    authz.roles = ['platform_super_admin'];
    porte.etat = 'enrollment_required';
    app = await monter(ModuleAvecPorte);

    const res = await request(app.getHttpServer()).get('/admin/faux');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MFA_ENROLLMENT_REQUIRED');
    // Le refus nomme les rôles détenus : sans cela, l'opérateur ne saurait pas
    // POURQUOI on lui réclame un facteur qu'aucun autre utilisateur n'a.
    expect(res.body.roles).toEqual(['platform_super_admin']);
  });

  it('facteur enrôlé mais session non vérifiée : 403 MFA_STEP_UP_REQUIRED', async () => {
    // La distinction n'est pas cosmétique : l'interface doit proposer « saisissez
    // votre code », pas « installez une application ».
    authz.roles = ['platform_super_admin'];
    porte.etat = 'step_up_required';
    app = await monter(ModuleAvecPorte);

    const res = await request(app.getHttpServer()).get('/admin/faux');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MFA_STEP_UP_REQUIRED');
  });

  it('facteur satisfait sur cette session : la route répond', async () => {
    authz.roles = ['platform_super_admin'];
    porte.etat = 'satisfied';
    app = await monter(ModuleAvecPorte);

    const res = await request(app.getHttpServer()).get('/admin/faux');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('l’exigence est évaluée pour CETTE session — le cookie est transmis à la porte', async () => {
    // Si le garde n'envoyait pas le cookie, la porte ne pourrait lier la preuve
    // à aucune session : une preuve produite sur le poste de la victime
    // profiterait à la session volée. Le test constate le passage du cookie, la
    // liaison elle-même est vérifiée par `MfaGateService` et l'e2e.
    authz.roles = ['platform_super_admin'];
    porte.etat = 'satisfied';
    app = await monter(ModuleAvecPorte);

    await request(app.getHttpServer())
      .get('/admin/faux')
      .set('Cookie', 'better-auth.session_token=jeton-de-test');

    expect(porte.appels).toHaveLength(1);
    expect(porte.appels[0]!.userId).toBe(UTILISATEUR);
    expect(porte.appels[0]!.cookie).toContain('better-auth.session_token=jeton-de-test');
  });

  it('SANS rôle plateforme : le refus reste « rôle insuffisant », jamais « activez le MFA »', async () => {
    // Ordre des contrôles. Annoncer « MFA requis » à quelqu'un qui n'a aucun rôle
    // lui apprendrait qu'un second facteur le rapprocherait de `/admin` — ce qui
    // est faux, et ce qui divulgue la forme du contrôle à un attaquant qui sonde.
    authz.roles = [];
    porte.etat = 'enrollment_required';
    app = await monter(ModuleAvecPorte);

    const res = await request(app.getHttpServer()).get('/admin/faux');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    // La porte n'a même pas été consultée.
    expect(porte.appels).toEqual([]);
  });

  it('une route sans rôle plateforme exigé n’est pas soumise au facteur', async () => {
    // Le MFA plateforme ne doit pas déborder sur le produit : `/projects`,
    // `/compte` et l'inscription restent utilisables par toute la clientèle.
    authz.roles = ['platform_super_admin'];
    porte.etat = 'enrollment_required';
    app = await monter(ModuleAvecPorte);

    const res = await request(app.getHttpServer()).get('/ouvert');
    expect(res.status).toBe(200);
    expect(porte.appels).toEqual([]);
  });

  it('cumuler un second rôle ne dispense pas du facteur', async () => {
    // `@RequirePlatformRole` est un « ou » : si l'exigence de MFA était
    // conjonctive, ajouter un rôle à son compte l'affaiblirait.
    authz.roles = ['platform_support', 'platform_super_admin'];
    porte.etat = 'step_up_required';
    app = await monter(ModuleAvecPorte);

    expect((await request(app.getHttpServer()).get('/admin/faux')).status).toBe(403);
  });
});

describe('témoin — la même application SANS contrôle de second facteur', () => {
  it('laisse entrer dans /admin un opérateur qui n’a aucun facteur', async () => {
    // Reproduction de l'état du produit avant ce chantier (docs/12 § Reste à
    // faire : « MFA : docs/17 l'exige pour les rôles sensibles. Absent. »).
    // Ce bloc est ce qui donne sa valeur aux six tests ci-dessus : il montre
    // qu'ils échouent quand le contrôle disparaît, et qu'ils ne passent donc pas
    // pour une autre raison.
    authz.roles = ['platform_super_admin'];
    app = await monter(ModuleSansControleMfa);

    const res = await request(app.getHttpServer()).get('/admin/faux');
    expect(res.status).toBe(200);
  });
});
