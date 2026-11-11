'use client';

// Nouvelle réception depuis une commande (ADR-0044 § 2.4), dans le `Modal` de
// `@lalanda/ui` : totale (« Tout est arrivé ») ou partielle (quantités ligne à
// ligne). Aucune quantité n'est additionnée ici : le reste à recevoir est rendu par
// l'API après l'enregistrement.
//
// ADR-0074 : date en `DatePicker` (bornée à aujourd'hui comme avant), quantités
// à la largeur d'une quantité, composants de `@lalanda/ui`. Mêmes champs envoyés.

import { Button, DatePicker, Field, FormGrid, Modal, TextArea, TextInput } from '@lalanda/ui';
import { useId, useState } from 'react';

import {
  purchasesPayablesApi,
  type PurchaseOrderDetailView,
  type PurchaseReceptionWriteResult,
} from '@/lib/api-purchases-payables';

import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { formatJour, messageAchats } from './achats-model';
import { numeroCommande } from './commandes-model';
import { TYPES_PIECE, verifierPiece } from './factures-model';
import {
  aDejaDesReceptions,
  avertissementNonEnvoyee,
  formatQuantite,
  formulaireReception,
  jourKinshasa,
  preparerReception,
  toutRecu,
  type FormulaireReception,
} from './receptions-model';

export function FenetreReception({
  commande,
  onFermer,
  onCree,
}: {
  commande: PurchaseOrderDetailView;
  onFermer: () => void;
  onCree: (r: PurchaseReceptionWriteResult, avertissementPiece: string | null) => void;
}): React.ReactElement {
  const id = useId();
  const aujourdhui = jourKinshasa();
  const [f, setF] = useState<FormulaireReception>(() => formulaireReception(commande, aujourdhui));
  const [piece, setPiece] = useState<File | null>(null);
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const avertissement = avertissementNonEnvoyee(commande);
  const dejaRecu = aDejaDesReceptions(f);

  const majLigne = (i: number, saisie: string) =>
    setF((p) => ({ ...p, lignes: p.lignes.map((l, j) => (j === i ? { ...l, saisie } : l)) }));

  async function enregistrer(): Promise<void> {
    setErreur(null);
    const p = preparerReception(commande.id, f, aujourdhui);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    if (piece) {
      const refus = verifierPiece(piece);
      if (refus) {
        setChamps({ piece: refus });
        return;
      }
    }
    setEnvoi(true);
    try {
      const r = await purchasesPayablesApi.createReception(p.corps);
      let avertissementPiece: string | null = null;
      if (piece) {
        try {
          await purchasesPayablesApi.uploadReceptionAttachment(r.reception.id, piece);
        } catch (err) {
          avertissementPiece = `Réception enregistrée, mais la pièce n’a pas été jointe : ${messageAchats(err, 'envoi impossible')}`;
        }
      }
      onCree(r, avertissementPiece);
    } catch (err) {
      setErreur(messageAchats(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title="Enregistrer une réception"
      description={`${numeroCommande(commande)} — ${commande.title}. Indiquez ce qui est arrivé ; une ligne vide n’est pas reçue cette fois.`}
      size="lg"
      busy={envoi}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button onClick={onFermer} disabled={envoi} className="max-sm:h-11">
            Retour
          </Button>
          <Button
            variant="primary"
            busy={envoi}
            onClick={() => void enregistrer()}
            className="max-sm:h-11"
          >
            {envoi ? 'Enregistrement…' : 'Enregistrer la réception'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        {avertissement ? (
          <p className="rounded-[var(--radius-sm)] border border-[var(--warn)]/50 p-3">
            {avertissement}
          </p>
        ) : null}
        <FormGrid>
          <Field id={`${id}-date`} label="Reçue le" required size="sm" error={champs['receivedOn']}>
            <DatePicker
              value={f.receivedOn}
              max={aujourdhui}
              onChange={(v) => setF({ ...f, receivedOn: v })}
              shortcuts={['today']}
            />
          </Field>
          <Field
            id={`${id}-bl`}
            label="N° du bon de livraison"
            optional
            size="md"
            error={champs['deliveryNoteRef']}
          >
            <TextInput
              value={f.deliveryNoteRef}
              maxLength={100}
              onChange={(e) => setF({ ...f, deliveryNoteRef: e.target.value })}
              className="font-mono"
            />
          </Field>
        </FormGrid>

        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">Quantités reçues</legend>
          <button
            type="button"
            className={`${BOUTON_PETIT} self-start max-sm:h-11`}
            onClick={() => setF(toutRecu(f))}
          >
            Tout est arrivé (quantités commandées)
          </button>
          {dejaRecu ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Des réceptions sont déjà enregistrées : saisissez seulement ce qui arrive aujourd’hui.
              « Tout est arrivé » reprend les quantités commandées en entier ; recevoir plus que
              commandé est signalé comme un écart, pas refusé.
            </p>
          ) : null}
          {champs['lignes'] ? (
            <p className="text-xs font-medium text-[var(--danger)]">{champs['lignes']}</p>
          ) : null}
          <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-md)] border border-[var(--border)]">
            {f.lignes.map((l, i) => (
              <li
                key={l.orderLineId}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-medium break-words">{l.label}</span>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {l.service ? 'Service (« service fait ») · ' : ''}Commandé :{' '}
                    {formatQuantite(l.commande)}
                    {l.unit ? ` ${l.unit}` : ''}
                  </span>
                  {l.dejaRecu.length > 0 ? (
                    <span className="text-xs text-[var(--foreground-muted)]">
                      Déjà reçu :{' '}
                      {l.dejaRecu
                        .map((x) => `${formatQuantite(x.quantity)} le ${formatJour(x.receivedOn)}`)
                        .join(', ')}
                    </span>
                  ) : null}
                </div>
                <Field
                  id={`${id}-q-${i}`}
                  label="Reçu aujourd’hui"
                  className="sm:w-36"
                  error={champs[`ligne-${i}`]}
                >
                  <TextInput
                    inputMode="decimal"
                    value={l.saisie}
                    placeholder="0"
                    onChange={(e) => majLigne(i, e.target.value)}
                    className="text-right tabular-nums"
                    {...(l.unit ? { trailing: l.unit } : {})}
                  />
                </Field>
              </li>
            ))}
          </ul>
        </fieldset>

        <FormGrid>
          <Field id={`${id}-note`} label="Note" optional size="full" error={champs['note']}>
            <TextArea
              rows={2}
              value={f.note}
              maxLength={1000}
              onChange={(e) => setF({ ...f, note: e.target.value })}
            />
          </Field>
          <Field
            id={`${id}-piece`}
            label="Bon de livraison scanné"
            optional
            size="full"
            hint="PDF (10 Mio) ou photo PNG, JPEG, WebP (2 Mio)."
            error={champs['piece']}
          >
            {({ id: idPiece, describedBy, invalid }) => (
              <input
                id={idPiece}
                type="file"
                accept={TYPES_PIECE}
                className="text-sm file:mr-3 file:rounded-[var(--radius-sm)] file:border file:border-[var(--border-strong)] file:bg-[var(--surface)] file:px-3 file:py-1.5 file:text-sm file:font-medium"
                onChange={(e) => setPiece(e.target.files?.[0] ?? null)}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
              />
            )}
          </Field>
        </FormGrid>
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
      </div>
    </Modal>
  );
}
