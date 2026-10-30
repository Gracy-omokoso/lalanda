'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAccesRh } from './rh-access';
import { destinationRh } from './rh-model';

export function ArriveeRh(): React.ReactElement {
  const router = useRouter();
  const { etat, actions } = useAccesRh();

  useEffect(() => {
    if (etat === 'pret') router.replace(destinationRh(actions));
  }, [etat, actions, router]);

  return (
    <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
      {etat === 'echec' ? 'Vos droits sont illisibles pour le moment.' : 'Chargement…'}
    </p>
  );
}
