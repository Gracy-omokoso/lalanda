// Notifications d'un import regroupées — ADR-0066 § 5 (risque relevé par ADR-0062),
// contre la vraie application.
//
// Un import qui assigne N tâches à une même personne envoie UNE notification
// (« N tâches vous ont été assignées dans le projet X ») sur chaque canal choisi —
// cloche, e-mail (transport espionné : aucun envoi réel), message privé Slack (port
// remplacé : aucun appel à Slack) — et un seul événement dans le canal du projet. Une
// seule tâche pour une personne : la notification habituelle. Le geste unitaire ne
// change pas. Un import refusé n'envoie rien.

import 'reflect-metadata';

import { beforeAll, expect, it, vi } from 'vitest';

import { MailTransport } from '../mail/mail.transport.js';
import type { MailMessage } from '../mail/mail.types.js';
import type { SlackChannelEvent, SlackDirectMessage } from '../slack/slack-notifier.service.js';
import { WorkNotifier } from '../work/work-notifier.js';
import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

const csv = (lines: string[]) => Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');

e2eSuite('import : notifications d’assignation regroupées — ADR-0066 § 5', () => {
  const f = useWorkFixture('wgroup');
  const mails: MailMessage[] = [];
  const directs: SlackDirectMessage[] = [];
  const channel: SlackChannelEvent[] = [];
  let projectId = '';

  const upload = (path: string, body: Buffer) =>
    f
      .postRaw('owner', path)
      .set('content-type', 'application/octet-stream')
      .set('x-file-name', 'plan.csv')
      .send(body);
  const pourAnalyste = () => {
    const analyst = f.userId('analyst');
    return {
      bell: f.notifications.filter(
        (n) => n.recipientUserId === analyst && n.kind === 'work.task_assigned',
      ),
      slack: directs.filter((d) => d.recipientUserId === analyst),
    };
  };
  const reset = () => {
    f.notifications.length = 0;
    mails.length = 0;
    directs.length = 0;
    channel.length = 0;
  };

  beforeAll(() => {
    vi.spyOn(f.app().get(MailTransport), 'send').mockImplementation(async (m: MailMessage) => {
      mails.push(m);
      return { delivered: true } as never;
    });
    f.app().get(WorkNotifier).slack = {
      direct: (_org, _project, messages) => {
        directs.push(...messages);
      },
      channel: (event) => {
        channel.push(event);
      },
    };
  });

  it('montage : par défaut, l’assignation part par cloche, e-mail et Slack', async () => {
    const prefs = await f.get('analyst', '/work/notification-preferences');
    expect(prefs.status).toBe(200);
    expect(prefs.body.events.task_assigned).toEqual({
      bell: true,
      email: true,
      slack: true,
      whatsapp: true,
    });
    const p = await f.post('owner', '/work/projects', {
      name: 'Boutique Matonge',
      kind: 'internal',
    });
    expect(p.status).toBe(201);
    projectId = p.body.id;
  });

  it('12 tâches importées pour la même personne : une notification par canal', async () => {
    reset();
    const lignes = ['Tâche;Responsable;Échéance'];
    for (let i = 1; i <= 12; i += 1) lignes.push(`Tâche ${i};Membre analyst;15/01/2027`);
    lignes.push('Tâche du gérant;Membre accountant;16/01/2027');
    const res = await upload(`/work/projects/${projectId}/import`, csv(lignes));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.createdTasks).toBe(13);

    const { bell, slack } = pourAnalyste();
    expect(bell).toHaveLength(1);
    expect(bell[0]!.title).toBe('12 tâches vous ont été assignées dans le projet Boutique Matonge');
    expect(bell[0]!.href).toBe(`/projets/${projectId}/liste`);
    expect(slack).toHaveLength(1);
    expect(slack[0]!.title).toBe(bell[0]!.title);
    const mailsAnalyste = mails.filter((m) =>
      JSON.stringify(m).includes('12 tâches vous ont été assignées'),
    );
    expect(mailsAnalyste).toHaveLength(1);
    // Une seule tâche pour le Comptable : la notification habituelle.
    const gerant = f.notifications.filter((n) => n.recipientUserId === f.userId('accountant'));
    expect(gerant.map((n) => n.title)).toEqual([expect.stringMatching(/vous a assigné #\d+ /)]);
    // Le canal du projet : un événement par personne, pas par tâche.
    expect(channel.filter((c) => c.eventLabel === 'Tâches assignées')).toHaveLength(1);
    expect(channel.filter((c) => c.eventLabel === 'Tâche assignée')).toHaveLength(1);
  });

  it('le geste unitaire garde son comportement : une notification par tâche', async () => {
    reset();
    for (const title of ['Vitrine', 'Enseigne']) {
      const t = await f.post('owner', `/work/projects/${projectId}/tasks`, {
        title,
        assigneeUserId: f.userId('analyst'),
      });
      expect(t.status).toBe(201);
    }
    const { bell, slack } = pourAnalyste();
    expect(bell).toHaveLength(2);
    expect(bell.every((n) => /vous a assigné #\d+ /.test(n.title))).toBe(true);
    expect(slack).toHaveLength(2);
  });

  it('un import refusé n’envoie rien', async () => {
    reset();
    const res = await upload(
      `/work/projects/${projectId}/import`,
      csv(['Tâche;Responsable;Échéance', 'A;Membre analyst;15/01/2027', 'B;;31/02/2027']),
    );
    expect(res.status).toBe(422);
    expect(pourAnalyste().bell).toHaveLength(0);
    expect(mails).toHaveLength(0);
  });
});
