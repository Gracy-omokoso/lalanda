// GET /health côté web — proxy vers l'API + statut local.
// Brief §11 S0 « /health répond ».

import { NextResponse } from 'next/server';

interface WebHealth {
  status: 'ok' | 'degraded';
  service: 'lalanda-web';
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
    api,
  });
}
