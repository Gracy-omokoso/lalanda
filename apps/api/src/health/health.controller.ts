// Endpoint /health — brief §11 S0 « Fait quand : /health répond ».

import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

interface HealthResponse {
  status: 'ok' | 'degraded';
  service: 'lalanda-api';
  version: string;
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
      version: process.env['npm_package_version'] ?? '0.1.0',
      uptimeSec: Math.round(process.uptime()),
      checks: { mongo },
    };
  }
}
