'use client';

// Choix d'un élément par recherche (ADR-0046, lot S9) : bénéficiaire d'une affectation
// (collaborateur, membre, projet, emplacement), élément lié à un document (client,
// fournisseur, projet, compte CRM, équipement, article). La recherche ne part qu'aux
// listes des modules, chacune sous sa propre permission ; seul l'IDENTIFIANT choisi
// part ensuite à l'API. Un chargeur indisponible (rôle, lot absent) rend une liste vide.
//
// ADR-0074 § 4 : un seul champ « tape pour chercher » (`EntityPicker`) remplace
// l'ancien couple « Rechercher » + liste déroulante ; l'API publique est inchangée.

import { EntityPicker } from '@lalanda/ui';
import { useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { assetsApi } from '@/lib/api-assets';
import { crmApi } from '@/lib/api-crm';
import { hrApi } from '@/lib/api-hr';
import { purchasesApi } from '@/lib/api-purchases';
import { stockApi } from '@/lib/api-stock';
import { workApi } from '@/lib/work-api';

export interface OptionEntite {
  id: string;
  label: string;
}

export type TypeChoix =
  | 'employee'
  | 'member'
  | 'customer'
  | 'supplier'
  | 'work_project'
  | 'crm_account'
  | 'asset'
  | 'stock_item'
  | 'location';

const contient = (texte: string, q: string): boolean =>
  texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .includes(q.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim());

/** Chargeur de chaque type : appel de liste du module propriétaire, 50 éléments. */
export function chargeur(
  type: TypeChoix,
  organizationId: string | null,
): (q: string) => Promise<OptionEntite[]> {
  const t = (q: string): { q?: string } => (q.trim() ? { q: q.trim() } : {});
  switch (type) {
    case 'employee':
      return (q) =>
        hrApi.listEmployees({ status: 'active', limit: 50, ...t(q) }).then((p) =>
          p.items.map((e) => ({
            id: e.id,
            label: `${e.preferredName ?? `${e.firstName} ${e.lastName}`}${e.jobTitle ? ` — ${e.jobTitle}` : ''}`,
          })),
        );
    case 'member':
      return (q) =>
        organizationId === null
          ? Promise.resolve([])
          : api
              .listMembers(organizationId)
              .then((r) =>
                r.members
                  .map((m) => ({ id: m.userId, label: m.name ?? m.email ?? 'Membre' }))
                  .filter((m) => contient(m.label, q)),
              );
    case 'customer':
      return (q) =>
        api
          .listCustomers({ limit: 50, ...t(q) })
          .then((p) => p.items.map((c) => ({ id: c.id, label: c.name })));
    case 'supplier':
      return (q) =>
        purchasesApi
          .listSuppliers({ active: 'true', limit: 50, ...t(q) })
          .then((p) => p.items.map((s) => ({ id: s.id, label: s.name })));
    case 'work_project':
      return (q) =>
        workApi
          .listProjects({ limit: 50, ...t(q) })
          .then((p) => p.items.map((s) => ({ id: s.id, label: s.name })));
    case 'crm_account':
      return (q) =>
        crmApi
          .listAccounts({ active: 'true', limit: 50, ...t(q) })
          .then((p) => p.items.map((c) => ({ id: c.id, label: c.name })));
    case 'asset':
      // Le registre n'offre pas de recherche texte : la page reçue est filtrée ici.
      return (q) =>
        assetsApi
          .list({ status: 'all', limit: 100 })
          .then((p) =>
            p.items
              .map((a) => ({ id: a.id, label: `${a.number} — ${a.name}` }))
              .filter((a) => contient(a.label, q)),
          );
    case 'stock_item':
      return (q) =>
        stockApi
          .listItems({ active: 'true', limit: 50, ...t(q) })
          .then((p) =>
            p.items.map((s) => ({ id: s.id, label: `${s.code ? `${s.code} — ` : ''}${s.name}` })),
          );
    case 'location':
      return (q) =>
        stockApi
          .listLocations({ active: 'true' })
          .then((p) =>
            p.items.map((l) => ({ id: l.id, label: l.name })).filter((l) => contient(l.label, q)),
          );
  }
}

export function ChoixEntite({
  id,
  type,
  organizationId,
  valeur,
  onChange,
  aria,
  vide = 'Choisir…',
}: {
  id: string;
  type: TypeChoix;
  organizationId: string | null;
  valeur: string;
  onChange: (option: OptionEntite | null) => void;
  aria?: Record<string, unknown>;
  vide?: string;
}): React.ReactElement {
  // Option choisie telle que la liste l'a rendue ; un identifiant reçu sans
  // libellé (valeur posée par l'écran) reste affiché « Élément choisi ».
  const [choisie, setChoisie] = useState<OptionEntite | null>(null);
  const [echec, setEchec] = useState(false);
  const valeurAffichee: OptionEntite | null =
    valeur === ''
      ? null
      : choisie?.id === valeur
        ? choisie
        : { id: valeur, label: 'Élément choisi' };

  // Même chargeur qu'avant (liste du module, sous sa propre permission) ; un
  // échec garde son message : la liste n'est pas lisible avec ce rôle.
  const chercher = useCallback(
    (q: string): Promise<OptionEntite[]> =>
      chargeur(
        type,
        organizationId,
      )(q).then(
        (items) => {
          setEchec(false);
          return items;
        },
        (e: unknown) => {
          setEchec(true);
          throw e;
        },
      ),
    [type, organizationId],
  );

  const ariaInvalide = aria?.['aria-invalid'] === true || aria?.['aria-invalid'] === 'true';
  const ariaDecrit =
    typeof aria?.['aria-describedby'] === 'string' ? aria['aria-describedby'] : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <EntityPicker<OptionEntite>
        id={id}
        value={valeurAffichee}
        onChange={(o) => {
          setChoisie(o);
          onChange(o);
        }}
        search={chercher}
        refreshKey={`${type}:${organizationId ?? ''}`}
        getKey={(o) => o.id}
        getLabel={(o) => o.label}
        placeholder={vide === 'Choisir…' ? 'Tapez pour rechercher…' : vide}
        emptyText="Aucun élément ne correspond."
        debounceMs={200}
        {...(ariaInvalide ? { 'aria-invalid': true } : {})}
        {...(ariaDecrit ? { 'aria-describedby': ariaDecrit } : {})}
      />
      {echec ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          Cette liste n’est pas lisible avec votre rôle.
        </p>
      ) : null}
    </div>
  );
}
