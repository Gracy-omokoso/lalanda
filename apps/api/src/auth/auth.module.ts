// Module Auth : initialise better-auth au bootstrap et expose l'instance aux guards.
// Le montage HTTP effectif se fait dans main.ts via un middleware Express (voir toNodeHandler).

import { Global, Inject, Module, type OnModuleInit, type Provider } from '@nestjs/common';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { buildAuth, type UserCreatedHook } from './auth.js';
import { AuthGuard } from './auth.guard.js';

export const AUTH_TOKEN = Symbol('BETTER_AUTH');

const authProvider: Provider = {
  provide: AUTH_TOKEN,
  useFactory: async (orgs: OrganizationsService) => {
    const onUserCreated: UserCreatedHook = async (user) => {
      // Auto-provisionne l'organisation personnelle à l'inscription (S4a).
      const label = user.name?.trim().length ? user.name : user.email.split('@')[0]!;
      await orgs.provisionPersonalOrgForUser(user.id, label);
    };

    return buildAuth({
      mongodbUri: process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017/lalanda',
      mongodbDb: process.env['MONGODB_DB'] ?? 'lalanda',
      baseUrl: process.env['API_URL'] ?? 'http://localhost:3001',
      secret: process.env['AUTH_SECRET'] ?? '',
      trustedOrigins: [process.env['WEB_URL'] ?? 'http://localhost:3000'],
      onUserCreated,
    });
  },
  inject: [OrganizationsService],
};

@Global()
@Module({
  imports: [OrganizationsModule],
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
