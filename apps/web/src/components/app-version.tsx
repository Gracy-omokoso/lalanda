'use client';

// Version du logiciel en pied de page (ADR-0026 § 6.2) : un vérificateur DGI
// doit pouvoir « voir la version » depuis n'importe quel écran.

import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { WEB_APP_VERSION, libelleVersion } from '@/lib/app-version';

export function AppVersion({ className }: { className?: string }): React.ReactElement {
  const [apiVersion, setApiVersion] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    api
      .getHealth()
      .then((h) => {
        if (!annule) setApiVersion(h.version);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, []);

  return (
    <p className={className} data-testid="version-logiciel">
      {libelleVersion(WEB_APP_VERSION, apiVersion)}
    </p>
  );
}
