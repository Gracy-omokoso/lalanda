// Chrome commun de l'espace admin plateforme (S21b — ADR-0012 §4, ADR-0013).
//
// ── Ce que cette page ne fait pas ────────────────────────────────────────────
//
// Elle ne protège pas l'espace. Le middleware web (`lib/routes.ts`) ne vérifie
// que la présence d'un cookie de session : il ignore tout des rôles plateforme,
// et prétendre le contraire donnerait un faux sentiment de sécurité. Le contrôle
// réel est `PermissionsGuard` + `@RequirePlatformRole` sur CHAQUE route
// `/admin/*` de l'API. `AdminAccessGate` ne fait que remplacer un mur de
// bannières 403 par un refus lisible.
//
// Conséquence pratique : forcer l'URL `/admin/integrations` sans rôle affiche
// l'écran de refus et ne déclenche AUCUN appel aux endpoints d'intégration.
// Et si `AdminAccessGate` était supprimé par erreur, l'API répondrait 403 —
// aucune donnée ne sortirait.

import type { Metadata } from 'next';

import { AdminAccessGate } from './_components/admin-access';
import { AdminTabs } from './_components/admin-tabs';

export const metadata: Metadata = { title: 'Administration · Lalanda' };

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Administration</h1>
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
          L’exploitation de la plateforme : organisations clientes, comptes, intégrations chiffrées
          et journal des actes d’administration. Aucun acte métier d’un client — validation de plan,
          clôture de période, export — n’est possible depuis ici.
        </p>
      </header>
      <AdminAccessGate>
        <AdminTabs />
        {children}
      </AdminAccessGate>
    </section>
  );
}
