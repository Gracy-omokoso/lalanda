// `/idees` — Idea Lab : les idées de l'organisation (ADR-0036 § 1).

import type { Metadata } from 'next';

import { IdeasPanel } from './_components/ideas-panel';

export const metadata: Metadata = { title: 'Idées — Idea Lab · Lalanda' };

export default function IdeesPage(): React.ReactElement {
  return <IdeasPanel />;
}
