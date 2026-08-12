// Transport à deux chemins — AUCUN ENVOI VERS L'EXTÉRIEUR (S22a, étendu S22m).
//
// `nodemailer` est remplacé par un module factice : ces tests vérifient ce que le
// transport DÉCIDE (envoyer, se replier, mettre en cache), pas ce qu'un serveur
// de mail en fait. Un test qui ouvrirait une connexion SMTP réelle serait lent,
// dépendant du réseau, et échouerait en CI pour une raison sans rapport avec le
// code testé.
//
// Le chemin ZeptoMail, lui, est éprouvé contre un VRAI serveur HTTP local plutôt
// qu'un `fetch` détourné — même arbitrage que `integrations/connection-tests.test.ts` :
// un `fetch` remplacé enregistre ce que le code CROIT envoyer, un serveur local
// dit ce qui part réellement, en-têtes et corps compris.
//
// ── Ce que ce fichier verrouille avant tout ──────────────────────────────────
// Un échec d'envoi ne fait JAMAIS tomber l'opération métier, et ne disparaît
// JAMAIS en silence. Les deux moitiés comptent : la première est la promesse
// d'ADR-0014, la seconde est la seule trace qu'un utilisateur attend un email
// qui n'arrivera pas.

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));

vi.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => createTransport(...(args as [])),
}));

const { MailCredentialsProvider } = await import('./mail-credentials.provider.js');
const { SmtpMailTransport } = await import('./mail.transport.js');
type MailCredentials = import('./mail.types.js').MailCredentials;
type SmtpCredentials = import('./mail.types.js').SmtpCredentials;

/** Fournisseur d'identifiants pilotable — le seul point de configuration du transport. */
class StubCredentials extends MailCredentialsProvider {
  constructor(private creds: MailCredentials | null) {
    super();
  }
  setCreds(creds: MailCredentials | null): void {
    this.creds = creds;
  }
  async resolve(): Promise<MailCredentials | null> {
    return this.creds;
  }
}

const message = {
  to: 'destinataire@exemple.com',
  subject: 'Sujet de test',
  html: '<p>corps</p>',
  text: 'corps',
};

const creds = (over: Partial<SmtpCredentials> = {}): SmtpCredentials => ({
  kind: 'smtp',
  host: 'smtp.exemple.com',
  port: 587,
  secure: false,
  user: 'utilisateur',
  password: 'motdepasse',
  from: 'Lalanda <no-reply@exemple.com>',
  ...over,
});

// ─── Repli journal — la propriété qu'ADR-0014 déclare non négociable ─────────

describe('sans aucun chemin configuré', () => {
  beforeEach(() => {
    sendMail.mockReset();
    createTransport.mockClear();
  });

  it('se replie sur le journal sans échouer, et sans rien tenter vers le réseau', async () => {
    const transport = new SmtpMailTransport(new StubCredentials(null));

    const result = await transport.send(message);

    expect(result).toEqual({ delivered: false, reason: 'MAIL_NOT_CONFIGURED' });
    // Le point qui compte : rien n'est tenté vers le réseau, et l'appelant reçoit
    // un refus explicite plutôt qu'une exception.
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});

// ─── Chemin SMTP — non-régression S22a intégrale ─────────────────────────────

describe('chemin SMTP', () => {
  beforeEach(() => {
    sendMail.mockReset();
    createTransport.mockClear();
  });

  it("remet le message au serveur avec l'expéditeur configuré", async () => {
    const transport = new SmtpMailTransport(new StubCredentials(creds()));

    const result = await transport.send(message);

    expect(result).toEqual({ delivered: true });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Lalanda <no-reply@exemple.com>',
      to: 'destinataire@exemple.com',
      subject: 'Sujet de test',
      text: 'corps',
      html: '<p>corps</p>',
    });
  });

  it("n'authentifie pas quand aucun utilisateur n'est fourni (relais interne, MailHog)", async () => {
    const transport = new SmtpMailTransport(
      new StubCredentials(creds({ user: undefined, password: undefined })),
    );

    await transport.send(message);

    expect(createTransport).toHaveBeenCalledWith(
      expect.not.objectContaining({ auth: expect.anything() }),
    );
  });

  it('réutilise le transporteur entre deux envois identiques', async () => {
    const transport = new SmtpMailTransport(new StubCredentials(creds()));

    await transport.send(message);
    await transport.send(message);

    // Un transporteur par message rouvrirait une connexion TLS à chaque email.
    expect(createTransport).toHaveBeenCalledTimes(1);
  });

  it('recrée le transporteur quand les identifiants changent', async () => {
    const provider = new StubCredentials(creds());
    const transport = new SmtpMailTransport(provider);

    await transport.send(message);
    provider.setCreds(creds({ password: 'motdepasse-tourne' }));
    await transport.send(message);

    // Indispensable le jour où les identifiants viennent de la base : un cache
    // insensible à leur rotation continuerait d'utiliser l'ancien mot de passe.
    expect(createTransport).toHaveBeenCalledTimes(2);
  });

  it("rapporte l'échec d'envoi sans lever — l'opération métier ne doit pas tomber", async () => {
    sendMail.mockRejectedValueOnce(new Error('connexion refusée'));
    const transport = new SmtpMailTransport(new StubCredentials(creds()));

    const result = await transport.send(message);

    expect(result).toEqual({ delivered: false, reason: 'SMTP_ERROR' });
  });
});

