'use client';

// Nouveau bon de stock (ADR-0046 § 2.4), dans le `Modal` de `@lalanda/ui`.
// Sortie, entrée (retour au magasin), transfert, retour fournisseur
// (`stock.move`) ; ajustement avec motif (`stock.manage`). « Enregistrer et
// passer » écrit les mouvements ; le disponible est jugé par l'API.

import { STOCK_DEFAULT_ADJUSTMENT_REASONS } from '@lalanda/shared/stock';
import {
  Button,
  DatePicker,
  Field,
  FormGrid,
  SegmentedControl,
  Select,
  SubmitButton,
  TextInput,
  buttonClasses,
} from '@lalanda/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import {
  stockApi,
  type StockAdjustmentReasonView,
  type StockVoucherKind,
  type StockVoucherView,
} from '@/lib/api-stock';
import { workApi } from '@/lib/work-api';

import { Alerte } from '../../ventes/_components/form-ui';

import {
  emplacementsDuBon,
  formulaireBon,
  ligneBonVide,
  preparerBon,
  type FormulaireBon,
  type LigneBon,
} from './bons-model';
import { useAccesStocks } from './stocks-access';
import { LIBELLES_BON, jourKinshasa, messageStocks } from './stocks-model';
import { ChampNombre, ChoixArticle, ChoixEmplacement } from './stocks-ui';

