// Client de la bibliothèque (ADR-0046 § 4.3) : le dépôt est un formulaire multipart,
// la recherche un corps POST ; titre, étiquettes et liens n'apparaissent jamais dans
// l'URL ni dans un en-tête.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { documentsApi, formulaireDepot, type DepotDocument } from './api-documents';

afterEach(() => {
  vi.unstubAllGlobals();
});

const META: DepotDocument = {
  title: 'Attestation fiscale Gombe',
  folderId: null,
  nature: 'certificate',
  tags: ['fiscal', 'secret-tag'],
  links: [{ entityType: 'supplier', entityId: 'a'.repeat(24) }],
  issuedOn: null,
  expiresOn: '2027-03-31',
  reminderDays: 45,
  sensitive: true,
  note: null,
};

describe('api-documents — dépôt multipart', () => {
  it('champs texte, étiquettes et liens en JSON, pièce en dernier', () => {
    const fd = formulaireDepot(META, new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'a.pdf');
    expect(fd.get('title')).toBe('Attestation fiscale Gombe');
    expect(fd.get('folderId')).toBe('');
    expect(JSON.parse(String(fd.get('tags')))).toEqual(['fiscal', 'secret-tag']);
    expect(JSON.parse(String(fd.get('links')))).toEqual(META.links);
    expect(fd.get('sensitive')).toBe('true');
    expect(fd.get('reminderDays')).toBe('45');
    expect(fd.has('issuedOn')).toBe(false);
    expect(fd.has('note')).toBe(false);
    expect(fd.get('file')).toBeInstanceOf(Blob);
  });

  it('l’envoi passe tout dans le corps : URL nue, aucun en-tête posé', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'd1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await documentsApi.upload(META, new File(['%PDF-1.4'], 'att.pdf', { type: 'application/pdf' }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/documents$/);
    expect(url).not.toMatch(/Gombe|fiscal|secret|\?/);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).toBeUndefined();
  });

  it('nouvelle version : multipart sur l’identifiant seul', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'd1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await documentsApi.addVersion(
      'd1',
      'Renouvelée',
      new File(['x'], 'v2.png', { type: 'image/png' }),
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/documents\/d1\/versions$/);
    expect((init.body as FormData).get('note')).toBe('Renouvelée');
  });

  it('un refus 415 garde son statut et son code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 'DOCUMENT_TYPE', message: 'Type refusé.' }), {
          status: 415,
        }),
      ),
    );
    await expect(
      documentsApi.upload(META, new File(['x'], 'a.docx', { type: 'application/msword' })),
    ).rejects.toMatchObject({ status: 415, detail: { code: 'DOCUMENT_TYPE' } });
  });
});

describe('api-documents — recherche et listes', () => {
  it('recherche : critères dans le corps de POST /documents/search', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], nextCursor: null, total: 0 }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    await documentsApi.search({ text: 'bail Gombe', tags: ['loyer'] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/documents\/search$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ text: 'bail Gombe', tags: ['loyer'] });
  });

  it('pièces d’une entité : identifiants seulement en requête', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ library: [], pieces: [] }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    await documentsApi.entityPieces('supplier', 's1');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toMatch(/\/documents\/entity-pieces\?entityType=supplier&entityId=s1$/);
  });
});
