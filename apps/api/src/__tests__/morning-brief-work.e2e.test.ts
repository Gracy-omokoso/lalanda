// BRIEF DU MATIN × PROJETS ET TÂCHES, BOUT EN BOUT (ADR-0039 § 6.5, lot L4b).
//
// Sur un vrai serveur et une vraie base :
//
//  · FAITS PERSONNELS — l'Analyste avec deux tâches en retard voit
//    `mes_taches.en_retard = 2` et l'alerte R8 (critère d'acceptation n° 16) ;
//    l'Administrateur, dans la même organisation, voit SES tâches ;
//  · ORGANISATION — `taches.en_retard` compte les retards de tous, hors projets
//    archivés ; `projets_a_risque` (R9) : un jalon en retard suffit, deux
//    tâches en retard ne suffisent pas (seuil S7 = 3) ;
//  · MOINDRE PRIVILÈGE — le Conseiller (sans `work.read`) reçoit les faits
//    `hidden` et R8, R9 non évaluées ;
//  · ISOLATION — l'organisation B ne voit aucune tâche de A ;
//  · E-MAIL — chaque destinataire reçoit ses propres tâches.
//
// Les tâches sont créées par l'API du module (lot L1), pas insérées en base.

import { addDays, kinshasaDayOf } from '@lalanda/shared/work';
import { expect, it, vi } from 'vitest';

import { MailService } from '../mail/mail.service.js';
import { MorningBriefEmailJob } from '../morning-brief/morning-brief-email.job.js';
import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture, type WorkAccount } from './work-e2e-fixtures.js';

interface Fact {
  id: string;
  status: string;
  value: string | null;
}
interface BriefBody {
  brief: {
    version: string;
    facts: Fact[];
    alerts: { ruleId: string; message: string; actionPath: string }[];
    rulesSkipped: { ruleId: string; reason: string }[];
  };
}

const WORK_FACTS = [
  'mes_taches.en_retard',
  'mes_taches.aujourdhui',
  'taches.en_retard',
  'projets_a_risque',
] as const;

e2eSuite('brief du matin — tâches et projets à risque (ADR-0039 § 6.5)', () => {
  const f = useWorkFixture('bwork');
  // Jour de Kinshasa du test : toutes les échéances en dépendent.
  const today = kinshasaDayOf(new Date());
  const yesterday = addDays(today, -1);
  const lastWeek = addDays(today, -7);

  async function project(name: string): Promise<{ id: string; revision: number }> {
    const p = await f.post('owner', '/work/projects', { name, kind: 'internal' });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    return { id: p.body.id, revision: p.body.revision };
  }
  async function task(projectId: string, body: Record<string, unknown>): Promise<void> {
    const res = await f.post('owner', `/work/projects/${projectId}/tasks`, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
  async function brief(who: WorkAccount): Promise<BriefBody['brief']> {
    const res = await f.get(who, '/morning-brief');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body as BriefBody).brief;
  }
  const value = (b: BriefBody['brief'], id: string): string | null | undefined =>
    b.facts.find((x) => x.id === id)?.value;

  it('prépare les projets et les tâches', async () => {
    const analyst = f.userId('analyst');
    const admin = f.userId('admin');

    // Projet A : deux tâches en retard de l'Analyste, une du jour → pas à risque (2 < S7).
    const a = await project('Projet A');
    await task(a.id, { title: 'Retard 1', dueDate: yesterday, assigneeUserId: analyst });
    await task(a.id, { title: 'Retard 2', dueDate: lastWeek, assigneeUserId: analyst });
    await task(a.id, { title: 'Du jour', dueDate: today, assigneeUserId: analyst });
    await task(a.id, { title: 'Sans date', assigneeUserId: analyst });

    // Projet B : un jalon en retard (Administrateur) → à risque.
    const b = await project('Projet B');
    await task(b.id, {
      title: 'Jalon',
      dueDate: yesterday,
      isMilestone: true,
      assigneeUserId: admin,
    });

    // Projet archivé : ses retards ne comptent nulle part.
    const z = await project('Archivé');
    for (const t of ['Z1', 'Z2', 'Z3']) {
      await task(z.id, { title: t, dueDate: lastWeek, assigneeUserId: analyst });
    }
    const arch = await f.post('owner', `/work/projects/${z.id}/archive`, {
      expectedRevision: z.revision,
    });
    expect(arch.status, JSON.stringify(arch.body)).toBeLessThan(300);
  });

  it('critère 16 : deux tâches en retard → mes_taches.en_retard = 2 et la règle R8', async () => {
    const b = await brief('analyst');
    expect(b.version).toBe('1.2.0'); // ADR-0040 — C4
    expect(value(b, 'mes_taches.en_retard')).toBe('2');
    expect(value(b, 'mes_taches.aujourdhui')).toBe('1');
    const r8 = b.alerts.find((x) => x.ruleId === 'taches_en_retard');
    expect(r8?.actionPath).toBe('/projets/mes-taches');
    expect(r8?.message).toContain('2 tâches');
  });

  it('faits de l’organisation : retards de tous hors archivés, un projet à risque (jalon)', async () => {
    const b = await brief('admin');
    expect(value(b, 'mes_taches.en_retard')).toBe('1');
    expect(value(b, 'mes_taches.aujourdhui')).toBe('0');
    expect(value(b, 'taches.en_retard')).toBe('3');
    expect(value(b, 'projets_a_risque')).toBe('1');
    expect(b.alerts.map((x) => x.ruleId)).toContain('jalon_depasse');
  });

  it('critère 16 : sans work.read, faits masqués et règles non évaluées', async () => {
    const b = await brief('advisor');
    for (const id of WORK_FACTS) {
      expect(b.facts.find((x) => x.id === id)).toMatchObject({ status: 'hidden', value: null });
    }
    expect(b.rulesSkipped).toEqual(
      expect.arrayContaining([
        { ruleId: 'taches_en_retard', reason: 'hidden' },
        { ruleId: 'jalon_depasse', reason: 'hidden' },
      ]),
    );
  });

  it('isolation : l’organisation B ne voit aucune tâche de A', async () => {
    const b = await brief('ownerB');
    for (const id of WORK_FACTS) expect(value(b, id)).toBe('0');
  });

  it('e-mail : chaque destinataire reçoit SES tâches', async () => {
    for (const who of ['analyst', 'admin'] as const) {
      const r = await f.put(who, '/morning-brief/preferences', { emailDaily: true });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const mail = f.app().get(MailService);
    const spy = vi.spyOn(mail, 'sendMorningBrief').mockResolvedValue({ delivered: true } as never);
    try {
      // 9 h à Kinshasa, le jour du test.
      const report = await f
        .app()
        .get(MorningBriefEmailJob)
        .run(new Date(`${today}T08:00:00Z`));
      expect(report).toMatchObject({ claimed: 2, sent: 2 });
      const factsOf = (who: 'analyst' | 'admin'): string[] => {
        const call = spy.mock.calls.find((c) => c[0].to.includes(`-${who}-`));
        return call?.[0].facts ?? [];
      };
      expect(factsOf('analyst')).toEqual(
        expect.arrayContaining(['Mes tâches en retard : 2', 'Mes tâches du jour : 1']),
      );
      expect(factsOf('admin')).toEqual(
        expect.arrayContaining(['Mes tâches en retard : 1', 'Mes tâches du jour : 0']),
      );
    } finally {
      spy.mockRestore();
    }
  });
});