function useMotifs(actif: boolean): StockAdjustmentReasonView[] {
  const [motifs, setMotifs] = useState<StockAdjustmentReasonView[]>(
    STOCK_DEFAULT_ADJUSTMENT_REASONS.map((m) => ({ key: m.key, label: m.label })),
  );
  useEffect(() => {
    if (!actif) return;
    let annule = false;
    stockApi
      .getSettings()
      .then((s) => {
        if (!annule && s.adjustmentReasons.length > 0) setMotifs(s.adjustmentReasons);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [actif]);
  return motifs;
}

function useProjets(actif: boolean): { id: string; name: string }[] {
  const [projets, setProjets] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!actif) return;
    let annule = false;
    workApi
      .listProjects({ status: 'active', limit: 100 })
      .then((p) => {
        if (!annule) setProjets(p.items.map((x) => ({ id: x.id, name: x.name })));
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [actif]);
  return projets;
}

export function BonFormulaire({
  kind,
  onFait,
  onSale,
}: {
  kind: StockVoucherKind;
  onFait: (b: StockVoucherView) => void;
  onSale: (s: boolean) => void;
}): React.ReactElement {
  const id = useId();
  const { actions, emplacements } = useAccesStocks();
  const parDefaut = emplacements?.ok
    ? (emplacements.valeur.find((l) => l.isDefault)?.id ?? '')
    : '';
  const aujourdhui = jourKinshasa(new Date());
  const [f, setF] = useState<FormulaireBon>(() => formulaireBon(kind, aujourdhui, parDefaut));
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const motifs = useMotifs(kind === 'adjustment');
  const projets = useProjets(kind === 'issue' && (actions?.includes('work.read') ?? false));
  const e = emplacementsDuBon(kind);

  const maj = (p: Partial<FormulaireBon>): void => {
    setF((x) => ({ ...x, ...p }));
    onSale(true);
  };
  const majLigne = (i: number, p: Partial<LigneBon>): void =>
    maj({ lignes: f.lignes.map((l, j) => (j === i ? { ...l, ...p } : l)) });

  async function enregistrer(passer: boolean): Promise<void> {
    setErreur(null);
    const p = preparerBon(f, aujourdhui);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      let b = await stockApi.createVoucher(p.corps);
      if (passer) {
        try {
          b = await stockApi.postVoucher(b.id, b.revision);
        } catch (err) {
          // Le brouillon existe : on le dit, il se passe depuis la liste.
          setErreur(
            `${messageStocks(err, 'Le bon n’a pas pu être passé.')} Le bon est enregistré en brouillon.`,
          );
          onFait(b);
          return;
        }
      }
      onFait(b);
    } catch (err) {
      setErreur(messageStocks(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        void enregistrer(true);
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-sm text-[var(--foreground-muted)]">{LIBELLES_BON[kind]}</p>
      <FormGrid>
        {e.depart ? (
          <Field
            id={`${id}-de`}
            label={kind === 'adjustment' ? 'Emplacement' : 'Depuis'}
            required
            size="md"
            error={champs['from']}
          >
            <ChoixEmplacement
              valeur={f.fromLocationId}
              vide="Choisir"
              onChange={(v) => maj({ fromLocationId: v })}
            />
          </Field>
        ) : null}
        {e.arrivee ? (
          <Field id={`${id}-vers`} label="Vers" required size="md" error={champs['to']}>
            <ChoixEmplacement
              valeur={f.toLocationId}
              vide="Choisir"
              {...(kind === 'transfer' ? { exclure: f.fromLocationId } : {})}
              onChange={(v) => maj({ toLocationId: v })}
            />
          </Field>
        ) : null}
        <Field id={`${id}-date`} label="Date" required size="sm" error={champs['postedOn']}>
          <DatePicker
            value={f.postedOn}
            max={aujourdhui}
            shortcuts={['today']}
            onChange={(v) => maj({ postedOn: v })}
          />
        </Field>
        {kind === 'issue' ? (
          <>
            <Field id={`${id}-projet`} label="Projet consommateur" size="lg" newRow optional>
              <Select
                value={f.workProjectId}
                onChange={(v) => maj({ workProjectId: v })}
                options={[
                  { value: '', label: 'Aucun (consommation interne)' },
                  ...projets.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </Field>
            <Field id={`${id}-pour`} label="Remis à" size="md" error={champs['recipient']}>
              <TextInput
                value={f.recipient}
                maxLength={500}
                placeholder="Nom du bénéficiaire"
                onChange={(ev) => maj({ recipient: ev.target.value })}
              />
            </Field>
          </>
        ) : null}
        {kind === 'adjustment' ? (
          <>
            <Field
              id={`${id}-motif`}
              label="Motif"
              required
              size="md"
              newRow
              error={champs['reason']}
            >
              <Select
                value={f.reason}
                onChange={(v) => maj({ reason: v })}
                placeholder="Choisir un motif"
                options={motifs.map((m) => ({ value: m.key, label: m.label }))}
              />
            </Field>
            <Field id={`${id}-precision`} label="Précision" size="lg" error={champs['reasonNote']}>
              <TextInput
                value={f.reasonNote}
                maxLength={500}
                onChange={(ev) => maj({ reasonNote: ev.target.value })}
              />
            </Field>
          </>
        ) : null}
      </FormGrid>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Articles</legend>
        {champs['lignes'] ? (
          <p className="text-xs text-[var(--danger)]">{champs['lignes']}</p>
        ) : null}
        {f.lignes.map((l, i) => (
          <div
            key={i}
            className={`grid items-start gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3 ${kind === 'adjustment' ? 'sm:grid-cols-[2fr_auto_1fr_auto]' : 'sm:grid-cols-[2fr_1fr_auto]'}`}
          >
            <Field
              id={`${id}-l${i}-art`}
              label="Article"
              size="full"
              error={champs[`ligne-${i}-item`]}
            >
              <ChoixArticle
                valeur={l.itemId}
                nomInitial={l.itemName || null}
                creer
                onChange={(a) =>
                  majLigne(i, { itemId: a?.id ?? '', itemName: a?.name ?? '', unit: a?.unit ?? '' })
                }
              />
            </Field>
            {kind === 'adjustment' ? (
              <Field id={`${id}-l${i}-sens`} label="Sens" size="full" group>
                <SegmentedControl<LigneBon['sens']>
                  value={l.sens}
                  onChange={(v) => majLigne(i, { sens: v })}
                  options={[
                    { value: 'out', label: 'Retirer' },
                    { value: 'in', label: 'Ajouter' },
                  ]}
                />
              </Field>
            ) : null}
            <Field
              id={`${id}-l${i}-q`}
              label={l.unit ? `Quantité (${l.unit})` : 'Quantité'}
              size="full"
              error={champs[`ligne-${i}-quantity`]}
            >
              <ChampNombre
                value={l.quantity}
                onChange={(ev) => majLigne(i, { quantity: ev.target.value })}
              />
            </Field>
            <Button
              size="sm"
              className="self-start sm:mt-6 max-sm:h-11"
              disabled={f.lignes.length === 1}
              aria-label={`Retirer la ligne ${i + 1}`}
              onClick={() => maj({ lignes: f.lignes.filter((_, j) => j !== i) })}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          className="self-start max-sm:h-11"
          disabled={f.lignes.length >= 100}
          onClick={() => maj({ lignes: [...f.lignes, ligneBonVide()] })}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Ajouter un article
        </Button>
      </fieldset>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton busy={envoi} busyLabel="Enregistrement…" className="max-sm:w-full">
          Enregistrer et passer
        </SubmitButton>
        <button
          type="button"
          disabled={envoi}
          className={buttonClasses('secondary', 'md')}
          onClick={() => void enregistrer(false)}
        >
          Enregistrer en brouillon
        </button>
      </div>
    </form>
  );
}
