// `/organisation/brief` — brief du matin (ADR-0033). Ouvert à tout membre
// (`analytics.read`) ; le bloc ventes suit `sales.read`, décidé par le serveur.

import type { Metadata } from 'next';

import { MorningBriefPanel } from '../_components/morning-brief-panel';

export const metadata: Metadata = { title: 'Brief du matin — Organisation · Lalanda' };

export default function MorningBriefPage(): React.ReactElement {
  return <MorningBriefPanel />;
}
