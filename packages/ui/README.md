# @lalanda/ui

Composants React partagés (shadcn/ui + Tailwind).

## Statut

Design system de la refonte ([ADR-0030](../../docs/adr/ADR-0030-refonte-ui-ux.md)).

## Contenu

- `styles/tokens.css` — jetons de couleur (clair/sombre), rayons, ombres. Importé par
  `apps/web/src/app/globals.css` (`@import '@lalanda/ui/tokens.css'`).
- `tokens.ts` — miroir typé des jetons et calcul de contraste ; `tokens.test.ts` vérifie que
  le CSS et le miroir concordent et que chaque paire employée atteint WCAG 2.2 AA.
- Composants : `Button` / `buttonClasses`, `Card`, `Badge`, `Alert`, `EmptyState`,
  `Skeleton`, `PageHeader`, `TabsNav`, `Stepper`, `Progress`, `ModuleMark`, `DataNature`,
  `DataNatureLegend`.
- `utils.ts` — `cn()` (clsx + tailwind-merge).

Le paquet ne dépend pas de Next : les composants qui rendent des liens (`TabsNav`,
`Stepper`) reçoivent une fonction `renderLink` (`apps/web/src/components/next-link.tsx`).
Tailwind lit leurs classes grâce à `@source` dans `globals.css`.

## Ajouts prévus

- `Field` / `Input` / `Select` pour remplacer les classes locales (`form-ui.tsx`…).
- Composants métier partagés : `MoneyInput`, `DriverField`, `SectorPicker`.

Les composants strictement propres à `apps/web` restent dans `apps/web/src/components/`.
