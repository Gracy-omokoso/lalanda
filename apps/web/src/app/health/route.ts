// GET /health côté web — proxy vers l'API + statut local.
// Brief §11 S0 « /health répond ».

import { NextResponse } from 'next/server';

import { WEB_APP_VERSION } from '@/lib/app-version';

interface WebHealth {
  status: 'ok' | 'degraded';
  service: 'lalanda-web';
  /** Version de release inlinée au build (ADR-0026 § 6.2). */
  version: string;
  api: 'up' | 'down' | 'unreachable';
}

export async function GET(): Promise<NextResponse<WebHealth>> {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
  let api: WebHealth['api'] = 'down';
  try {
    const res = await fetch(`${apiUrl}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    api = res.ok ? 'up' : 'down';
  } catch {
    api = 'unreachable';
  }
  return NextResponse.json({
    status: api === 'up' ? 'ok' : 'degraded',
    service: 'lalanda-web',
    version: WEB_APP_VERSION,
    api,
  });
}
