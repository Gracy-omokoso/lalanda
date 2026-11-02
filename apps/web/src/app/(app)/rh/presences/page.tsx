// `/rh/presences` — pointage simple, éteint par défaut (§ 2.3). ADR-0051 § 10, lot H16.

import type { Metadata } from 'next';

import { Presences } from '../_components/presences';

export const metadata: Metadata = { title: 'Présences — Ressources humaines · Lalanda' };

export default function PresencesPage(): React.ReactElement {
  return <Presences />;
}
