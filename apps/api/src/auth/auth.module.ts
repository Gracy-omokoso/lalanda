// Module Auth : initialise better-auth au bootstrap et expose l'instance aux guards.
// Le montage HTTP effectif se fait dans main.ts via un middleware Express (voir toNodeHandler).

import { Global, Inject, Logger, Module, type OnModuleInit, type Provider } from '@nestjs/common';

import { MailModule } from '../mail/mail.module.js';
import { MailService } from '../mail/mail.service.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { buildAuth, isPartialGoogleConfig, resolveGoogleCredentials } from './auth.js';
import { AuthGuard } from './auth.guard.js';
import { AuthProvidersController } from './auth-providers.controller.js';

export const AUTH_TOKEN = Symbol('BETTER_AUTH');

const authProvider: Provider = {
  provide: AUTH_TOKEN,
  useFactory: async (orgs: OrganizationsService, mail: MailService) => {
    const onUserCreated = async (user: {
      id: string;
      email: string;
      name?: string | null;
    }): Promise<void> => {
      // Auto-provisionne l'organisation personnelle à l'inscription (S4a).
      const label = user.name?.trim().length ? user.name : user.email.split('@')[0]!;
      await orgs.provisionPersonalOrgForUser(user.id, label);
    };

    const google = resolveGoogleCredentials(process.env);
    if (isPartialGoogleConfig(process.env)) {
      // Une seule des deux variables : le bouton resterait caché et la cause
      // serait invisible. On le dit une fois, au démarrage, plutôt que de laisser
      // chercher.
      new Logger('AuthModule').warn(
        'Configuration Google incomplète : GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET ' +
          'doivent être renseignées toutes les deux. La connexion Google reste désactivée.',
      );
    }

    return buildAuth({
      mongodbUri: process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017/lalanda',
      mongodbDb: process.env['MONGODB_DB'] ?? 'lalanda',
      baseUrl: process.env['API_URL'] ?? 'http://localhost:3001',
      secret: process.env['AUTH_SECRET'] ?? '',
      trustedOrigins: [process.env['WEB_URL'] ?? 'http://localhost:3000'],
      // Parse strict : seule la chaîne "true" active la vérification (S16a).
      requireEmailVerification: process.env['AUTH_REQUIRE_EMAIL_VERIFICATION'] === 'true',
      onUserCreated,
      mail,
      google,
    });
  },
  inject: [OrganizationsService, MailService],
};

@Global()
@Module({
  imports: [OrganizationsModule, MailModule],
  controllers: [AuthProvidersController],
  providers: [authProvider, AuthGuard],
  exports: [authProvider, AuthGuard],
})
export class AuthModule implements OnModuleInit {
  constructor(@Inject(AUTH_TOKEN) private readonly _auth: unknown) {}
  onModuleInit(): void {
    // Force l'exécution du factory au démarrage (sinon initialisation paresseuse à la 1ʳᵉ requête).
    void this._auth;
  }
}
