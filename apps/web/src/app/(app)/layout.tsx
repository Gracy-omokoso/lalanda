import { AppHeader } from './_components/app-header';
import { PendingInvitationsBanner } from './_components/pending-invitations-banner';

export default function AppLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-8">
      <AppHeader />
      <PendingInvitationsBanner />
      {children}
    </div>
  );
}
