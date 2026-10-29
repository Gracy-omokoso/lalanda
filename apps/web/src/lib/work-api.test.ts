// Client `work-api.ts` confronté aux formes réelles de l'API (`apps/api/src/work/**`) :
// enveloppes `{ items }` et `WorkPage`, routes, en-têtes des pièces jointes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_URL } from './api';
import { PAGES_MAX, toutesLesPages, workApi } from './work-api';

interface Appel {
  url: string;
  init: RequestInit | undefined;
}

let appels: Appel[];
let reponses: unknown[];

function repondre(...corps: unknown[]): void {
  reponses.push(...corps);
}

beforeEach(() => {
  appels = [];
  reponses = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    appels.push({ url, init });
    const corps = reponses.shift();
    return new Response(JSON.stringify(corps), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const chemin = (a: Appel) => a.url.slice(API_URL.length);

describe('workApi — formes de l’API réelle', () => {
  it('GET /work/members : déballe `{ items }`', async () => {
    const membre = { userId: 'u1', name: 'Kevin', canUpdate: true, canManage: false };
    repondre({ items: [membre] });
    await expect(workApi.listMembers()).resolves.toEqual([membre]);
    expect(chemin(appels[0]!)).toBe('/work/members');
  });

  it('tâches d’un projet : déballe `{ items }`', async () => {
    repondre({ items: [{ id: 't1' }] });
    await expect(workApi.listProjectTasks('p1', { done: false })).resolves.toEqual([{ id: 't1' }]);
    expect(chemin(appels[0]!)).toBe('/work/projects/p1/tasks?done=false');
  });

  it('historique d’une tâche : route propre à la tâche', async () => {
    repondre({ items: [], nextCursor: null });
    await workApi.listTaskActivity('t1', { limit: 100 });
    expect(chemin(appels[0]!)).toBe('/work/tasks/t1/activity?limit=100');
  });

  it('commentaires : enchaîne les pages `WorkPage` jusqu’au dernier curseur', async () => {
    repondre(
      { items: [{ id: 'c1' }], nextCursor: 'k1' },
      { items: [{ id: 'c2' }], nextCursor: null },
    );
    await expect(workApi.listComments('t1')).resolves.toEqual([{ id: 'c1' }, { id: 'c2' }]);
    expect(appels.map(chemin)).toEqual([
      '/work/tasks/t1/comments?limit=100',
      '/work/tasks/t1/comments?limit=100&cursor=k1',
    ]);
  });

  it('pièces jointes : `{ items }`, sans paramètre de liste', async () => {
    repondre({ items: [{ id: 'a1' }] });
    await expect(workApi.listAttachments('t1')).resolves.toEqual([{ id: 'a1' }]);
    expect(chemin(appels[0]!)).toBe('/work/tasks/t1/attachments');
  });

  it('dépôt : corps binaire, type du fichier, nom encodé URI', async () => {
    repondre({ id: 'a1' });
    const f = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'Devis été.pdf', {
      type: 'application/pdf',
    });
    await workApi.uploadAttachment('t1', f);
    const h = appels[0]!.init!.headers as Record<string, string>;
    expect(appels[0]!.init!.method).toBe('POST');
    expect(h['content-type']).toBe('application/pdf');
    expect(h['x-file-name']).toBe(encodeURIComponent('Devis été.pdf'));
    expect(appels[0]!.init!.body).toBe(f);
  });

  it('liste transverse : `WorkPage` avec curseur', async () => {
    repondre({ items: [], nextCursor: null });
    await workApi.listTasks({ assignee: 'me', limit: 100, cursor: 'k' });
    expect(chemin(appels[0]!)).toBe('/work/tasks?assignee=me&limit=100&cursor=k');
  });
});

describe('toutesLesPages', () => {
  it('s’arrête si le curseur se répète', async () => {
    const page = vi.fn(async () => ({ items: [1], nextCursor: 'meme' }));
    await expect(toutesLesPages(page)).resolves.toEqual([1, 1]);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it(`borne la lecture à ${PAGES_MAX} pages`, async () => {
    let n = 0;
    const page = vi.fn(async () => ({ items: [n], nextCursor: `k${(n += 1)}` }));
    const items = await toutesLesPages(page);
    expect(items).toHaveLength(PAGES_MAX);
  });
});
