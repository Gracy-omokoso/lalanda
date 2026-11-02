// Coquille de la console Lalanda (ADR-0053 — P1 ; S21b — ADR-0012 § 4, ADR-0013).
//
// Groupe de routes `(console)`, distinct de `(app)` : la console ne monte NI la
// coquille de l'organisation (sélecteur, modules BUILD · RUN · GROW, cloche,
// `TermsGate`), NI aucun de ses appels. L'URL `/admin` est conservée (décision
// ouverte n° 1 : même domaine) ; la coquille ne dépend d'aucune donnée
// d'organisation, ce qui permettra de la servir sur un sous-domaine sans réécriture.
//
// ── Ce que cette coquille ne fait pas ────────────────────────────────────────
//
// Elle ne protège pas l'espace. Le middleware web (`lib/routes.ts`) ne vérifie
// que la présence d'un cookie de session ; le contrôle réel est fait par l'API sur
// CHAQUE route `/admin/**`. La coquille remplace un mur de 403 par un refus
// lisible, et ne monte pas une page que les actions servies n'ouvrent pas.

import type { Metadata } from 'next';

// Le thème du compte (`/account/preferences`) ne dépend d'aucune organisation.
import { ThemeSync } from '../../(app)/_components/theme-sync';

import { ConsoleShell } from './_components/console-shell';

export const metadata: Metadata = {
  title: 'Console Lalanda',
  robots: { index: false, follow: false },
};

export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <>
      <ThemeSync />
      <ConsoleShell>{children}</ConsoleShell>
    </>
  );
}
