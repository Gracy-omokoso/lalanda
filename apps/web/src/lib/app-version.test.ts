import { afterEach, describe, expect, it, vi } from 'vitest';

import { libelleVersion } from './app-version';

/** Version inlinée par next.config.mjs, sous une valeur d'`APP_VERSION` donnée. */
async function versionInlinee(appVersion: string | undefined): Promise<string | undefined> {
  vi.resetModules();
  if (appVersion === undefined) vi.stubEnv('APP_VERSION', '');
  else vi.stubEnv('APP_VERSION', appVersion);
  const { default: config } = await import('../../next.config.mjs');
  return config.env?.['NEXT_PUBLIC_APP_VERSION'];
}

describe('version du logiciel (ADR-0026 § 6.2)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('une seule version quand l’interface et le serveur concordent', () => {
    expect(libelleVersion('0.9.3', null)).toBe('Lalanda v0.9.3');
    expect(libelleVersion('0.9.3', '0.9.3')).toBe('Lalanda v0.9.3');
  });

  it('les deux versions quand elles divergent', () => {
    expect(libelleVersion('0.9.3', '0.9.2')).toBe('Lalanda v0.9.3 (interface) · v0.9.2 (serveur)');
  });

  it('build de release : étiquette injectée, « v » retiré', async () => {
    expect(await versionInlinee('v0.9.3')).toBe('0.9.3');
  });

  it('sans étiquette valide : version du package.json marquée « -dev »', async () => {
    expect(await versionInlinee(undefined)).toMatch(/^\d+\.\d+\.\d+-dev$/);
    expect(await versionInlinee('latest')).toMatch(/-dev$/);
  });
});
