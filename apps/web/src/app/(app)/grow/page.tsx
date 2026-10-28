// `/grow` — bureau du module GROW (ADR-0038 § 2) : ses applications en tuiles.

import type { Metadata } from 'next';

import { ModuleDesk } from '../_components/module-desk';

export const metadata: Metadata = { title: 'GROW — Lalanda' };

export default function GrowDeskPage(): React.ReactElement {
  return <ModuleDesk module="grow" />;
}
