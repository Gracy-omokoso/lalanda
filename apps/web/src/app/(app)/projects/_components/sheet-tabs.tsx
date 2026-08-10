'use client';

// Barre d'onglets réutilisable pour la vue projet (S13d, clavier + mobile S23a).
// Rendu contrôlé : le parent gère l'onglet actif (souvent synchronisé avec `?tab=`).
//
// ── Clavier (WAI-ARIA « tabs », modèle à activation automatique) ──
// Un `role="tablist"` sans gestion des flèches est un piège : le lecteur d'écran
// annonce un jeu d'onglets, l'utilisateur presse ← / → et rien ne bouge. On
// implémente donc le patron complet :
//  - un seul onglet dans l'ordre de tabulation (roving tabindex) : Tab entre
//    dans la barre puis en sort, il ne la traverse pas onglet par onglet;
//  - ← → parcourent en boucle, Origine / Fin vont aux extrémités;
//  - l'activation suit le focus — la bascule est instantanée et sans coût, les
//    panneaux étant déjà chargés côté client.
//
// ── 375 px ──
// La barre défile horizontalement plutôt que de se replier sur quatre lignes :
// onze feuilles empilées repoussaient les chiffres sous la ligne de flottaison.
// L'onglet qui reçoit le focus est ramené dans le champ de vision.

import { useEffect, useRef } from 'react';

export interface SheetTab {
  id: string;
  label: string;
}

interface SheetTabsProps {
  tabs: SheetTab[];
  activeId: string;
  onChange: (id: string) => void;
  /** Libellé du groupe d'onglets, annoncé par les lecteurs d'écran. */
  label?: string;
}

export function SheetTabs({
  tabs,
  activeId,
  onChange,
  label = 'Feuilles de résultats',
}: SheetTabsProps): React.ReactElement {
  const listRef = useRef<HTMLDivElement>(null);
  // `true` seulement après une navigation clavier : sans ce garde-fou, le focus
  // serait volé au premier rendu de la page.
  const movedByKeyboard = useRef(false);

  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeId),
  );

  // Après une navigation clavier, le focus doit suivre l'onglet actif — c'est lui
  // qui porte désormais le seul `tabIndex={0}` de la barre.
  useEffect(() => {
    if (!movedByKeyboard.current) return;
    movedByKeyboard.current = false;
    const el = listRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (tabs.length === 0) return;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
        next = (activeIndex + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        next = (activeIndex - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = tabs[next];
    if (!target || target.id === activeId) return;
    movedByKeyboard.current = true;
    onChange(target.id);
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
      className="flex gap-1 overflow-x-auto border-b border-[var(--border)] [scrollbar-width:thin]"
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
            // Roving tabindex : un seul onglet est atteignable au Tab.
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={
              isActive
                ? 'font-mono -mb-px shrink-0 whitespace-nowrap border-b-2 border-[var(--accent)] px-3.5 py-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--foreground)] transition'
                : 'font-mono -mb-px shrink-0 whitespace-nowrap border-b-2 border-transparent px-3.5 py-2.5 text-[0.72rem] font-medium uppercase tracking-[0.08em] text-[var(--foreground-muted)] transition hover:text-[var(--foreground)]'
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
