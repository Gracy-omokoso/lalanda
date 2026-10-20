import { AppVersion } from '@/components/app-version';
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
      <footer className="mt-4 flex flex-col gap-3 border-t border-[var(--border)] pt-5 text-sm sm:flex-row sm:items-center sm:justify-between">
        <LegalLinks />
        {/* ADR-0026 § 6.2 : version du logiciel visible de tout écran. */}
        <AppVersion className="text-xs text-[var(--foreground-muted)]" />
      </footer>
    </div>
  );
}
