# @lalanda/ui

Composants React partagés (shadcn/ui + Tailwind).

## Statut

**S0** — squelette. Les composants réels arrivent en **S5** (interface).

## Contenu S0

- `utils.ts` — helper `cn()` (clsx + tailwind-merge), attendu par tout composant shadcn.

## Ajouts prévus

- Composants de base : `Button`, `Input`, `Card`, `Dialog`, `Table` (shadcn).
- Composants métier partagés : `MoneyInput`, `DriverField`, `SectorPicker`.

Les composants strictement propres à `apps/web` restent dans `apps/web/src/components/`.
