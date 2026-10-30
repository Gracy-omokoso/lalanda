'use client';

// Référentiels lus par les formulaires et les listes (lot H6) : types de contrat
// (`GET /hr/settings`), services (`GET /hr/departments`), collaborateurs actifs
// pour choisir un manager. Une lecture en échec laisse une liste vide (le
// formulaire reste utilisable ; l'API juge), sauf les types de contrat qui
// retombent sur les valeurs proposées à l'activation (`@lalanda/shared/hr`).

import { useEffect, useState } from 'react';

import {
  hrApi,
  type HrDepartmentView,
  type HrEmployeeListItem,
  type HrSettingsContractType,
} from '@/lib/api-hr';

import { typesContrat } from './collaborateurs-model';

export interface ReferentielsRh {
  contrats: readonly HrSettingsContractType[];
  services: HrDepartmentView[];
  employes: HrEmployeeListItem[];
}

export function useReferentielsRh(avecEmployes = true): ReferentielsRh {
  const [contrats, setContrats] = useState<HrSettingsContractType[] | null>(null);
  const [services, setServices] = useState<HrDepartmentView[]>([]);
  const [employes, setEmployes] = useState<HrEmployeeListItem[]>([]);

  useEffect(() => {
    let annule = false;
    hrApi
      .getSettings()
      .then((s) => {
        if (!annule) setContrats(s.contractTypes);
      })
      .catch(() => undefined);
    hrApi
      .listDepartments()
      .then((r) => {
        if (!annule) setServices(r.items.filter((d) => d.active));
      })
      .catch(() => undefined);
    if (avecEmployes) {
      hrApi
        .listEmployees({ status: 'active', limit: 100 })
        .then((p) => {
          if (!annule) setEmployes(p.items);
        })
        .catch(() => undefined);
    }
    return () => {
      annule = true;
    };
  }, [avecEmployes]);

  return { contrats: typesContrat(contrats), services, employes };
}
