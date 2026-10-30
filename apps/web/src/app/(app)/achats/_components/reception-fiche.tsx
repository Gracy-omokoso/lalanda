'use client';

// Fiche d'une réception — ADR-0044 § 2.4, § 3.4 : lignes reçues, bon de livraison,
// pièce jointe, annulation motivée (jamais d'effacement).

import { Badge } from '@lalanda/ui';
import { ListOrdered, PackageCheck, Paperclip } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { purchasesPayablesApi, type PurchaseReceptionView } from '@/lib/api-purchases-payables';

import { Bandeau, Panneau, Tuile } from '../../crm/_components/crm-ui';
import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { useAccesAchats } from './achats-access';
import {
  ACHATS_BASE,
  formatInstantJour,
  formatJour,
  lienCommande,
  messageAchats,
  nomPersonne,
  peutGererAchats,
} from './achats-model';
import { DialogueMotif } from './dialogue-motif';
import { PieceJointe } from './piece-jointe';
import {
  LIBELLES_STATUT_RECEPTION,
  formatQuantite,
  peutAnnulerReception,
} from './receptions-model';

export function ReceptionFiche({ receptionId }: { receptionId: string }): React.ReactElement {
  const { actions, membres, moi } = useAccesAchats();
  const [r, setR] = useState<PurchaseReceptionView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annuler, setAnnuler] = useState(false);

  const charger = useCallback(() => {
    purchasesPayablesApi
      .getReception(receptionId)
      .then((v) => {
        setR(v);
        setErreur(null);
      })
      .catch((err: unknown) => setErreur(messageAchats(err, 'Réception illisible.')));
  }, [receptionId]);

  useEffect(() => charger(), [charger]);

  const retour = (
    <Link href={`${ACHATS_BASE}/receptions`} className="text-sm underline underline-offset-2">
      ← Réceptions
    </Link>
  );

  if (r === null) {
    return (
      <section className="flex min-w-0 flex-col gap-5">
        {retour}
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : (
          <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
            Chargement de la réception…
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      {retour}
      <Bandeau
        icone={PackageCheck}
        titre={`Réception du ${formatJour(r.receivedOn)}`}
        sousTitre={`Enregistrée par ${nomPersonne(membres, r.createdBy, moi)} le ${formatInstantJour(r.createdAt)}`}
        actions={
          <Badge tone={r.status === 'cancelled' ? 'danger' : 'success'}>
            {LIBELLES_STATUT_RECEPTION[r.status]}
          </Badge>
        }
      >
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Tuile
            libelle="Commande"
            valeur={
              <Link
                href={lienCommande(r.orderId)}
                className="break-words underline-offset-2 hover:underline"
              >
                {r.orderNumber ?? 'Ouvrir la commande'}
              </Link>
            }
          />
          <Tuile libelle="Bon de livraison" valeur={r.deliveryNoteRef ?? '—'} />
          <Tuile libelle="Lignes reçues" valeur={String(r.lines.length)} />
        </dl>
        {peutAnnulerReception(r, actions) ? (
          <div>
            <button type="button" className={BOUTON_PETIT} onClick={() => setAnnuler(true)}>
              Annuler la réception
            </button>
          </div>
        ) : null}
      </Bandeau>

      {r.cancellation ? (
        <Alerte>
          <p>
            Annulée le {formatInstantJour(r.cancellation.at)} par{' '}
            {nomPersonne(membres, r.cancellation.by, moi)} : {r.cancellation.reason}
          </p>
        </Alerte>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panneau
          titre="Quantités reçues"
          icone={ListOrdered}
          id="rec-lignes"
          className="lg:col-span-2"
        >
          <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
            {r.lines.map((l) => (
              <li key={l.orderLineId} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="break-words">{l.label ?? 'Ligne de la commande'}</span>
                <span className="tabular-nums">
                  {formatQuantite(l.quantity)}
                  {l.unit ? ` ${l.unit}` : ''}
                </span>
              </li>
            ))}
          </ul>
          {r.note ? <p className="text-sm whitespace-pre-line">{r.note}</p> : null}
        </Panneau>
        <Panneau titre="Pièce jointe" icone={Paperclip} id="rec-piece">
          <PieceJointe
            piece={r.attachment}
            peutJoindre={peutGererAchats(actions) && r.status === 'recorded'}
            manque="Aucun bon de livraison joint."
            telecharger={() => purchasesPayablesApi.downloadReceptionAttachment(r.id)}
            envoyer={async (file) => {
              setR(await purchasesPayablesApi.uploadReceptionAttachment(r.id, file));
            }}
            onEnvoyee={() => undefined}
          />
        </Panneau>
      </div>

      {annuler ? (
        <DialogueMotif
          titre="Annuler la réception"
          description="La réception reste visible, marquée annulée ; le statut de la commande est recalculé."
          libelle="Motif de l’annulation"
          bouton="Annuler la réception"
          motif="obligatoire"
          onFermer={() => setAnnuler(false)}
          onValider={async (motif) => {
            const res = await purchasesPayablesApi.cancelReception(r.id, {
              reason: motif,
              expectedRevision: r.revision,
            });
            setR(res.reception);
            setAnnuler(false);
          }}
        />
      ) : null}
    </section>
  );
}
