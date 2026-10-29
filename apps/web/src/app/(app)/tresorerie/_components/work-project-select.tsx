'use client';

// Sélecteur « Projet » du formulaire de dépense (ADR-0039 § 6.4, lot L4a).
//
// Facultatif. Visible seulement si l'appelant lit les projets (`work.read`) :
// la liste vient de `GET /work/projects` ; un refus (403) ou une erreur masque
// le champ — rattacher une dépense reste possible plus tard. Le serveur vérifie
// de toute façon que le projet est de l'organisation et non archivé.

import type { WorkProjectSummary } from '@lalanda/shared/work';
import { useEffect, useState } from 'react';

import { workBillingApi } from '@/lib/work-billing-api';

export function WorkProjectSelect({
  value,
  onChange,
  className,
}: {
  /** Identifiant du projet, ou `''` pour « aucun ». */
  value: string;
  onChange: (projectId: string) => void;
  className: string;
}): React.ReactElement | null {
  const [projets, setProjets] = useState<WorkProjectSummary[] | null>(null);

  useEffect(() => {
    let actif = true;
    workBillingApi
      .activeProjects()
      .then((page) => {
        if (actif) setProjets(page.items);
      })
      .catch(() => {
        if (actif) setProjets(null);
      });
    return () => {
      actif = false;
    };
  }, []);

  if (projets === null) return null;
  return (
    <label className="flex flex-col gap-1 text-sm">
      Projet (facultatif)
      <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Aucun projet —</option>
        {projets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.customerName ? ` — ${p.customerName}` : ''}
          </option>
        ))}
      </select>
      <span className="text-xs text-[var(--foreground-muted)]">
        La dépense compte alors dans la marge du projet ; rien d’autre ne change.
      </span>
    </label>
  );
}
