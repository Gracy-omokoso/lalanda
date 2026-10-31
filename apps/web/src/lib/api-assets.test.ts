// Client des équipements (ADR-0046 § 5.2) : routes et corps du contrat.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { assetsApi } from './api-assets';

afterEach(() => {
  vi.unstubAllGlobals();
});

function reponse(corps: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(corps), { status: 200 })),
    );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('api-assets', () => {
  it('registre : filtres par identifiants', async () => {
    const f = reponse({ items: [], nextCursor: null, valuesHidden: false });
    await assetsApi.list({ status: 'active', employeeId: 'e1' });
    expect((f.mock.calls[0] as [string])[0]).toMatch(/\/assets\?status=active&employeeId=e1$/);
  });

  it('affectation : POST /assets/:id/assign avec révision et bénéficiaire', async () => {
    const f = reponse({});
    await assetsApi.assign('a1', {
      expectedRevision: 2,
      assignee: { kind: 'employee', employeeId: 'e1' },
      from: '2026-10-31',
    });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/assets\/a1\/assign$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({
      expectedRevision: 2,
      assignee: { kind: 'employee', employeeId: 'e1' },
    });
  });

  it('retour, maintenance faite, échéances', async () => {
    const f = reponse({});
    await assetsApi.giveBack('a1', { expectedRevision: 3 });
    await assetsApi.completeMaintenance('a1', 'm1', { expectedRevision: 1, doneOn: '2026-10-31' });
    await assetsApi.deadlines(30);
    const urls = f.mock.calls.map((c) => (c as [string])[0]);
    expect(urls[0]).toMatch(/\/assets\/a1\/return$/);
    expect(urls[1]).toMatch(/\/assets\/a1\/maintenance\/m1\/done$/);
    expect(urls[2]).toMatch(/\/assets\/deadlines\?within=30$/);
  });

  it('export CSV : fichier et nom servis par l’API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('a;b', {
          status: 200,
          headers: { 'content-disposition': 'attachment; filename="registre.csv"' },
        }),
      ),
    );
    const r = await assetsApi.exportCsv();
    expect(r.nom).toBe('registre.csv');
  });
});
