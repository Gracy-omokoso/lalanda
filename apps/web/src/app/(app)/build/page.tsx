// `/build` — bureau du module BUILD (ADR-0038 § 2) : ses applications en tuiles.

import type { Metadata } from 'next';

import { ModuleDesk } from '../_components/module-desk';

export const metadata: Metadata = { title: 'BUILD — Lalanda' };

export default function BuildDeskPage(): React.ReactElement {
  return <ModuleDesk module="build" />;
}
