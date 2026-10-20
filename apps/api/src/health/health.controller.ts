// Endpoint /health — brief §11 S0 « Fait quand : /health répond ».

import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { APP_VERSION } from './app-version.js';

interface HealthResponse {
  status: 'ok' | 'degraded';
  service: 'lalanda-api';
  /** Version de release (étiquette `vX.Y.Z` sans « v ») — ADR-0026 § 6.2. */
  version: string;
  /** `release` : injectée au build de l'image ; `package` : repli de développement. */
  versionSource: 'release' | 'package';
  uptimeSec: number;
  checks: {
    mongo: 'up' | 'down';
  };
}

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly mongo: Connection) {}

  @Get()
  check(): HealthResponse {
    // readyState : 0=disconnected, 1=connected, 2=connecting, 3=disconnecting.
    const mongo = this.mongo.readyState === 1 ? 'up' : 'down';
    return {
      status: mongo === 'up' ? 'ok' : 'degraded',
      service: 'lalanda-api',
      version: APP_VERSION.version,
      versionSource: APP_VERSION.source,
      uptimeSec: Math.round(process.uptime()),
      checks: { mongo },
    };
  }
}
