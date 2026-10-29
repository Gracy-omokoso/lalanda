// `/run` — bureau du module RUN (ADR-0038 § 2) : ses applications en tuiles.

import type { Metadata } from 'next';

import { ModuleDesk } from '../_components/module-desk';

export const metadata: Metadata = { title: 'RUN — Lalanda' };

export default function RunDeskPage(): React.ReactElement {
  return <ModuleDesk module="run" />;
}
