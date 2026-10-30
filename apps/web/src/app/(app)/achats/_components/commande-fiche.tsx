'use client';

// Fiche d'une demande d'achat ou d'un bon de commande — ADR-0044 § 2.3, § 3.2,
// § 3.3 et § 8 : lignes, totaux du moteur, approbations, gestes du cycle de vie,
// aperçu PDF et envoi par e-mail du bon de commande (motif d'ADR-0042 § 9).
//
// Les boutons viennent de `actionsCommande` (droits servis par le serveur,
// séparation des tâches affichée) ; l'API reste juge et ses refus s'affichent.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { ClipboardCheck, ClipboardList, History, ListOrdered } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useState } from 'react';

import { purchasesApi, type PurchaseOrderView } from '@/lib/api-purchases';

import { Bandeau, Panneau, PhraseSection, Tuile } from '../../crm/_components/crm-ui';
import { ApercuDocument } from '../../ventes/_components/apercu-document';
import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';
import { formatMontant } from '../../ventes/_components/sales-model';

import { useAccesAchats } from './achats-access';
import {
  ACHATS_BASE,
  LIBELLES_STATUT,
  formatInstantJour,
  formatJour,
  lienCommande,
  lienFournisseur,
  messageAchats,
  nomPersonne,
  peutApprouverAchats,
  peutGererAchats,
  tonStatut,
} from './achats-model';
import {
  MENTION_TAXES,
  actionsCommande,
  approbateurUnique,
  natureCommande,
  numeroCommande,
  phraseApprobations,
  type ActionCommande,
  type IdAction,
} from './commandes-model';

/** Gestes qui demandent une saisie ou une confirmation avant l'appel. */
type Dialogue = 'approuver' | 'refuser' | 'annuler' | 'supprimer' | null;

