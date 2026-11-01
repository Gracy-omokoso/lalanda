// `/crm/reglages` — réglages du pipeline (ADR-0035) et formulaire public de
// prospects (ADR-0048) ; écriture `crm.manage`.

import type { Metadata } from 'next';

import { CrmSettingsPanel } from '../_components/crm-settings-panel';
import { FormulairePublicReglages } from '../_components/formulaire-public-reglages';

export const metadata: Metadata = { title: 'Réglages du pipeline — CRM · Lalanda' };

export default function CrmSettingsPage(): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <CrmSettingsPanel />
      {/* ADR-0048 : formulaire public de prospects. */}
      <FormulairePublicReglages />
    </div>
  );
}
