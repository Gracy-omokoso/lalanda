// `/idees/validation` — comparaison des idées sur la grille de validation (ADR-0036 § 1, § 2).

import type { Metadata } from 'next';

import { ComparisonPanel } from '../_components/comparison-panel';

export const metadata: Metadata = { title: 'Validation — Idea Lab · Lalanda' };

export default function ValidationPage(): React.ReactElement {
  return <ComparisonPanel />;
}