function DialogueDecision({
  dialogue,
  o,
  onFermer,
  onFait,
}: {
  dialogue: Exclude<Dialogue, null>;
  o: PurchaseOrderView;
  onFermer: () => void;
  onFait: (suite: PurchaseOrderView | null) => void;
}): React.ReactElement {
  const id = useId();
  const [texte, setTexte] = useState('');
  const [champ, setChamp] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const obligatoire = dialogue === 'refuser' || dialogue === 'annuler';
  const titres: Record<Exclude<Dialogue, null>, [string, string, string]> = {
    approuver: ['Approuver la demande', 'Commentaire (facultatif)', 'Approuver'],
    refuser: ['Refuser la demande', 'Motif du refus', 'Refuser'],
    annuler: ['Annuler la commande', 'Motif de l’annulation', 'Annuler la commande'],
    supprimer: ['Supprimer le brouillon', '', 'Supprimer'],
  };
  const [titre, label, bouton] = titres[dialogue];

  async function valider(): Promise<void> {
    const t = texte.trim();
    if (obligatoire && t === '') {
      setChamp('Le motif est obligatoire.');
      return;
    }
    setChamp(undefined);
    setErreur(null);
    setEnvoi(true);
    try {
      const r = o.revision;
      switch (dialogue) {
        case 'approuver':
          onFait(
            await purchasesApi.approveOrder(o.id, {
              expectedRevision: r,
              ...(t ? { comment: t } : {}),
            }),
          );
          break;
        case 'refuser':
          onFait(await purchasesApi.rejectOrder(o.id, { comment: t, expectedRevision: r }));
          break;
        case 'annuler':
          onFait(await purchasesApi.cancelOrder(o.id, { reason: t, expectedRevision: r }));
          break;
        case 'supprimer':
          await purchasesApi.deleteOrder(o.id);
          onFait(null);
          break;
      }
    } catch (err) {
      setErreur(messageAchats(err, 'Action impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title={titre}
      description={`${numeroCommande(o)} — ${o.title}`}
      size="sm"
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
            onClick={() => void valider()}
          >
            {envoi ? 'Envoi…' : bouton}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {dialogue === 'supprimer' ? (
          <p>Le brouillon sera supprimé. Cette action est définitive.</p>
        ) : (
          <>
            {dialogue === 'approuver' ? (
              <p>
                Montant :{' '}
                <strong className="tabular-nums">
                  {formatMontant(o.totals.total, o.currency)}
                </strong>{' '}
                ({o.supplierName ?? 'fournisseur à préciser'}).
              </p>
            ) : null}
            <Champ id={`${id}-texte`} label={label} requis={obligatoire} erreur={champ}>
              <textarea
                id={`${id}-texte`}
                rows={3}
                className={CHAMP}
                value={texte}
                maxLength={dialogue === 'annuler' ? 1000 : 2000}
                onChange={(e) => setTexte(e.target.value)}
                {...aria(`${id}-texte`, champ)}
              />
            </Champ>
          </>
        )}
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
      </div>
    </Modal>
  );
}

function BoutonAction({
  a,
  onClic,
  occupe,
}: {
  a: ActionCommande;
  onClic: (id: IdAction) => void;
  occupe: boolean;
}): React.ReactElement {
  const id = useId();
  const principal = a.id === 'approuver' || a.id === 'soumettre';
  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        className={principal ? buttonClasses('primary', 'sm') : BOUTON_PETIT}
        disabled={!a.actif || occupe}
        aria-describedby={a.raison ? `${id}-raison` : undefined}
        onClick={() => onClic(a.id)}
      >
        {a.libelle}
      </button>
      {a.raison ? (
        <span id={`${id}-raison`} className="max-w-xs text-xs text-[var(--foreground-muted)]">
          {a.raison}
        </span>
      ) : null}
    </span>
  );
}

export function CommandeFiche({ orderId }: { orderId: string }): React.ReactElement {
  const router = useRouter();
  const { actions, membres, moi } = useAccesAchats();
  const [o, setO] = useState<PurchaseOrderView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurAction, setErreurAction] = useState<string | null>(null);
  const [enAttente, setEnAttente] = useState<boolean | null>(null);
  const [dialogue, setDialogue] = useState<Dialogue>(null);
  const [apercu, setApercu] = useState(false);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(() => {
    purchasesApi
      .getOrder(orderId)
      .then((v) => {
        setO(v);
        setErreur(null);
      })
      .catch((err: unknown) => setErreur(messageAchats(err, 'Demande illisible.')));
  }, [orderId]);

  useEffect(() => charger(), [charger]);

  // L'API dit si l'utilisateur peut approuver CETTE demande (séparation des
  // tâches, approbateur unique) : on lit sa liste d'attente plutôt que deviner.
  const statut = o?.status;
  useEffect(() => {
    if (statut !== 'submitted' || !peutApprouverAchats(actions)) return;
    let annule = false;
    purchasesApi
      .listPendingApprovals({ limit: 100 })
      .then((p) => {
        if (!annule) setEnAttente(p.items.some((x) => x.id === orderId));
      })
      .catch(() => {
        if (!annule) setEnAttente(null);
      });
    return () => {
      annule = true;
    };
  }, [statut, actions, orderId]);

  async function geste(id: IdAction): Promise<void> {
    if (o === null) return;
    setErreurAction(null);
    if (id === 'approuver' || id === 'refuser' || id === 'annuler' || id === 'supprimer') {
      setDialogue(id);
      return;
    }
    if (id === 'apercu') {
      setApercu(true);
      return;
    }
    setOccupe(true);
    try {
      if (id === 'soumettre') setO(await purchasesApi.submitOrder(o.id, o.revision));
      else if (id === 'marquer-envoyee') setO(await purchasesApi.markOrderSent(o.id, o.revision));
      else if (id === 'dupliquer') {
        const copie = await purchasesApi.duplicateOrder(o.id);
        router.push(lienCommande(copie.id));
      }
    } catch (err) {
      setErreurAction(messageAchats(err, 'Action impossible.'));
    } finally {
      setOccupe(false);
    }
  }

  const retour = (
    <Link href={`${ACHATS_BASE}/commandes`} className="text-sm underline underline-offset-2">
      ← Demandes et commandes
    </Link>
  );

  if (o === null) {
    return (
      <section className="flex min-w-0 flex-col gap-5">
        {retour}
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : (
          <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
            Chargement de la demande…
          </p>
        )}
      </section>
    );
  }

  const liste = actionsCommande(o, { actions, moi, enAttentePourMoi: enAttente });
  const progression = phraseApprobations(o);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      {retour}
      <Bandeau
        icone={o.phase === 'order' ? ClipboardCheck : ClipboardList}
        titre={o.title}
        sousTitre={`${natureCommande(o)} · ${numeroCommande(o)} · demandé par ${nomPersonne(membres, o.requestedBy, moi)}`}
        actions={<Badge tone={tonStatut(o.status)}>{LIBELLES_STATUT[o.status]}</Badge>}
      >
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tuile
            libelle="Fournisseur"
            valeur={
              o.supplierId ? (
                <Link
                  href={lienFournisseur(o.supplierId)}
                  className="break-words underline-offset-2 hover:underline"
                >
                  {o.supplierName ?? 'Ouvrir la fiche'}
                </Link>
              ) : (
                'À choisir'
              )
            }
          />
          <Tuile libelle="Sous-total HT" valeur={formatMontant(o.totals.subtotal, o.currency)} />
          <Tuile
            libelle="Taxes déclarées"
            valeur={formatMontant(o.totals.taxes, o.currency)}
            detail="Telles qu’indiquées par le fournisseur"
          />
          <Tuile libelle="Total TTC" valeur={formatMontant(o.totals.total, o.currency)} />
        </dl>
        {liste.length > 0 ? (
          <div className="flex flex-wrap items-start gap-2">
            {liste.map((a) => (
              <BoutonAction key={a.id} a={a} occupe={occupe} onClic={(id) => void geste(id)} />
            ))}
          </div>
        ) : null}
        {erreurAction ? (
          <Alerte>
            <p>{erreurAction}</p>
          </Alerte>
        ) : null}
      </Bandeau>

      {o.cancellation ? (
        <Alerte>
          <p>
            Annulée le {formatInstantJour(o.cancellation.at)} par{' '}
            {nomPersonne(membres, o.cancellation.by, moi)} : {o.cancellation.reason}
          </p>
        </Alerte>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panneau titre="Lignes" icone={ListOrdered} id="cmd-lignes" className="lg:col-span-2">
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--foreground-muted)]">
                  <th className="px-4 py-1 font-medium sm:px-2">Désignation</th>
                  <th className="px-2 py-1 font-medium">Nature</th>
                  <th className="px-2 py-1 text-right font-medium">Quantité</th>
                  <th className="px-2 py-1 text-right font-medium">Prix unitaire HT</th>
                  <th className="px-4 py-1 text-right font-medium sm:px-2">Montant HT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {o.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2 break-words sm:px-2">{l.label}</td>
                    <td className="px-2 py-2">{l.kind === 'service' ? 'Service' : 'Bien'}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {l.quantity.replace('.', ',')}
                      {l.unit ? ` ${l.unit}` : ''}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                      {formatMontant(l.unitPrice, o.currency)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap sm:px-2">
                      {formatMontant(l.amount, o.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {o.declaredTaxes.length > 0 ? (
            <div className="flex flex-col gap-1 text-sm">
              <p className="text-xs text-[var(--foreground-muted)]">{MENTION_TAXES}</p>
              {o.declaredTaxes.map((t) => (
                <p key={t.label} className="flex justify-between gap-2">
                  <span>{t.label}</span>
                  <span className="tabular-nums">{formatMontant(t.amount, o.currency)}</span>
                </p>
              ))}
            </div>
          ) : null}
        </Panneau>

        <Panneau titre="Approbations" icone={History} id="cmd-approbations">
          {progression ? <p className="text-sm font-medium">{progression}</p> : null}
          {approbateurUnique(o) ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Approuvée par l’approbateur unique de l’organisation : le palier a été réduit à une
              approbation.
            </p>
          ) : null}
          {o.approvals.length === 0 ? (
            <PhraseSection>
              {o.status === 'draft'
                ? 'Brouillon : le nombre d’approbations est fixé à la soumission.'
                : 'Aucune décision pour l’instant.'}
            </PhraseSection>
          ) : (
            <ol className="flex flex-col gap-2 text-sm">
              {o.approvals.map((x) => (
                <li key={`${x.userId}-${x.at}`} className="flex flex-col">
                  <span>
                    {x.decision === 'approved' ? 'Approuvée' : 'Refusée'} par{' '}
                    {nomPersonne(membres, x.userId, moi)}
                  </span>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {formatInstantJour(x.at)}
                    {x.comment ? ` — ${x.comment}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-[var(--foreground-muted)]">Livraison souhaitée</dt>
            <dd>{formatJour(o.expectedOn)}</dd>
            <dt className="text-[var(--foreground-muted)]">Adresse</dt>
            <dd className="break-words">{o.deliveryAddress ?? 'Siège de l’organisation'}</dd>
            {o.sentAt ? (
              <>
                <dt className="text-[var(--foreground-muted)]">Envoyée</dt>
                <dd>
                  {formatInstantJour(o.sentAt)}
                  {o.sentVia === 'email' ? ' par e-mail' : ' (hors Lalanda)'}
                </dd>
              </>
            ) : null}
          </dl>
          {o.justification ? (
            <p className="text-sm whitespace-pre-line">{o.justification}</p>
          ) : null}
        </Panneau>
      </div>

      {dialogue ? (
        <DialogueDecision
          dialogue={dialogue}
          o={o}
          onFermer={() => setDialogue(null)}
          onFait={(suite) => {
            setDialogue(null);
            if (suite === null) router.push(`${ACHATS_BASE}/commandes`);
            else setO(suite);
          }}
        />
      ) : null}
      {apercu ? (
        <ApercuDocument
          document={{
            genre: 'bon-de-commande',
            id: o.id,
            titre: `Bon de commande ${numeroCommande(o)}`,
            nomFichier: `${o.orderNumber ?? 'bon-de-commande'}.pdf`,
            peutEnvoyer: peutGererAchats(actions),
          }}
          onFermer={() => {
            setApercu(false);
            charger();
          }}
        />
      ) : null}
    </section>
  );
}
