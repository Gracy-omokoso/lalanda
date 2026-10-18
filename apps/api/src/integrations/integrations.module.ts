// Module intégrations (S21b — ADR-0013).
//
// Exporte `SecretsService` : c'est par lui que les CONSOMMATEURS de secrets
// (module IA aujourd'hui, transport SMTP et client S3 demain) obtiennent une
// valeur. Hors `ReauthService` et le coffre d'organisation `ORGANIZATION_SECRETS`
// (ADR-0021 §11), rien d'autre n'est exporté — surtout pas
// `IntegrationsService`, dont les méthodes d'écriture n'ont aucune raison d'être
// appelées hors de `/admin`.

import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { CONNECTION_TESTER, HttpConnectionTester } from './connection-tests.js';
import { Integration, IntegrationSchema } from './integration.schema.js';
import { IntegrationsController, ReauthController } from './integrations.controller.js';
import { IntegrationsService } from './integrations.service.js';
import { MasterKeyringProvider } from './keyring.provider.js';
import { OrganizationSecret, OrganizationSecretSchema } from './organization-secret.schema.js';
import { ORGANIZATION_SECRETS } from './organization-secrets.port.js';
import { OrganizationSecretsService } from './organization-secrets.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { PlatformReauth, PlatformReauthSchema } from './reauth.schema.js';
import { RecentReauthGuard } from './reauth.guard.js';
import { ReauthService } from './reauth.service.js';
import { RewrapService } from './rewrap.js';
import { SecretsService } from './secrets.service.js';
import { SessionReauthController } from './session-reauth.controller.js';

@Module({
  imports: [
    // Requis pour instancier `AuthGuard`, qui dépend d'`OrganizationsService`.
    OrganizationsModule,
    MongooseModule.forFeature([
      { name: Integration.name, schema: IntegrationSchema },
      { name: PlatformReauth.name, schema: PlatformReauthSchema },
      // Coffre de portée organisation (ADR-0021 §4.2). Seuls `OrganizationSecretsService`
      // et la rotation (`RewrapService`) reçoivent ce modèle : `SecretsService` n'y a
      // aucun accès, par construction.
      { name: OrganizationSecret.name, schema: OrganizationSecretSchema },
    ]),
  ],
  controllers: [IntegrationsController, ReauthController, SessionReauthController],
  providers: [
    MasterKeyringProvider,
    SecretsService,
    IntegrationsService,
    PlatformAuditService,
    ReauthService,
    RecentReauthGuard,
    RewrapService,
    OrganizationSecretsService,
    // Le module fiscal n'injecte que le PORT (`@Inject(ORGANIZATION_SECRETS)`), jamais
    // la classe concrète : il ne dépend ni de la clé maîtresse ni de ce modèle.
    { provide: ORGANIZATION_SECRETS, useExisting: OrganizationSecretsService },
    { provide: CONNECTION_TESTER, useClass: HttpConnectionTester },
  ],
  // `ReauthService` est exporté depuis ADR-0021 §11 : les écritures sensibles du
  // module fiscal exigent la même fenêtre de ré-authentification liée à la session
  // qu'`/admin` (ADR-0013 §5), et un seul mécanisme vaut mieux que deux.
  exports: [
    SecretsService,
    PlatformAuditService,
    RewrapService,
    ReauthService,
    RecentReauthGuard,
    ORGANIZATION_SECRETS,
  ],
})
export class IntegrationsModule implements OnApplicationBootstrap {
  constructor(private readonly secrets: SecretsService) {}

  /**
   * Journalise la source effective de chaque secret au démarrage — second
   * garde-fou d'ADR-0013 option C, sans lequel « une variable d'environnement
   * oubliée masque silencieusement une clé pourtant rotée en base ».
   *
   * Un échec ne bloque pas le démarrage : la base peut être joignable une seconde
   * plus tard, et refuser de démarrer pour un journal d'information transformerait
   * une aide au diagnostic en panne.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.secrets.logResolutionSources();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        '[integrations] sources de secrets non journalisées au démarrage :',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
