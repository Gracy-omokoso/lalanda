// Client RH, lot H7 : l'envoi d'un document est un formulaire multipart ; rien dans l'URL.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formulaireDocument, hrAdminApi } from './api-hr-admin';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api-hr-admin — documents', () => {
  it('le formulaire porte les métadonnées et la pièce, booléens en texte', () => {
    const fd = formulaireDocument(
      { category: 'id_document', label: 'Passeport', expiresOn: '2027-01-01', sensitive: true },
      new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
      'passeport.pdf',
    );
    expect(fd.get('category')).toBe('id_document');
    expect(fd.get('label')).toBe('Passeport');
    expect(fd.get('expiresOn')).toBe('2027-01-01');
    expect(fd.get('sensitive')).toBe('true');
    expect(fd.has('issuedOn')).toBe(false);
    expect(fd.get('file')).toBeInstanceOf(Blob);
  });

  it('l’envoi passe tout dans le corps : URL nue, aucun en-tête de métadonnée', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'd1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const fichier = new File(['%PDF-1.4'], 'contrat.pdf', { type: 'application/pdf' });
    await hrAdminApi.uploadDocument(
      'e1',
      { category: 'contract', label: 'Contrat de Aline' },
      fichier,
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/hr\/employees\/e1\/documents$/);
    expect(url).not.toMatch(/Aline|contract|\?/);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).toBeUndefined();
  });

  it('la révélation demande une section, dans le corps', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ employeeId: 'e1', revealedAt: '', sections: {} }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await hrAdminApi.revealPrivate('e1', ['bankDetails']);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/hr\/employees\/e1\/private\/reveal$/);
    expect(JSON.parse(String(init.body))).toEqual({ sections: ['bankDetails'] });
  });
});
