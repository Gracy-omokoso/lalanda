// Commentaires, mentions, pièces jointes, temps passé et taux — ADR-0039 (lot L1).
//
// Critères d'acceptation couverts : 2 (`mentionedUserIds`, `attachmentIds`
// forgés), 7 (mentions éligibles, une notification, jamais l'auteur), 10
// (image réécrite, PDF en téléchargement, HTML renommé refusé 415), 11 (saisie
// future, dépassement de 1 440 minutes, saisie pour autrui sans work.manage).

import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}
function png(extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(64, 0);
  ihdr.writeUInt32BE(64, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_MAGIC,
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const kinshasaToday = (): string => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

e2eSuite('collaboration — commentaires, pièces jointes, temps (ADR-0039)', () => {
  const f = useWorkFixture('wcollab');
  let projectId = '';
  let taskId = '';

  function upload(who: 'owner' | 'analyst' | 'viewer' | 'ownerB', id: string, body: Buffer, name: string) {
    return f
      .post(who, `/work/tasks/${id}/attachments`)
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', encodeURIComponent(name))
      .send(body);
  }

  it('prépare un projet et une tâche', async () => {
    const p = await f.post('owner', '/work/projects', { name: 'Collab', kind: 'internal' });
    projectId = p.body.id;
    const t = await f.post('owner', `/work/projects/${projectId}/tasks`, { title: 'Carrelage' });
    expect(t.status).toBe(201);
    taskId = t.body.task.id;
  });

  describe('commentaires et mentions', () => {
    it('critère 7 : mentionner un membre sans work.read → 400 ; hors organisation → 404', async () => {
      const advisor = await f.post('analyst', `/work/tasks/${taskId}/comments`, {
        body: `Vu @[${f.userId('advisor')}]`,
        mentionedUserIds: [f.userId('advisor')],
      });
      expect(advisor.status).toBe(400);
      expect(f.issueCodes(advisor)).toContain('WORK_MENTION_NOT_ELIGIBLE');
      const foreign = await f.post('analyst', `/work/tasks/${taskId}/comments`, {
        body: 'Forgé',
        mentionedUserIds: [f.userId('ownerB')],
      });
      expect(foreign.status).toBe(404);
    });

    it('critère 7 : un mentionné éligible reçoit UNE notification, l’auteur aucune', async () => {
      f.notifications.length = 0;
      const res = await f.post('analyst', `/work/tasks/${taskId}/comments`, {
        body: `@[${f.userId('viewer')}] peux-tu vérifier ? @[${f.userId('analyst')}]`,
        mentionedUserIds: [f.userId('viewer'), f.userId('analyst')],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.mentions.map((m: { userId: string }) => m.userId)).toEqual([
        f.userId('viewer'),
        f.userId('analyst'),
      ]);
      const mentioned = f.notifications.filter((n) => n.kind === 'work.mentioned');
      expect(mentioned.map((n) => n.recipientUserId)).toEqual([f.userId('viewer')]);
      // Le créateur de la tâche (abonné) est prévenu du commentaire.
      const followed = f.notifications.filter((n) => n.kind === 'work.comment_on_followed');
      expect(followed.map((n) => n.recipientUserId)).toEqual([f.userId('owner')]);
      expect(f.notifications.some((n) => n.recipientUserId === f.userId('analyst'))).toBe(false);

      const detail = await f.get('owner', `/work/tasks/${taskId}`);
      expect(detail.body.followers.map((u: { userId: string }) => u.userId)).toEqual(
        expect.arrayContaining([f.userId('owner'), f.userId('analyst'), f.userId('viewer')]),
      );
      expect(detail.body.commentCount).toBe(1);
    });

    it('modifier : l’auteur seul ; supprimer : l’auteur ou un gestionnaire', async () => {
      const c = await f.post('accountant', `/work/tasks/${taskId}/comments`, { body: 'Premier jet' });
      expect(c.status).toBe(201);
      const other = await f.put('analyst', `/work/comments/${c.body.id}`, {
        body: 'Réécrit',
        expectedRevision: c.body.revision,
      });
      expect(other.status).toBe(403);
      const mine = await f.put('accountant', `/work/comments/${c.body.id}`, {
        body: 'Version propre',
        expectedRevision: c.body.revision,
      });
      expect(mine.status).toBe(200);
      expect(mine.body.editedAt).toEqual(expect.any(String));

      const analystDel = await f.del('analyst', `/work/comments/${c.body.id}`);
      expect(analystDel.status).toBe(403);
      const adminDel = await f.del('admin', `/work/comments/${c.body.id}`);
      expect(adminDel.status).toBe(204);
      const thread = await f.get('viewer', `/work/tasks/${taskId}/comments`);
      const deleted = thread.body.items.find((x: { id: string }) => x.id === c.body.id);
      expect(deleted.body).toBe('');
      expect(deleted.deletedAt).toEqual(expect.any(String));
      expect(thread.body.items).toHaveLength(2);
    });

    it('critère 2 : commentaire illisible depuis l’organisation B', async () => {
      expect((await f.get('ownerB', `/work/tasks/${taskId}/comments`)).status).toBe(404);
    });
  });

  describe('pièces jointes', () => {
    it('critère 10 : une image est réécrite (métadonnées retirées) et servie inline', async () => {
      const secret = chunk('tEXt', Buffer.from('Comment\0Coordonnées privées', 'latin1'));
      const res = await upload('analyst', taskId, png([secret]), 'photo chantier.png');
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.contentType).toBe('image/png');
      expect(res.body.fileName).toBe('photo chantier.png');
      const stored = [...f.objects.values()].at(-1)!;
      expect(stored.body.includes(Buffer.from('privées', 'latin1'))).toBe(false);
      const dl = await f.get('viewer', `/work/attachments/${res.body.id}`);
      expect(dl.status).toBe(200);
      expect(dl.headers['content-type']).toBe('image/png');
      expect(dl.headers['content-disposition']).toMatch(/^inline;/);
      expect(dl.headers['x-content-type-options']).toBe('nosniff');
    });

    it('critère 10 : un PDF est servi en téléchargement, en-têtes inertes', async () => {
      const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1');
      const res = await upload('analyst', taskId, pdf, 'devis.pdf');
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const dl = await f.get('viewer', `/work/attachments/${res.body.id}`);
      expect(dl.status).toBe(200);
      expect(dl.headers['content-type']).toBe('application/pdf');
      expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
      expect(dl.headers['content-security-policy']).toContain('sandbox');
    });

    it('critère 10 : un fichier HTML renommé .pdf est refusé 415', async () => {
      const html = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');
      const res = await upload('analyst', taskId, html, 'facture.pdf');
      expect(res.status).toBe(415);
      expect(res.body.code).toBe('WORK_ATTACHMENT_TYPE');
    });

    it('rattachement à un commentaire ; pièce forgée d’une autre tâche : 404', async () => {
      const up = await upload('analyst', taskId, png(), 'plan.png');
      const other = await f.post('owner', `/work/projects/${projectId}/tasks`, { title: 'Autre' });
      const forged = await f.post('analyst', `/work/tasks/${other.body.task.id}/comments`, {
        body: 'Voir pièce',
        attachmentIds: [up.body.id],
      });
      expect(forged.status).toBe(404);
      const ok = await f.post('analyst', `/work/tasks/${taskId}/comments`, {
        body: 'Voir pièce',
        attachmentIds: [up.body.id],
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.attachments.map((a: { id: string }) => a.id)).toEqual([up.body.id]);
    });

    it('droits : le Lecteur ne dépose pas ; seul le déposant (ou un gestionnaire) retire', async () => {
      const viewer = await upload('viewer', taskId, png(), 'x.png');
      expect(viewer.status).toBe(403);
      const up = await upload('analyst', taskId, png(), 'a-retirer.png');
      expect((await f.del('accountant', `/work/attachments/${up.body.id}`)).status).toBe(403);
      expect((await f.get('ownerB', `/work/attachments/${up.body.id}`)).status).toBe(404);
      const before = f.objects.size;
      expect((await f.del('owner', `/work/attachments/${up.body.id}`)).status).toBe(204);
      expect(f.objects.size).toBe(before - 1);
      expect((await f.get('owner', `/work/attachments/${up.body.id}`)).status).toBe(404);
      const list = await f.get('viewer', `/work/tasks/${taskId}/attachments`);
      expect(list.body.items.map((a: { id: string }) => a.id)).not.toContain(up.body.id);
    });
  });

  describe('temps passé', () => {
    it('critère 11 : saisie future refusée ; journée au-delà de 1 440 minutes refusée', async () => {
      const today = kinshasaToday();
      const future = await f.post('analyst', `/work/tasks/${taskId}/time-entries`, {
        workedOn: addDays(today, 1),
        minutes: 60,
      });
      expect(future.status).toBe(400);
      expect(f.issueCodes(future)).toContain('WORK_TIME_IN_FUTURE');

      const day = addDays(today, -3);
      const big = await f.post('analyst', `/work/tasks/${taskId}/time-entries`, {
        workedOn: day,
        minutes: 1_400,
      });
      expect(big.status, JSON.stringify(big.body)).toBe(201);
      const over = await f.post('analyst', `/work/tasks/${taskId}/time-entries`, {
        workedOn: day,
        minutes: 41,
      });
      expect(over.status).toBe(400);
      expect(f.issueCodes(over)).toContain('WORK_TIME_DAY_OVERFLOW');
      const fits = await f.post('analyst', `/work/tasks/${taskId}/time-entries`, {
        workedOn: day,
        minutes: 40,
      });
      expect(fits.status).toBe(201);

      const task = await f.get('viewer', `/work/tasks/${taskId}`);
      expect(task.body.loggedMinutes).toBe(1_440);
    });

    it('critère 11 : saisir pour autrui sans work.manage → 403 ; avec → 201', async () => {
      const day = addDays(kinshasaToday(), -1);
      const refused = await f.post('analyst', `/work/tasks/${taskId}/time-entries`, {
        userId: f.userId('accountant'),
        workedOn: day,
        minutes: 30,
      });
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('WORK_TIME_FOR_OTHER');
      const ok = await f.post('owner', `/work/tasks/${taskId}/time-entries`, {
        userId: f.userId('accountant'),
        workedOn: day,
        minutes: 30,
        note: 'Saisi pour elle',
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.user.userId).toBe(f.userId('accountant'));
      expect(ok.body.createdBy).toBe(f.userId('owner'));

      const foreign = await f.post('owner', `/work/tasks/${taskId}/time-entries`, {
        userId: f.userId('ownerB'),
        workedOn: day,
        minutes: 30,
      });
      expect(foreign.status).toBe(404);
    });

    it('modifier, supprimer : le cache loggedMinutes suit ; vues en minutes, jamais de coût', async () => {
      const day = addDays(kinshasaToday(), -2);
      const e = await f.post('accountant', `/work/tasks/${taskId}/time-entries`, {
        workedOn: day,
        minutes: 60,
      });
      const before = (await f.get('viewer', `/work/tasks/${taskId}`)).body.loggedMinutes as number;
      const upd = await f.put('accountant', `/work/time-entries/${e.body.id}`, {
        expectedRevision: e.body.revision,
        minutes: 90,
      });
      expect(upd.status, JSON.stringify(upd.body)).toBe(200);
      expect((await f.get('viewer', `/work/tasks/${taskId}`)).body.loggedMinutes).toBe(before + 30);
      expect((await f.del('analyst', `/work/time-entries/${e.body.id}`)).status).toBe(403);
      expect((await f.del('accountant', `/work/time-entries/${e.body.id}`)).status).toBe(204);
      expect((await f.get('viewer', `/work/tasks/${taskId}`)).body.loggedMinutes).toBe(before - 60);

      const list = await f.get('viewer', `/work/time-entries?projectId=${projectId}`);
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).not.toMatch(/cost|hourly/i);
      const summary = await f.get('viewer', `/work/projects/${projectId}/time-summary`);
      expect(summary.status).toBe(200);
      expect(summary.body.totalMinutes).toBe(1_470);
      expect(summary.body.byMember).toHaveLength(2);
      expect((await f.get('ownerB', `/work/projects/${projectId}/time-summary`)).status).toBe(404);
    });
  });

  describe('taux horaires datés', () => {
    it('réservés à treasury.manage : l’Administrateur et l’Analyste reçoivent 403', async () => {
      expect((await f.get('analyst', '/work/rates')).status).toBe(403);
      const admin = await f.post('admin', '/work/rates', {
        userId: f.userId('analyst'),
        currency: 'USD',
        hourlyCost: '12.50',
        effectiveFrom: '2026-01-01',
      });
      expect(admin.status).toBe(403);
      expect(admin.body.action).toBe('treasury.manage');
    });

    it('le Propriétaire pose un taux (chaîne décimale), doublon refusé, retrait journalisé', async () => {
      const asNumber = await f.post('owner', '/work/rates', {
        userId: f.userId('analyst'),
        currency: 'USD',
        hourlyCost: 12.5,
        effectiveFrom: '2026-01-01',
      });
      expect(asNumber.status).toBe(400);
      expect(f.issueCodes(asNumber)).toContain('DECIMAL_MUST_BE_STRING');
      const res = await f.post('owner', '/work/rates', {
        userId: f.userId('analyst'),
        currency: 'USD',
        hourlyCost: '12.5',
        effectiveFrom: '2026-01-01',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.hourlyCost).toBe('12.50');
      const dup = await f.post('owner', '/work/rates', {
        userId: f.userId('analyst'),
        currency: 'USD',
        hourlyCost: '15.00',
        effectiveFrom: '2026-01-01',
      });
      expect(dup.status).toBe(409);
      const list = await f.get('accountant', '/work/rates');
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(1);
      expect((await f.get('ownerB', '/work/rates')).body.items).toHaveLength(0);
      expect((await f.del('ownerB', `/work/rates/${res.body.id}`)).status).toBe(404);
      expect((await f.del('owner', `/work/rates/${res.body.id}`)).status).toBe(204);
      const audit = await f
        .db()
        .collection('audit_events')
        .find({ action: { $in: ['work.rate.set', 'work.rate.removed'] } })
        .toArray();
      expect(audit).toHaveLength(2);
    });
  });
});
