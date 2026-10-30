'use client';

// Nouvelle demande d'achat (ADR-0044 § 2.3), dans le `Modal` de `@lalanda/ui`.
// Elle naît BROUILLON ; on la soumet depuis sa fiche. Aucun total n'est affiché
// ici : le moteur les calcule à l'enregistrement et la fiche les montre.

import { buttonClasses } from '@lalanda/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { purchasesApi, type SupplierListItem } from '@/lib/api-purchases';

import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';

import { messageAchats } from './achats-model';
import {
  MENTION_TAXES,
  formulaireCommande,
  ligneVide,
  preparerCommande,
  type FormulaireCommande,
  type LigneSaisie,
} from './commandes-model';

export function ChoixFournisseur({
  id,
  valeur,
  onChange,
}: {
  id: string;
  valeur: string;
  onChange: (s: SupplierListItem | null) => void;
}): React.ReactElement {
  const [q, setQ] = useState('');
  const [liste, setListe] = useState<SupplierListItem[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    const t = setTimeout(() => {
      purchasesApi
        .listSuppliers({ active: 'true', limit: 50, ...(q.trim() ? { q: q.trim() } : {}) })
        .then((p) => {
          if (annule) return;
          setListe(p.items);
          setErreur(null);
        })
        .catch((err: unknown) => {
          if (!annule) setErreur(messageAchats(err, 'Fournisseurs illisibles.'));
        });
    }, 200);
    return () => {
      annule = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="search"
        aria-label="Rechercher un fournisseur"
        placeholder="Rechercher un fournisseur…"
        className={CHAMP}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select
        id={id}
        className={CHAMP}
        value={valeur}
        onChange={(e) => onChange(liste.find((s) => s.id === e.target.value) ?? null)}
      >
        <option value="">À choisir avant la soumission</option>
        {valeur !== '' && !liste.some((s) => s.id === valeur) ? (
          <option value={valeur}>Fournisseur choisi</option>
        ) : null}
        {liste.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.nif ? ` — NIF ${s.nif}` : ''}
          </option>
        ))}
      </select>
      {erreur ? <p className="text-xs text-[var(--danger)]">{erreur}</p> : null}
    </div>
  );
}

