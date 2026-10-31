'use client';

// Création ou modification d'un équipement (ADR-0046 § 3.1), dans le `Modal` de
// `@lalanda/ui` (`assets.manage`). Le coût n'est saisi que par un rôle qui voit les
// valeurs ; l'estimation de gestion n'a aucune durée par défaut.

import { buttonClasses } from '@lalanda/ui';
import { useId, useState } from 'react';

import { assetsApi, type AssetDetailView } from '@/lib/api-assets';

import { ChoixFournisseur } from '../../achats/_components/commande-formulaire';
import { useShell } from '../../_components/shell-context';
import { Alerte, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';

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
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Champ id={`${id}-nom`} label="Nom de l’équipement" requis erreur={champs['name']}>
            <input
              id={`${id}-nom`}
              className={CHAMP}
              value={f.name}
              maxLength={200}
              placeholder="Ordinateur portable de la comptabilité"
              onChange={(e) => maj({ name: e.target.value })}
              {...aria(`${id}-nom`, champs['name'])}
            />
          </Champ>
        </div>
        <Champ id={`${id}-cat`} label="Catégorie" requis erreur={champs['categoryId']}>
          <select
            id={`${id}-cat`}
            className={CHAMP}
            value={f.categoryId}
            onChange={(e) => maj({ categoryId: e.target.value })}
            {...aria(`${id}-cat`, champs['categoryId'])}
          >
            <option value="">Choisir une catégorie</option>
            {listeCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Champ>
        {equipement?.status !== 'disposed' ? (
          <Champ id={`${id}-statut`} label="Statut">
            <select
              id={`${id}-statut`}
              className={CHAMP}
              value={f.status}
              onChange={(e) => maj({ status: e.target.value as FormulaireEquipement['status'] })}
            >
              {statuts.map((s) => (
                <option key={s} value={s}>
                  {LIBELLES_STATUT[s]}
                </option>
              ))}
            </select>
          </Champ>
        ) : null}
        <Champ id={`${id}-marque`} label="Marque">
          <input
            id={`${id}-marque`}
            className={CHAMP}
            value={f.brand}
            maxLength={80}
            onChange={(e) => maj({ brand: e.target.value })}
          />
        </Champ>
        <Champ id={`${id}-modele`} label="Modèle">
          <input
            id={`${id}-modele`}
            className={CHAMP}
            value={f.model}
            maxLength={80}
            onChange={(e) => maj({ model: e.target.value })}
          />
        </Champ>
        <Champ id={`${id}-serie`} label="Numéro de série">
          <input
            id={`${id}-serie`}
            className={CHAMP}
            value={f.serialNumber}
            maxLength={80}
            onChange={(e) => maj({ serialNumber: e.target.value })}
          />
        </Champ>
        <Champ id={`${id}-etiquette`} label="Étiquette physique" aide="Facultative, unique.">
          <input
            id={`${id}-etiquette`}
            className={CHAMP}
            value={f.tag}
            maxLength={40}
            onChange={(e) => maj({ tag: e.target.value })}
            aria-describedby={`${id}-etiquette-aide`}
          />
        </Champ>
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">Acquisition</legend>
        <Champ id={`${id}-achat`} label="Date" requis erreur={champs['acquisitionOn']}>
          <input
            id={`${id}-achat`}
            type="date"
            className={CHAMP}
            value={f.acquisitionOn}
            onChange={(e) => maj({ acquisitionOn: e.target.value })}
            {...aria(`${id}-achat`, champs['acquisitionOn'])}
          />
        </Champ>
        {coutMasque ? (
          <p className="text-xs text-[var(--foreground-muted)] sm:col-span-2 sm:self-end">
            Le coût n’est saisi et affiché que par les rôles qui voient les prix d’achat ou la
            trésorerie.
          </p>
        ) : (
          <>
            <Champ id={`${id}-cout`} label="Coût" requis erreur={champs['cost']}>
              <ChampNombre
                id={`${id}-cout`}
                value={f.cost}
                onChange={(e) => maj({ cost: e.target.value })}
                {...aria(`${id}-cout`, champs['cost'])}
              />
            </Champ>
            <Champ id={`${id}-devise`} label="Devise">
              <select
                id={`${id}-devise`}
                className={CHAMP}
                value={f.currency}
                onChange={(e) => maj({ currency: e.target.value as 'USD' | 'CDF' })}
              >
                <option value="USD">USD</option>
                <option value="CDF">CDF</option>
              </select>
            </Champ>
          </>
        )}
        {lireAchats ? (
          <div className="sm:col-span-3">
            <Champ
              id={`${id}-fournisseur`}
              label="Fournisseur"
              aide="Facultatif. Le lien ne crée ni dépense ni dette."
            >
              <ChoixFournisseur
                id={`${id}-fournisseur`}
                valeur={f.supplierId}
                onChange={(s) => maj({ supplierId: s?.id ?? '' })}
              />
            </Champ>
          </div>
        ) : null}
      </fieldset>

      {!coutMasque ? (
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-1 text-sm font-semibold">Amortissement indicatif</legend>
          <p className="text-xs text-[var(--foreground-muted)] sm:col-span-3">
            {ETIQUETTE_ESTIMATION}. Aucune durée n’est proposée : laissez vide pour ne rien estimer.
          </p>
          <Champ id={`${id}-duree`} label="Durée (années)" erreur={champs['years']}>
            <ChampNombre
              id={`${id}-duree`}
              entier
              value={f.years}
              onChange={(e) => maj({ years: e.target.value })}
              {...aria(`${id}-duree`, champs['years'])}
            />
          </Champ>
          <Champ id={`${id}-residuelle`} label="Valeur résiduelle" erreur={champs['residualValue']}>
            <ChampNombre
              id={`${id}-residuelle`}
              value={f.residualValue}
              onChange={(e) => maj({ residualValue: e.target.value })}
              {...aria(`${id}-residuelle`, champs['residualValue'])}
            />
          </Champ>
          <Champ id={`${id}-debut`} label="À partir du" erreur={champs['startOn']}>
            <input
              id={`${id}-debut`}
              type="date"
              className={CHAMP}
              value={f.startOn}
              onChange={(e) => maj({ startOn: e.target.value })}
              {...aria(`${id}-debut`, champs['startOn'])}
            />
          </Champ>
        </fieldset>
      ) : null}

      <Champ id={`${id}-notes`} label="Notes">
        <textarea
          id={`${id}-notes`}
          rows={2}
          className={CHAMP}
          value={f.notes}
          maxLength={5000}
          onChange={(e) => maj({ notes: e.target.value })}
        />
      </Champ>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <button
        type="submit"
        disabled={envoi}
        className={buttonClasses('primary', 'md', 'self-start')}
      >
        {envoi
          ? 'Enregistrement…'
          : equipement === null
            ? 'Enregistrer l’équipement'
            : 'Enregistrer'}
      </button>
    </form>
  );
}
