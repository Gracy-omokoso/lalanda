// Module mail (S22a) — câblage des trois pièces : identifiants → transport → service.
//
// GLOBAL, et c'est délibéré. `MailService` est consommé par `auth/` (au
// bootstrap, dans la factory better-auth), `account/` et `organizations/`. Sans
// `@Global`, chacun devrait importer `MailModule` — et la factory d'`AuthModule`
// dépendrait d'un ordre d'import plutôt que d'un contrat. Un module sans état,
// sans route et sans schéma est exactement le cas où `@Global` ne coûte rien.
//
// LES TROIS PROVIDERS SONT DÉCLARÉS PAR LEUR ABSTRACTION (`provide: X, useClass:
// Y`), pas par leur classe concrète. C'est ce qui rend chaque étage remplaçable
// sans toucher aux appelants :
//   - `MailCredentialsProvider` → base chiffrée le jour où `integrations/` existe
//     (ADR-0013). Ce module ne dépend PAS d'`integrations/` : il expose la prise.
//   - `MailTransport` → API HTTP d'un fournisseur, ou file d'attente.
//   - `MailService` → doublure en mémoire dans les tests.

import { Global, Module } from '@nestjs/common';

import {
  EnvMailCredentialsProvider,
  MailCredentialsProvider,
} from './mail-credentials.provider.js';
import { MailService, TemplatedMailService } from './mail.service.js';
import { MailTransport, SmtpMailTransport } from './mail.transport.js';

@Global()
@Module({
  providers: [
    { provide: MailCredentialsProvider, useClass: EnvMailCredentialsProvider },
    { provide: MailTransport, useClass: SmtpMailTransport },
    { provide: MailService, useClass: TemplatedMailService },
  ],
  exports: [MailService, MailTransport, MailCredentialsProvider],
})
export class MailModule {}
