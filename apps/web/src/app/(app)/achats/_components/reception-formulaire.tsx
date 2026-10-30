'use client';

// Nouvelle réception depuis une commande (ADR-0044 § 2.4), dans le `Modal` de
// `@lalanda/ui` : totale (« Tout est arrivé ») ou partielle (quantités ligne à
// ligne). Aucune quantité n'est additionnée ici : le reste à recevoir est rendu par
// l'API après l'enregistrement.

import { Modal, buttonClasses } from '@lalanda/ui';
import { useId, useState } from 'react';

import {
  purchasesPayablesApi,
  type PurchaseOrderDetailView,
  type PurchaseReceptionWriteResult,
} from '@/lib/api-purchases-payables';

import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';

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
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BOUTON_PETIT} onClick={onFermer} disabled={envoi}>
            Retour
          </button>
          <button
            type="button"
            className={buttonClasses('primary', 'sm')}
            disabled={envoi}
            onClick={() => void enregistrer()}
          >
            {envoi ? 'Enregistrement…' : 'Enregistrer la réception'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        {avertissement ? (
          <p className="rounded-[var(--radius-sm)] border border-[var(--warn)]/50 p-3">
            {avertissement}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ id={`${id}-date`} label="Reçue le" requis erreur={champs['receivedOn']}>
            <input
              id={`${id}-date`}
              type="date"
              max={aujourdhui}
              className={CHAMP}
              value={f.receivedOn}
              onChange={(e) => setF({ ...f, receivedOn: e.target.value })}
              {...aria(`${id}-date`, champs['receivedOn'])}
            />
          </Champ>
          <Champ id={`${id}-bl`} label="N° du bon de livraison" erreur={champs['deliveryNoteRef']}>
            <input
              id={`${id}-bl`}
              className={CHAMP}
              value={f.deliveryNoteRef}
              maxLength={100}
              onChange={(e) => setF({ ...f, deliveryNoteRef: e.target.value })}
              {...aria(`${id}-bl`, champs['deliveryNoteRef'])}
            />
          </Champ>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="flex w-full flex-wrap items-center justify-between gap-2 text-sm font-medium">
            Quantités reçues
            <button type="button" className={BOUTON_PETIT} onClick={() => setF(toutRecu(f))}>
              Tout est arrivé (quantités commandées)
            </button>
          </legend>
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
                <div className="sm:w-36">
                  <Champ id={`${id}-q-${i}`} label="Reçu aujourd’hui" erreur={champs[`ligne-${i}`]}>
                    <input
                      id={`${id}-q-${i}`}
                      inputMode="decimal"
                      className={CHAMP}
                      value={l.saisie}
                      placeholder="0"
                      onChange={(e) => majLigne(i, e.target.value)}
                      {...aria(`${id}-q-${i}`, champs[`ligne-${i}`])}
                    />
                  </Champ>
                </div>
              </li>
            ))}
          </ul>
        </fieldset>

        <Champ id={`${id}-note`} label="Note" erreur={champs['note']}>
          <textarea
            id={`${id}-note`}
            rows={2}
            className={CHAMP}
            value={f.note}
            maxLength={1000}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
        </Champ>
        <Champ
          id={`${id}-piece`}
          label="Bon de livraison scanné (facultatif)"
          aide="PDF (10 Mio) ou photo PNG, JPEG, WebP (2 Mio)."
          erreur={champs['piece']}
        >
          <input
            id={`${id}-piece`}
            type="file"
            accept={TYPES_PIECE}
            className="text-sm"
            onChange={(e) => setPiece(e.target.files?.[0] ?? null)}
            {...aria(`${id}-piece`, champs['piece'], true)}
          />
        </Champ>
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
      </div>
    </Modal>
  );
}
