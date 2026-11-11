'use client';

// Sélecteur « Projet » du formulaire de dépense (ADR-0039 § 6.4, lot L4a).
//
// Facultatif. Visible seulement si l'appelant lit les projets (`work.read`) :
// la liste vient de `GET /work/projects` ; un refus (403) ou une erreur masque
// le champ — rattacher une dépense reste possible plus tard. Le serveur vérifie
// de toute façon que le projet est de l'organisation et non archivé.
//
// ADR-0074 : `Field` + `Select` de `@lalanda/ui` (recherche dès huit projets,
// client du projet en sous-texte), largeur d'un intitulé (`lg`).

import type { WorkProjectSummary } from '@lalanda/shared/work';
import { Field, Select } from '@lalanda/ui';
import { useEffect, useState } from 'react';

import { workBillingApi } from '@/lib/work-billing-api';

export function WorkProjectSelect({
  value,
  onChange,
  id,
  size = 'lg',
}: {
  /** Identifiant du projet, ou `''` pour « aucun ». */
  value: string;
  onChange: (projectId: string) => void;
  /**
   * Classes de l'ancien `<select>` natif ; gardé pour la compatibilité des
   * appelants, sans effet : le `Select` porte son propre style (ADR-0074).
   */
  className?: string;
  id?: string;
  size?: 'md' | 'lg' | 'full';
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
    <Field
      label="Projet"
      optional
      size={size}
      hint="La dépense compte alors dans la marge du projet ; rien d’autre ne change."
      {...(id ? { id } : {})}
    >
      <Select<string>
        value={value}
        onChange={onChange}
        options={[
          { value: '', label: '— Aucun projet —' },
          ...projets.map((p) => ({
            value: p.id,
            label: p.name,
            ...(p.customerName ? { description: p.customerName, keywords: p.customerName } : {}),
          })),
        ]}
        searchPlaceholder="Rechercher un projet…"
      />
    </Field>
  );
}
