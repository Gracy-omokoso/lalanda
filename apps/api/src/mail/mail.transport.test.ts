// Transport SMTP — AUCUN ENVOI RÉSEAU (S22a).
//
// `nodemailer` est remplacé par un module factice : ces tests vérifient ce que le
// transport DÉCIDE (envoyer, se replier, mettre en cache), pas ce qu'un serveur
// de mail en fait. Un test qui ouvrirait une connexion SMTP réelle serait lent,
// dépendant du réseau, et échouerait en CI pour une raison sans rapport avec le
// code testé.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));

vi.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => createTransport(...(args as [])),
}));

const { MailCredentialsProvider } = await import('./mail-credentials.provider.js');
const { SmtpMailTransport } = await import('./mail.transport.js');
type SmtpCredentials = import('./mail.types.js').SmtpCredentials;

/** Fournisseur d'identifiants pilotable — le seul point de configuration du transport. */
class StubCredentials extends MailCredentialsProvider {
  constructor(private creds: SmtpCredentials | null) {
    super();
  }
  setCreds(creds: SmtpCredentials | null): void {
    this.creds = creds;
  }
  async resolve(): Promise<SmtpCredentials | null> {
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
  host: 'smtp.exemple.com',
  port: 587,
  secure: false,
  user: 'utilisateur',
  password: 'motdepasse',
  from: 'Lalanda <no-reply@exemple.com>',
  ...over,
});

describe('SmtpMailTransport', () => {
  beforeEach(() => {
    sendMail.mockReset();
    createTransport.mockClear();
  });

  it("se replie sur le journal quand aucun SMTP n'est configuré, sans échouer", async () => {
    const transport = new SmtpMailTransport(new StubCredentials(null));

    const result = await transport.send(message);

    expect(result).toEqual({ delivered: false, reason: 'SMTP_NOT_CONFIGURED' });
    // Le point qui compte : rien n'est tenté vers le réseau, et l'appelant reçoit
    // un refus explicite plutôt qu'une exception.
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
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
