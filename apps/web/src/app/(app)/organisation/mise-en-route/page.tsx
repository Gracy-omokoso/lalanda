// `/organisation/mise-en-route` — parcours guidé d'une organisation (ADR-0030 § 8).
// Offert à tout membre : chaque étape explique elle-même un refus de rôle.

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { MiseEnRoute } from '../_components/mise-en-route';

export const metadata: Metadata = { title: 'Mise en route — Organisation · Lalanda' };

export default function OrganizationOnboardingPage(): React.ReactElement {
  // `useSearchParams` (étape demandée) exige une frontière Suspense au rendu statique.
  return (
    <Suspense fallback={null}>
      <MiseEnRoute />
    </Suspense>
  );
}
