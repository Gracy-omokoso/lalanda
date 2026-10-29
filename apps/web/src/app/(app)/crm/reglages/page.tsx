// `/crm/reglages` — réglages du pipeline (ADR-0035) ; écriture `crm.manage`.

import type { Metadata } from 'next';

import { CrmSettingsPanel } from '../_components/crm-settings-panel';

export const metadata: Metadata = { title: 'Réglages du pipeline — CRM · Lalanda' };

export default function CrmSettingsPage(): React.ReactElement {
  return <CrmSettingsPanel />;
}
