'use client';

// Barre d'onglets réutilisable pour la vue projet (S13d, clavier + mobile S23a).
// Rendu contrôlé : le parent gère l'onglet actif (souvent synchronisé avec `?tab=`).
//
// ── Clavier (WAI-ARIA « tabs », modèle à activation MANUELLE) ────
// Un `role="tablist"` sans gestion des flèches est un piège : le lecteur
// d'écran annonce un jeu d'onglets, l'utilisateur presse ← / → et rien ne
// bouge. Le patron complet est donc implémenté :
//  - un seul onglet dans l'ordre de tabulation (roving tabindex) : Tab entre
//    dans la barre puis en sort, il ne la traverse pas onglet par onglet;
//  - ← → déplacent le FOCUS en boucle, Origine / Fin vont aux extrémités;
//  - Entrée ou Espace active l'onglet focalisé.
//
// L'activation automatique (la feuille change en même temps que le focus) a été
// essayée et rejetée pour deux raisons mesurées à l'écran :
//  1. **elle perdait des frappes.** L'onglet actif vient de l'URL ; trois ← →
//     rapides étaient tous calculés depuis le même état, le routeur n'ayant pas
//     encore rendu le premier. On avançait d'un onglet au lieu de trois;
//  2. **elle polluait l'historique.** Chaque onglet traversé au clavier
//     laissait une entrée, et « précédent » les rejouait une à une.
//
// Le WAI-ARIA recommande explicitement l'activation manuelle quand activer un
// onglet a un coût — ici une entrée d'historique et un changement d'URL.
//
// ── 375 px ──
// La barre défile horizontalement plutôt que de se replier sur quatre lignes :
// onze feuilles empilées repoussaient les chiffres sous la ligne de flottaison.
// L'onglet focalisé est ramené dans le champ de vision.

import { useEffect, useRef, useState } from 'react';

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

  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeId),
  );

  /**
   * Onglet qui porte le focus. Distinct de l'onglet actif tant que
   * l'utilisateur navigue aux flèches sans valider.
   */
  const [focusIndex, setFocusIndex] = useState(activeIndex);
  // `true` seulement après une navigation clavier : sans ce garde-fou, le focus
  // serait volé au premier rendu de la page.
  const movedByKeyboard = useRef(false);

  // L'onglet actif change (clic, lien partagé, retour navigateur) → le focus le
  // rejoint, sinon Tab redéposerait l'utilisateur sur l'onglet précédent.
  useEffect(() => {
    setFocusIndex(activeIndex);
  }, [activeIndex]);

  useEffect(() => {
    if (!movedByKeyboard.current) return;
    movedByKeyboard.current = false;
    const el = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[focusIndex];
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusIndex]);

  function moveFocus(next: number): void {
    movedByKeyboard.current = true;
    setFocusIndex(next);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (tabs.length === 0) return;
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        moveFocus((focusIndex + 1) % tabs.length);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        moveFocus((focusIndex - 1 + tabs.length) % tabs.length);
        return;
      case 'Home':
        event.preventDefault();
        moveFocus(0);
        return;
      case 'End':
        event.preventDefault();
        moveFocus(tabs.length - 1);
        return;
      case 'Enter':
      case ' ': {
        const target = tabs[focusIndex];
        if (!target) return;
        event.preventDefault();
        if (target.id !== activeId) onChange(target.id);
        return;
      }
      default:
    }
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
      {tabs.map((tab, index) => {
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
            tabIndex={index === focusIndex ? 0 : -1}
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
