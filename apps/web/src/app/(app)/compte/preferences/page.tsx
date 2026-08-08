// `/compte/preferences` — thème, devise par défaut, notifications (S20b).

import type { Metadata } from 'next';

import { PreferencesPanel } from '../_components/preferences-panel';

export const metadata: Metadata = { title: 'Préférences — Mon compte · Lalanda' };

export default function AccountPreferencesPage(): React.ReactElement {
  return <PreferencesPanel />;
}
