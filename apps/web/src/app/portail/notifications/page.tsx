// `/portail/notifications` — e-mails de l'espace externe (ADR-0079 § 9) : lien de
// désinscription des e-mails (`?jeton=`) ou réglage depuis l'espace.

import { Suspense } from 'react';

import { PreferencesNotifications } from '../_components/preferences-notifications';

export default function PortailNotificationsPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <PreferencesNotifications />
    </Suspense>
  );
}
