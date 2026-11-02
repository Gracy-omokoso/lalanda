// `/rh/evaluations` — évaluations, éteintes par défaut, performance.read ou personne concernée (§ 2.6). ADR-0051 § 10, lot H16.

import type { Metadata } from 'next';

import { Evaluations } from '../_components/evaluations';

export const metadata: Metadata = { title: 'Évaluations — Ressources humaines · Lalanda' };

export default function EvaluationsPage(): React.ReactElement {
  return <Evaluations />;
}
