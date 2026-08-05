'use client';

// Barre d'onglets réutilisable pour la vue projet (S13d).
// Rendu contrôlé : le parent gère l'onglet actif (souvent synchronisé avec `?tab=`).

export interface SheetTab {
  id: string;
  label: string;
}

interface SheetTabsProps {
  tabs: SheetTab[];
  activeId: string;
  onChange: (id: string) => void;
}

export function SheetTabs({ tabs, activeId, onChange }: SheetTabsProps): React.ReactElement {
  return (
    <div
      role="tablist"
      aria-label="Feuilles du plan"
      className="flex flex-wrap gap-1 border-b border-[var(--border)]"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`sheet-panel-${tab.id}`}
            id={`sheet-tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={
              isActive
                ? 'border-b-2 border-[var(--accent)] px-4 py-2.5 -mb-px text-sm font-semibold text-[var(--foreground)] transition'
                : 'border-b-2 border-transparent px-4 py-2.5 -mb-px text-sm font-medium text-[var(--foreground-muted)] transition hover:text-[var(--foreground)]'
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
