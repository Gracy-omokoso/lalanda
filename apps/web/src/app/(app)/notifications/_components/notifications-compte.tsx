'use client';

// Assemblage de `/compte/notifications` (ADR-0079 § 8) : « Mes notifications », puis, pour
// les administrateurs de l'organisation, ses réglages communs.

import { TabsNav } from '@lalanda/ui';
import { usePathname, useSearchParams } from 'next/navigation';

import { renderNextLink } from '@/components/next-link';

import { useShell } from '../../_components/shell-context';

import { MesNotifications } from './mes-notifications';
import { ReglagesOrganisation } from './reglages-organisation';

export function NotificationsCompte(): React.ReactElement {
  const { actions } = useShell();
  const pathname = usePathname();
  const params = useSearchParams();
  const admin = actions !== null && actions.includes('organization.manage');
  const onglet = admin && params.get('onglet') === 'organisation' ? 'organisation' : 'moi';

  return (
    <div className="flex flex-col gap-4">
      {admin ? (
        <TabsNav
          label="Notifications"
          items={[
            { label: 'Mes notifications', href: pathname, current: onglet === 'moi' },
            {
              label: 'Réglages de l’organisation',
              href: `${pathname}?onglet=organisation`,
              current: onglet === 'organisation',
            },
          ]}
          renderLink={renderNextLink}
        />
      ) : null}
      {onglet === 'organisation' ? <ReglagesOrganisation /> : <MesNotifications />}
    </div>
  );
}