export function NouvelleDemande({
  fournisseurInitial,
  onCree,
}: {
  fournisseurInitial: string | null;
  onCree: (id: string) => void;
}): React.ReactElement {
  const id = useId();
  const [f, setF] = useState<FormulaireCommande>(
    formulaireCommande('USD', fournisseurInitial ?? ''),
  );
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const majLigne = (i: number, patch: Partial<LigneSaisie>) =>
    setF((p) => ({ ...p, lignes: p.lignes.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  async function creer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    const p = preparerCommande(f);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      const o = await purchasesApi.createOrder(p.corps);
      onCree(o.id);
    } catch (err) {
      setErreur(messageAchats(err, 'Création impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void creer(e)} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Champ id={`${id}-titre`} label="Objet de la demande" requis erreur={champs['title']}>
            <input
              id={`${id}-titre`}
              className={CHAMP}
              value={f.title}
              maxLength={200}
              placeholder="Fournitures de bureau du trimestre"
              onChange={(e) => setF({ ...f, title: e.target.value })}
              {...aria(`${id}-titre`, champs['title'])}
            />
          </Champ>
        </div>
        <Champ id={`${id}-fournisseur`} label="Fournisseur">
          <ChoixFournisseur
            id={`${id}-fournisseur`}
            valeur={f.supplierId}
            onChange={(s) =>
              setF((p) => ({
                ...p,
                supplierId: s?.id ?? '',
                currency: s?.defaultCurrency ?? p.currency,
              }))
            }
          />
        </Champ>
        <Champ id={`${id}-devise`} label="Devise" aide="Ne change plus après la soumission.">
          <select
            id={`${id}-devise`}
            className={CHAMP}
            value={f.currency}
            onChange={(e) => setF({ ...f, currency: e.target.value as 'USD' | 'CDF' })}
            aria-describedby={`${id}-devise-aide`}
          >
            <option value="USD">USD</option>
            <option value="CDF">CDF</option>
          </select>
        </Champ>
        <Champ id={`${id}-date`} label="Livraison souhaitée" erreur={champs['expectedOn']}>
          <input
            id={`${id}-date`}
            type="date"
            className={CHAMP}
            value={f.expectedOn}
            onChange={(e) => setF({ ...f, expectedOn: e.target.value })}
            {...aria(`${id}-date`, champs['expectedOn'])}
          />
        </Champ>
        <Champ
          id={`${id}-adresse`}
          label="Adresse de livraison"
          aide="Vide : le siège de l’organisation."
          erreur={champs['deliveryAddress']}
        >
          <input
            id={`${id}-adresse`}
            className={CHAMP}
            value={f.deliveryAddress}
            maxLength={500}
            onChange={(e) => setF({ ...f, deliveryAddress: e.target.value })}
            {...aria(`${id}-adresse`, champs['deliveryAddress'], true)}
          />
        </Champ>
        <div className="sm:col-span-2">
          <Champ id={`${id}-justif`} label="Justification" erreur={champs['justification']}>
            <textarea
              id={`${id}-justif`}
              rows={2}
              className={CHAMP}
              value={f.justification}
              maxLength={2000}
              onChange={(e) => setF({ ...f, justification: e.target.value })}
            />
          </Champ>
        </div>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Lignes</legend>
        {champs['lignes'] ? (
          <p className="text-xs text-[var(--danger)]">{champs['lignes']}</p>
        ) : null}
        {f.lignes.map((l, i) => {
          const k = (c: string) => `ligne-${i}-${c}`;
          return (
            <div
              key={i}
              className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]"
            >
              <Champ id={`${id}-${k('label')}`} label="Désignation" erreur={champs[k('label')]}>
                <input
                  id={`${id}-${k('label')}`}
                  className={CHAMP}
                  value={l.label}
                  maxLength={200}
                  onChange={(e) => majLigne(i, { label: e.target.value })}
                  {...aria(`${id}-${k('label')}`, champs[k('label')])}
                />
              </Champ>
              <Champ id={`${id}-${k('kind')}`} label="Nature">
                <select
                  id={`${id}-${k('kind')}`}
                  className={CHAMP}
                  value={l.kind}
                  onChange={(e) => majLigne(i, { kind: e.target.value as LigneSaisie['kind'] })}
                >
                  <option value="goods">Bien</option>
                  <option value="service">Service</option>
                </select>
              </Champ>
              <Champ id={`${id}-${k('quantity')}`} label="Quantité" erreur={champs[k('quantity')]}>
                <input
                  id={`${id}-${k('quantity')}`}
                  inputMode="decimal"
                  className={CHAMP}
                  value={l.quantity}
                  onChange={(e) => majLigne(i, { quantity: e.target.value })}
                  {...aria(`${id}-${k('quantity')}`, champs[k('quantity')])}
                />
              </Champ>
              <Champ id={`${id}-${k('unit')}`} label="Unité">
                <input
                  id={`${id}-${k('unit')}`}
                  className={CHAMP}
                  value={l.unit}
                  maxLength={20}
                  placeholder="pièce, h…"
                  onChange={(e) => majLigne(i, { unit: e.target.value })}
                />
              </Champ>
              <Champ
                id={`${id}-${k('unitPrice')}`}
                label={`Prix unitaire HT (${f.currency})`}
                erreur={champs[k('unitPrice')]}
              >
                <input
                  id={`${id}-${k('unitPrice')}`}
                  inputMode="decimal"
                  className={CHAMP}
                  value={l.unitPrice}
                  onChange={(e) => majLigne(i, { unitPrice: e.target.value })}
                  {...aria(`${id}-${k('unitPrice')}`, champs[k('unitPrice')])}
                />
              </Champ>
              <button
                type="button"
                className={`${BOUTON_PETIT} self-end`}
                disabled={f.lignes.length === 1}
                aria-label={`Retirer la ligne ${i + 1}`}
                onClick={() => setF((p) => ({ ...p, lignes: p.lignes.filter((_, j) => j !== i) }))}
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className={`${BOUTON_PETIT} inline-flex items-center gap-1 self-start`}
          disabled={f.lignes.length >= 100}
          onClick={() => setF((p) => ({ ...p, lignes: [...p.lignes, ligneVide()] }))}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Ajouter une ligne
        </button>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Taxes du devis fournisseur</legend>
        <p className="text-xs text-[var(--foreground-muted)]">{MENTION_TAXES}</p>
        {f.taxes.map((t, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
            <Champ id={`${id}-taxe-${i}-label`} label="Libellé" erreur={champs[`taxe-${i}-label`]}>
              <input
                id={`${id}-taxe-${i}-label`}
                className={CHAMP}
                value={t.label}
                maxLength={60}
                onChange={(e) =>
                  setF((p) => ({
                    ...p,
                    taxes: p.taxes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                  }))
                }
              />
            </Champ>
            <Champ
              id={`${id}-taxe-${i}-montant`}
              label={`Montant (${f.currency})`}
              erreur={champs[`taxe-${i}-amount`]}
            >
              <input
                id={`${id}-taxe-${i}-montant`}
                inputMode="decimal"
                className={CHAMP}
                value={t.amount}
                onChange={(e) =>
                  setF((p) => ({
                    ...p,
                    taxes: p.taxes.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)),
                  }))
                }
              />
            </Champ>
            <button
              type="button"
              className={`${BOUTON_PETIT} self-end`}
              aria-label={`Retirer la taxe ${i + 1}`}
              onClick={() => setF((p) => ({ ...p, taxes: p.taxes.filter((_, j) => j !== i) }))}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className={`${BOUTON_PETIT} inline-flex items-center gap-1 self-start`}
          disabled={f.taxes.length >= 5}
          onClick={() => setF((p) => ({ ...p, taxes: [...p.taxes, { label: 'TVA', amount: '' }] }))}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Ajouter une taxe
        </button>
      </fieldset>

      <p className="text-xs text-[var(--foreground-muted)]">
        La demande est enregistrée en brouillon : les totaux sont calculés par Lalanda, puis vous la
        soumettez pour approbation depuis sa fiche.
      </p>
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
        {envoi ? 'Enregistrement…' : 'Enregistrer le brouillon'}
      </button>
    </form>
  );
}
