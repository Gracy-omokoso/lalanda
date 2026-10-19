'use client';

// Boîte modale commune aux dialogues de l'onglet Factures (émettre,
// normaliser, avoir). `showModal()` fournit le piège du focus, la touche Échap
// et l'arrière-plan inerte — comme la boîte de ré-authentification de l'onglet
// Fiscalité. Mobile d'abord : pleine largeur, défilement interne.

import { useEffect, useId, useRef } from 'react';

export function Dialogue({
  titre,
  onFermer,
  children,
}: {
  titre: string;
  onFermer: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-titre`}
      onCancel={(e) => {
        e.preventDefault();
        onFermer();
      }}
      className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-0 text-[var(--foreground)] backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 id={`${id}-titre`} className="font-display text-lg font-bold tracking-tight">
          {titre}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
