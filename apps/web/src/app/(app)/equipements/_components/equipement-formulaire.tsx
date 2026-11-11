'use client';

// Création ou modification d'un équipement (ADR-0046 § 3.1), dans le `Modal` de
// `@lalanda/ui` (`assets.manage`). Le coût n'est saisi que par un rôle qui voit les
// valeurs ; l'estimation de gestion n'a aucune durée par défaut.
//
// ADR-0074 : grille sémantique, catégorie et statut en `Select`, devise en
// segments, dates en `DatePicker`, fournisseur en `ChoixFournisseur` (« + »
// sous `purchase.manage`, déjà migré en phase 2a).

import {
  DatePicker,
  Field,
  FormGrid,
  FormSection,
  SegmentedControl,
  Select,
  SubmitButton,
  TextArea,
  TextInput,
} from '@lalanda/ui';
import { useId, useState } from 'react';

import { assetsApi, type AssetDetailView } from '@/lib/api-assets';

import { ChoixFournisseur } from '../../achats/_components/commande-formulaire';
import { useShell } from '../../_components/shell-context';
import { Alerte } from '../../ventes/_components/form-ui';

import {
  LIBELLES_STATUT,
  jourKinshasa,
  messageEquipements,
  valeursAffichees,
} from './equipements-model';
import { ChampNombre, useCategories } from './equipements-ui';
import { ETIQUETTE_ESTIMATION } from './fiche-model';
import {
  formulaireEquipement,
  preparerEquipement,
  preparerModification,
  type FormulaireEquipement,
} from './registre-model';

