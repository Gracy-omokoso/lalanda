// `/compte/notifications` — écran unique « Mes notifications » (ADR-0079 § 8) : mode,
// canaux, tests, événement × canal, journal ; réglages de l'organisation pour les
// administrateurs (`organization.manage`).

import type { Metadata } from 'next';

import { NotificationsCompte } from '../../notifications/_components/notifications-compte';

export const metadata: Metadata = { title: 'Notifications — Mon compte · Lalanda' };

export default function AccountNotificationsPage(): React.ReactElement {
  return <NotificationsCompte />;
}
