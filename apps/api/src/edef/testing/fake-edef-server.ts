// Faux serveur e-MCF pour les tests — ADR-0021 §6.
//
// Serveur `node:http` sur un port éphémère, aucune dépendance ajoutée. Il imite
// la spécification PUBLIQUE (`docs/sources/dgi-rdc/edef-api-v2.0-2026-10-18.json`) :
// les routes `GET /api/info/status` et `GET /api/info/{liste}`, l'authentification
// `Authorization: Bearer <jeton>`, le 401 d'un jeton inconnu. AUCUN test
// automatisé n'appelle la DGI réelle.
//
// Les valeurs renvoyées pour les listes sont FICTIVES (codes des énumérations de
// la spécification publique, libellés neutres) : ce serveur prouve que le client
// sait lire la forme des réponses, il ne fait autorité sur aucune règle fiscale.
//
// Il enregistre chaque requête reçue, en-tête `Authorization` compris : c'est la
// preuve, côté test, que le jeton a bien été utilisé — et, à l'inverse, qu'aucune
// requête n'est partie quand la production est fermée.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeEdefTokenProfile {
  nif: string;
  nim: string;
  /** ISO 8601. */
  tokenValid: string;
  emcfStatus?: 'Enregistré' | 'Actif' | 'Désactivé';
  behaviour?:
    | 'ok'
    | 'unauthorized'
    | 'server_error'
    | 'slow'
    | 'malformed'
    | 'business_error'
    | 'status_false'
    /** Extension de test : réponse de plus de 1 Mio. */
    | 'oversized';
}

export interface FakeEdefRequest {
  method: string;
  path: string;
  authorization: string | null;
}

export interface FakeEdefServer {
  baseUrl: string;
  requests: FakeEdefRequest[];
  /** Remplace la liste des groupes de taxation renvoyée (test des instantanés). */
  setTaxGroups(groups: Record<string, number>): void;
  /** Ajoute ou remplace un profil de jeton en cours de test. */
  setToken(token: string, profile: FakeEdefTokenProfile): void;
  close(): Promise<void>;
}

/** Taux d'exemple du contrat ADR-0021 §10 — valeurs de test, pas une source. */
export const FAKE_DEFAULT_TAX_GROUPS: Record<string, number> = { a: 0, b: 16, c: 5, o: 1 };

const TYPE_LISTS: Record<string, Array<{ type: string; description: string }>> = {
  invoiceTypes: ['FV', 'FT', 'FA', 'EV', 'ET', 'EA'].map((type) => ({
    type,
    description: `Type ${type} (valeur fictive du faux serveur)`,
  })),
  paymentTypes: [
    'ESPECES',
    'VIREMENT',
    'CARTEBANCAIRE',
    'MOBILEMONEY',
    'CHEQUES',
    'CREDIT',
    'AUTRE',
  ].map((type) => ({ type, description: `Paiement ${type} (valeur fictive)` })),
  clientTypes: ['PP', 'PM', 'PC', 'PL', 'AO'].map((type) => ({
    type,
    description: `Client ${type} (valeur fictive)`,
  })),
  referenceTypes: [{ type: 'REF', description: 'Nature d’avoir (valeur fictive)' }],
  itemTypes: ['BIE', 'SER', 'TAX'].map((type) => ({
    type,
    description: `Article ${type} (valeur fictive)`,
  })),
};

export async function startFakeEdefServer(opts: {
  tokens: Record<string, FakeEdefTokenProfile>;
  taxGroups?: Record<string, number>;
  slowMs?: number;
}): Promise<FakeEdefServer> {
  const tokens = new Map(Object.entries(opts.tokens));
  let taxGroups = { ...(opts.taxGroups ?? FAKE_DEFAULT_TAX_GROUPS) };
  const slowMs = opts.slowMs ?? 20_000;
  const requests: FakeEdefRequest[] = [];
  const pending = new Set<NodeJS.Timeout>();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const authorization =
      typeof req.headers.authorization === 'string' ? req.headers.authorization : null;
    const path = (req.url ?? '/').split('?')[0]!;
    requests.push({ method: req.method ?? 'GET', path, authorization });

    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
    const profile = token ? tokens.get(token) : undefined;

    if (!profile || profile.behaviour === 'unauthorized') {
      return send(res, 401, 'application/problem+json', {
        type: 'https://tools.ietf.org/html/rfc7235#section-3.1',
        title: 'Unauthorized',
        status: 401,
      });
    }

    const respond = (): void => {
      if (req.method !== 'GET') return send(res, 405, 'application/json', {});
      switch (profile.behaviour) {
        case 'server_error':
          return send(res, 500, 'application/json', { title: 'Internal Server Error' });
        case 'malformed':
          res.writeHead(200, { 'content-type': 'application/json' });
          return void res.end('{"status": tru');
        case 'business_error':
          return send(res, 200, 'application/json', {
            errorCode: 'FAKE-1',
            errorDesc: 'Erreur métier simulée (faux serveur)',
          });
        case 'oversized':
          res.writeHead(200, { 'content-type': 'application/json' });
          return void res.end(`{"pad":"${'x'.repeat(1024 * 1024 + 16)}"}`);
        default:
          break;
      }

      if (path === '/api/info/status') {
        return send(res, 200, 'application/json', {
          status: profile.behaviour !== 'status_false',
          version: '2.0',
          nif: profile.nif,
          nim: profile.nim,
          tokenValid: profile.tokenValid,
          serverDateTime: new Date().toISOString(),
          emcfList: [
            {
              nim: profile.nim,
              status: profile.emcfStatus ?? 'Actif',
              shopName: 'Boutique de test',
              address1: '1, avenue Exemple',
              address2: 'Gombe',
              address3: 'Kinshasa',
              contact1: '+243 800 000 000',
              contact2: null,
              contact3: null,
            },
          ],
        });
      }
      if (path === '/api/info/taxGroups') return send(res, 200, 'application/json', taxGroups);
      if (path === '/api/info/currencyRates') {
        return send(res, 200, 'application/json', [
          {
            type: 'USD',
            description: 'Dollar américain (valeur fictive)',
            date: '2026-10-18T00:00:00',
            rate: 1,
          },
        ]);
      }
      const list = path.startsWith('/api/info/')
        ? TYPE_LISTS[path.slice('/api/info/'.length)]
        : null;
      if (list) return send(res, 200, 'application/json', list);
      return send(res, 404, 'application/json', { title: 'Not Found' });
    };

    if (profile.behaviour === 'slow') {
      const timer = setTimeout(() => {
        pending.delete(timer);
        if (!res.destroyed) respond();
      }, slowMs);
      pending.add(timer);
      return;
    }
    respond();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    setTaxGroups(groups) {
      taxGroups = { ...groups };
    },
    setToken(token, profile) {
      tokens.set(token, profile);
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const timer of pending) clearTimeout(timer);
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function send(res: ServerResponse, status: number, contentType: string, body: unknown): void {
  res.writeHead(status, { 'content-type': contentType });
  res.end(JSON.stringify(body));
}