export function EquipementFormulaire({
  equipement,
  onEnregistre,
  onSale,
}: {
  /** `null` : création. */
  equipement: AssetDetailView | null;
  onEnregistre: (a: AssetDetailView) => void;
  onSale?: (sale: boolean) => void;
}): React.ReactElement {
  const id = useId();
  const { actions } = useShell();
  const categories = useCategories();
  const coutMasque = !valeursAffichees(actions, equipement?.valuesHidden);
  const lireAchats = actions?.includes('purchase.read') ?? false;
  const [f, setF] = useState<FormulaireEquipement>(() =>
    formulaireEquipement(equipement, jourKinshasa(new Date())),
  );
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const maj = (patch: Partial<FormulaireEquipement>): void => {
    setF((p) => ({ ...p, ...patch }));
    onSale?.(true);
  };

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    if (equipement === null) {
      const p = preparerEquipement(f, { creation: true, coutMasque });
      setChamps(p.ok ? {} : p.champs);
      if (!p.ok) return;
      setEnvoi(true);
      try {
        onEnregistre(await assetsApi.create(p.corps));
      } catch (err) {
        setErreur(messageEquipements(err, 'Enregistrement impossible.'));
      } finally {
        setEnvoi(false);
      }
      return;
    }
    const p = preparerModification(f, equipement, coutMasque);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      onEnregistre(await assetsApi.update(equipement.id, p.corps));
    } catch (err) {
      setErreur(messageEquipements(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  const listeCategories = categories?.ok ? categories.valeur.filter((c) => c.active) : [];
  const statuts =
    equipement === null
      ? (['in_service', 'in_storage'] as const)
      : (['in_service', 'in_storage', 'under_maintenance', 'lost'] as const);

  return (
    <form noValidate onSubmit={(e) => void enregistrer(e)} className="flex flex-col gap-4">
      <FormGrid>
        <Field
          id={`${id}-nom`}
          label="Nom de l’équipement"
          required
          size="lg"
          error={champs['name']}
        >
          <TextInput
            value={f.name}
            maxLength={200}
            placeholder="Ordinateur portable de la comptabilité"
            autoFocus={equipement === null}
            onChange={(e) => maj({ name: e.target.value })}
          />
        </Field>
        <Field
          id={`${id}-cat`}
          label="Catégorie"
          required
          size="md"
          newRow
          error={champs['categoryId']}
        >
          <Select
            value={f.categoryId}
            onChange={(v) => maj({ categoryId: v })}
            placeholder="Choisir une catégorie"
            loading={categories === null}
            emptyText="Aucune catégorie active."
            options={listeCategories.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        {equipement?.status !== 'disposed' ? (
          <Field id={`${id}-statut`} label="Statut" size="md">
            <Select<FormulaireEquipement['status']>
              value={f.status}
              onChange={(v) => maj({ status: v })}
              options={statuts.map((s) => ({ value: s, label: LIBELLES_STATUT[s] }))}
            />
          </Field>
        ) : null}
        <Field id={`${id}-marque`} label="Marque" size="md" newRow>
          <TextInput
            value={f.brand}
            maxLength={80}
            onChange={(e) => maj({ brand: e.target.value })}
          />
        </Field>
        <Field id={`${id}-modele`} label="Modèle" size="md">
          <TextInput
            value={f.model}
            maxLength={80}
            onChange={(e) => maj({ model: e.target.value })}
          />
        </Field>
        <Field id={`${id}-serie`} label="Numéro de série" size="md" newRow>
          <TextInput
            value={f.serialNumber}
            maxLength={80}
            onChange={(e) => maj({ serialNumber: e.target.value })}
          />
        </Field>
        <Field
          id={`${id}-etiquette`}
          label="Étiquette physique"
          size="sm"
          hint="Facultative, unique."
        >
          <TextInput value={f.tag} maxLength={40} onChange={(e) => maj({ tag: e.target.value })} />
        </Field>
      </FormGrid>

      <FormSection title="Acquisition">
        <Field id={`${id}-achat`} label="Date" required size="sm" error={champs['acquisitionOn']}>
          <DatePicker
            value={f.acquisitionOn}
            shortcuts={['today']}
            onChange={(v) => maj({ acquisitionOn: v })}
          />
        </Field>
        {coutMasque ? (
          <p className="text-xs text-[var(--foreground-muted)] @lg:col-span-8 @lg:self-end">
            Le coût n’est saisi et affiché que par les rôles qui voient les prix d’achat ou la
            trésorerie. Un équipement créé ici a un coût inconnu, à compléter par eux.
          </p>
        ) : (
          <>
            <Field
              id={`${id}-cout`}
              label="Coût"
              size="sm"
              hint="Laissez vide si le coût est inconnu : il ne sera pas compté comme zéro."
              error={champs['cost']}
            >
              <ChampNombre value={f.cost} onChange={(e) => maj({ cost: e.target.value })} />
            </Field>
            <Field id={`${id}-devise`} label="Devise" size="sm" group>
              <SegmentedControl<'USD' | 'CDF'>
                value={f.currency}
                onChange={(v) => maj({ currency: v })}
                options={[
                  { value: 'USD', label: 'USD' },
                  { value: 'CDF', label: 'CDF' },
                ]}
              />
            </Field>
          </>
        )}
        {lireAchats ? (
          <Field
            id={`${id}-fournisseur`}
            label="Fournisseur"
            size="lg"
            newRow
            hint="Facultatif. Le lien ne crée ni dépense ni dette."
          >
            <ChoixFournisseur
              id={`${id}-fournisseur`}
              valeur={f.supplierId}
              onChange={(s) => maj({ supplierId: s?.id ?? '' })}
            />
          </Field>
        ) : null}
      </FormSection>

      {!coutMasque ? (
        <FormSection
          title="Amortissement indicatif"
          description={`${ETIQUETTE_ESTIMATION}. Aucune durée n’est proposée : laissez vide pour ne rien estimer.`}
        >
          <Field id={`${id}-duree`} label="Durée (années)" size="xs" error={champs['years']}>
            <ChampNombre entier value={f.years} onChange={(e) => maj({ years: e.target.value })} />
          </Field>
          <Field
            id={`${id}-residuelle`}
            label="Valeur résiduelle"
            size="sm"
            error={champs['residualValue']}
          >
            <ChampNombre
              value={f.residualValue}
              onChange={(e) => maj({ residualValue: e.target.value })}
            />
          </Field>
          <Field id={`${id}-debut`} label="À partir du" size="sm" error={champs['startOn']}>
            <DatePicker value={f.startOn} onChange={(v) => maj({ startOn: v })} />
          </Field>
        </FormSection>
      ) : null}

      <FormGrid>
        <Field id={`${id}-notes`} label="Notes" size="full" optional>
          <TextArea
            rows={2}
            value={f.notes}
            maxLength={5000}
            onChange={(e) => maj({ notes: e.target.value })}
          />
        </Field>
      </FormGrid>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <SubmitButton busy={envoi} busyLabel="Enregistrement…" className="self-start max-sm:w-full">
        {equipement === null ? 'Enregistrer l’équipement' : 'Enregistrer'}
      </SubmitButton>
    </form>
  );
}
