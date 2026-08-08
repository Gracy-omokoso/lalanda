// `/compte/securite` — mot de passe, sessions actives, suppression du compte (S20b).

import type { Metadata } from 'next';

import { SecurityPanel } from '../_components/security-panel';

export const metadata: Metadata = { title: 'Sécurité — Mon compte · Lalanda' };

export default function AccountSecurityPage(): React.ReactElement {
  return <SecurityPanel />;
}
