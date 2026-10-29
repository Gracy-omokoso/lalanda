// `/notifications` — boîte de notifications de l'appelant dans l'organisation
// active (ADR-0039 § 8, lot L2).

import type { Metadata } from 'next';

import { NotificationsPanel } from './_components/notifications-panel';

export const metadata: Metadata = { title: 'Notifications · Lalanda' };

export default function NotificationsPage(): React.ReactElement {
  return <NotificationsPanel />;
}
