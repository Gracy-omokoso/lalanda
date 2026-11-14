'use client';

// Fournisseur d'une dépense directe — ADR-0075 (A) et ADR-0074 § 4.
//
// `EntityPicker` sur `GET /treasury/suppliers?q=` (droit `treasury.read`, celui de
// l'écran) : fiches fournisseurs actives et noms libres déjà saisis ; le texte tapé
// reste possible comme « fournisseur de passage ». Le « + » ouvre la fiche
// fournisseur complète (même fenêtre que l'écran Achats) et n'existe qu'avec
// `purchase.manage`, le droit de `POST /purchases/suppliers` ; l'API reste juge.

import { EntityPicker } from '@lalanda/ui';
import { useCallback, useState } from 'react';

import { messageOf, treasuryApi } from '@/lib/treasury-api';

import { useShell } from '../../../_components/shell-context';
import { peutGererAchats } from '../../../achats/_components/achats-model';
import { NouveauFournisseur } from '../../../achats/_components/fournisseur-formulaire';

import {
  cleOption,
  descriptionFournisseur,
  optionsFournisseur,
  type FournisseurDepense,
} from './fournisseur-depense';

export function ChoixFournisseurDepense({
  id,
  valeur,
  onChange,
}: {
  id: string;
  valeur: FournisseurDepense | null;
  onChange: (f: FournisseurDepense | null) => void;
}): React.ReactElement {
  const { actions } = useShell();
  const peutCreer = actions !== null && peutGererAchats(actions);
  const [erreur, setErreur] = useState<string | null>(null);

  const chercher = useCallback(async (q: string): Promise<FournisseurDepense[]> => {
    try {
      const r = await treasuryApi.suppliers(q);
      setErreur(null);
      return optionsFournisseur(
        r.entries ?? r.items.map((name) => ({ name, supplierId: null })),
        q,
      );
    } catch (err) {
      setErreur(messageOf(err));
      throw err;
    }
  }, []);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <EntityPicker<FournisseurDepense>
        id={id}
        value={valeur}
        onChange={onChange}
        search={chercher}
        getKey={cleOption}
        getLabel={(f) => f.name}
        getDescription={descriptionFournisseur}
        placeholder="Fiche fournisseur ou nom libre"
        recentKey="tresorerie.fournisseurs"
        emptyText="Tapez le nom du fournisseur."
        debounceMs={250}
        createTitle="Nouveau fournisseur"
        createButtonLabel="Créer une fiche fournisseur"
        createOptionLabel={(q) => `Créer la fiche « ${q} »`}
        createSize="lg"
        {...(peutCreer
          ? {
              createForm: ({ initialText, onCreated, onCancel }) => (
                <NouveauFournisseur
                  enModal
                  nomInitial={initialText}
                  onCree={(_, fiche) => onCreated({ name: fiche.name, supplierId: fiche.id })}
                  onAnnuler={onCancel}
                />
              ),
            }
          : {})}
      />
      {erreur ? <p className="text-xs text-[var(--danger)]">{erreur}</p> : null}
    </div>
  );
}
