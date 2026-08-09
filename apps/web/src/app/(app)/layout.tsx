import { LegalLinks } from '@/components/legal-links';

import { AppHeader } from './_components/app-header';
import { PendingInvitationsBanner } from './_components/pending-invitations-banner';
import { ThemeSync } from './_components/theme-sync';

export default function AppLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-8">
      {/* Applique le thème enregistré sur le compte (S20b). N'affiche rien. */}
      <ThemeSync />
      <AppHeader />
      <PendingInvitationsBanner />
      <div className="flex-1">{children}</div>

      {/* Pied de page légal de l'application (S22c). Les pages légales ne sont
          PAS classées « marketing » dans `lib/routes.ts` : un membre connecté
          qui clique ici lit le document, il n'est pas renvoyé vers /projects. */}
      <footer className="mt-4 border-t border-[var(--border)] pt-5 text-sm">
        <LegalLinks />
      </footer>
    </div>
  );
}
