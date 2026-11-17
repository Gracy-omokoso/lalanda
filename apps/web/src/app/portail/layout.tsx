import type { Metadata } from 'next';

import { BrandLogo } from '@/components/brand-logo';
import { ThemeToggle } from '@/components/theme-toggle';

export const metadata: Metadata = {
  title: 'Espace externe — Lalanda',
  // Pages d'un espace privé : jamais indexées.
  robots: { index: false, follow: false },
};

/**
 * Coquille de l'espace externe (ADR-0078) : contact client et consultant.
 *
 * Séparée de l'application (`(app)`) : aucune navigation de l'ERP, aucun module, aucun
 * sélecteur d'organisation. La session est un cookie propre à l'espace externe, que
 * l'API vérifie à chaque appel ; le middleware ne protège pas ces pages (elles ne
 * connaissent pas la session better-auth) et chaque écran renvoie à la connexion sur un
 * 401.
 */
export default function PortailLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <BrandLogo hauteur={28} />
            <span className="text-sm text-[var(--foreground-muted)]">Espace externe</span>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
