// `/rh/frais?vue=a-valider|a-payer|toutes` — frais et avances (ADR-0051 § 10, lot H16) ;
// cibles du brief R19 (`?vue=a-valider`) et R20 (`?vue=a-payer`).

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { FraisAvances } from '../_components/frais-avances';

export const metadata: Metadata = { title: 'Frais et avances — Ressources humaines · Lalanda' };

export default function FraisPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <FraisAvances />
    </Suspense>
  );
}
