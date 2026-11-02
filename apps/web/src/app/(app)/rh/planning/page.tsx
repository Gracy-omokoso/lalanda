// `/rh/planning` — créneaux de la semaine, éteints par défaut (§ 2.4). ADR-0051 § 10, lot H16.

import type { Metadata } from 'next';

import { Planning } from '../_components/planning';

export const metadata: Metadata = { title: 'Planning — Ressources humaines · Lalanda' };

export default function PlanningPage(): React.ReactElement {
  return <Planning />;
}