// ─── Chemin ZeptoMail ────────────────────────────────────────────────────────

const JETON = 'jeton-zepto-de-test-ne-servant-a-rien';

interface RequeteRecue {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface ServeurLocal {
  origin: string;
  recues: RequeteRecue[];
  fermer: () => Promise<void>;
}

/** Serveur jetable qui enregistre tout ce qu'il reçoit et répond ce qu'on lui dit. */
async function serveurLocal(
  repondre: (req: IncomingMessage) => { status: number; body?: string },
): Promise<ServeurLocal> {
  const recues: RequeteRecue[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      recues.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      const { status, body: corps } = repondre(req);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(corps ?? '{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    recues,
    fermer: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function credsZepto(apiUrl: string, from = 'Lalanda <no-reply@lalanda.co>'): MailCredentials {
  return { kind: 'zeptomail', token: JETON, apiUrl, from };
}

describe('chemin ZeptoMail', () => {
  beforeEach(() => {
    sendMail.mockReset();
    createTransport.mockClear();
  });

  it('poste le message sur la route d’envoi, et n’ouvre AUCUNE connexion SMTP', async () => {
    const srv = await serveurLocal(() => ({ status: 201, body: '{"data":[]}' }));
    try {
      const transport = new SmtpMailTransport(
        new StubCredentials(credsZepto(`${srv.origin}/v1.1/email`)),
      );

      const result = await transport.send(message);

      expect(result).toEqual({ delivered: true });
      expect(srv.recues).toHaveLength(1);
      const req = srv.recues[0]!;
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/v1.1/email');
      // Le chemin ZeptoMail ne doit RIEN devoir à nodemailer : un transporteur
      // créé ici signalerait que les deux chemins se marchent dessus.
      expect(createTransport).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    } finally {
      await srv.fermer();
    }
  });

  it('authentifie par `Zoho-enczapikey`, ni Bearer ni Basic', async () => {
    const srv = await serveurLocal(() => ({ status: 201 }));
    try {
      await new SmtpMailTransport(new StubCredentials(credsZepto(`${srv.origin}/v1.1/email`))).send(
        message,
      );

      expect(srv.recues[0]!.headers['authorization']).toBe(`Zoho-enczapikey ${JETON}`);
    } finally {
      await srv.fermer();
    }
  });

  it('transmet le HTML ET la variante texte, et découpe l’expéditeur', async () => {
    const srv = await serveurLocal(() => ({ status: 201 }));
    try {
      await new SmtpMailTransport(new StubCredentials(credsZepto(`${srv.origin}/v1.1/email`))).send(
        message,
      );

      const charge = JSON.parse(srv.recues[0]!.body) as Record<string, unknown>;
      expect(charge['from']).toEqual({ address: 'no-reply@lalanda.co', name: 'Lalanda' });
      expect(charge['to']).toEqual([{ email_address: { address: 'destinataire@exemple.com' } }]);
      expect(charge['subject']).toBe('Sujet de test');
      expect(charge['htmlbody']).toBe('<p>corps</p>');
      // ADR-0014 §2 impose une variante texte complète. La perdre au transport la
      // rendrait invisible aux tests de gabarits, qui continueraient de la produire.
      expect(charge['textbody']).toBe('corps');
    } finally {
      await srv.fermer();
    }
  });

  it('accepte un expéditeur sans chevrons — `no-reply@lalanda.co` est légitime', async () => {
    const srv = await serveurLocal(() => ({ status: 201 }));
    try {
      await new SmtpMailTransport(
        new StubCredentials(credsZepto(`${srv.origin}/v1.1/email`, 'no-reply@lalanda.co')),
      ).send(message);

      const charge = JSON.parse(srv.recues[0]!.body) as { from?: unknown };
      expect(charge.from).toEqual({ address: 'no-reply@lalanda.co', name: 'Lalanda' });
    } finally {
      await srv.fermer();
    }
  });

  it('rapporte un jeton refusé (401) sans lever, et le motif nomme ZeptoMail', async () => {
    const srv = await serveurLocal(() => ({
      status: 401,
      body: '{"error":{"code":"TM_4001","message":"Invalid API Token found"}}',
    }));
    try {
      const result = await new SmtpMailTransport(
        new StubCredentials(credsZepto(`${srv.origin}/v1.1/email`)),
      ).send(message);

      // Ni exception, ni `delivered: true` : l'opération métier continue, mais
      // l'appelant sait que rien n'est parti et POURQUOI.
      expect(result).toEqual({ delivered: false, reason: 'ZEPTOMAIL_ERROR' });
    } finally {
      await srv.fermer();
    }
  });

  it('rapporte une erreur d’API (400) de la même façon', async () => {
    const srv = await serveurLocal(() => ({
      status: 400,
      body: '{"error":{"code":"TM_3301","message":"Mandatory Field missing"}}',
    }));
    try {
      const result = await new SmtpMailTransport(
        new StubCredentials(credsZepto(`${srv.origin}/v1.1/email`)),
      ).send(message);

      expect(result).toEqual({ delivered: false, reason: 'ZEPTOMAIL_ERROR' });
    } finally {
      await srv.fermer();
    }
  });

  it('survit à une réponse d’erreur illisible — le code HTTP suffit à conclure', async () => {
    // Un proxy ou une page d'erreur HTML à la place du JSON attendu ne doit pas
    // transformer un échec d'envoi en exception non rattrapée.
    const srv = await serveurLocal(() => ({ status: 502, body: '<html>Bad Gateway</html>' }));
    try {
      const result = await new SmtpMailTransport(
        new StubCredentials(credsZepto(`${srv.origin}/v1.1/email`)),
      ).send(message);

      expect(result).toEqual({ delivered: false, reason: 'ZEPTOMAIL_ERROR' });
    } finally {
      await srv.fermer();
    }
  });

  it('rapporte un échec RÉSEAU sans lever — hôte injoignable', async () => {
    // Port fermé sur la boucle locale : `fetch` rejette avant toute réponse. Ce
    // cas est celui d'une panne DNS ou d'une coupure sortante en production.
    const result = await new SmtpMailTransport(
      new StubCredentials(credsZepto('http://127.0.0.1:1/v1.1/email')),
    ).send(message);

    expect(result).toEqual({ delivered: false, reason: 'ZEPTOMAIL_ERROR' });
  });

  it('journalise TOUT échec — un envoi perdu ne disparaît jamais en silence', async () => {
    // La contrepartie de « aucune méthode ne lève » : sans cette ligne de journal,
    // un email jamais parti ne laisserait aucune trace, et le seul signal serait
    // la plainte d'un utilisateur des jours plus tard.
    const erreurs: string[] = [];
    const transport = new SmtpMailTransport(
      new StubCredentials(credsZepto('http://127.0.0.1:1/v1.1/email')),
    );
    const espion = vi
      .spyOn((transport as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
      .mockImplementation((m: string) => {
        erreurs.push(m);
      });

    await transport.send(message);
    espion.mockRestore();

    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]).toContain('zeptomail');
    expect(erreurs[0]).toContain('destinataire@exemple.com');
    expect(erreurs[0]).toContain('Sujet de test');
    // docs/17 § Journalisation : le corps porte le lien et son jeton. Jamais.
    expect(erreurs[0]).not.toContain('<p>corps</p>');
    // Le jeton d'envoi ne doit pas non plus s'y glisser par un message d'erreur.
    expect(erreurs[0]).not.toContain(JETON);
  });

  it('ne fait JAMAIS voyager le jeton ailleurs que dans `Authorization`', async () => {
    const srv = await serveurLocal(() => ({ status: 201 }));
    try {
      await new SmtpMailTransport(new StubCredentials(credsZepto(`${srv.origin}/v1.1/email`))).send(
        message,
      );

      expect(srv.recues[0]!.body).not.toContain(JETON);
      expect(srv.recues[0]!.url).not.toContain(JETON);
    } finally {
      await srv.fermer();
    }
  });
});
