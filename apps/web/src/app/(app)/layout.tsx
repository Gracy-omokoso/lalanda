import { AppShell } from './_components/app-shell';
import { ThemeSync } from './_components/theme-sync';

/**
 * Coquille de l'espace applicatif (ADR-0030) : barre latérale par module
 * (BUILD · RUN · GROW · Organisation), barre du haut, pied légal avec la version
 * du logiciel (ADR-0026 § 6.2). Voir `_components/app-shell.tsx`.
 */
export default function AppLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <>
      {/* Applique le thème enregistré sur le compte (S20b). N'affiche rien. */}
      <ThemeSync />
      <AppShell>{children}</AppShell>
    </>
  );
}
