'use client';

// Devis accepté → commande client ou contrat — ADR-0050 § 4.1, § 9, lot V7.
//
// À côté de « Convertir en facture » (ADR-0035, inchangé) : « Créer la commande » et
// « Créer le contrat » (`sales.contract`). Lignes et prix du devis FIXÉS ; le devis n'est
// pas modifié. Chaque geste ouvre une fenêtre modale ; une commande déjà créée pour ce
// devis est signalée et ouverte (`409 ORDER_EXISTS_FOR_QUOTE`).

import { DatePicker, Field, FormGrid, Modal, TextInput, buttonClasses } from '@lalanda/ui';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import type { OrgAction } from '@/lib/api';
import type { QuoteView } from '@/lib/api-crm';
import { salesContractsApi } from '@/lib/api-sales-contracts';

import { Alerte, BOUTON } from '../../../_components/form-ui';
import { ChampsClauses } from '../../../contrats/_components/clauses-fields';
import {
  COMMANDES_BASE,
  CONTRATS_BASE,
  aujourdhuiKinshasa,
  champsRefusesEngagement,
  clausesVides,
  codeErreur,
  messageEngagement,
  peutPreparerEngagement,
  preparerClauses,
  type FormulaireClauses,
} from '../../../contrats/_components/contract-model';

export function QuoteEngagementBox({
  quote,
  actions,
}: {
  quote: QuoteView;
  actions: readonly OrgAction[] | null;
}): React.ReactElement | null {
  const [fenetre, setFenetre] = useState<null | 'commande' | 'contrat'>(null);
  if (quote.status !== 'accepted' || !peutPreparerEngagement(actions)) return null;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-[var(--border)] p-4">
      <h3 className="text-sm font-semibold">Engager la suite</h3>
      <p className="text-sm text-[var(--foreground-muted)]">
        Le devis accepté peut aussi donner une commande client (livrée et facturée en une ou
        plusieurs fois) ou un contrat (durée, reconduction, préavis, échéancier). Le devis n’est pas
        modifié.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BOUTON}
          aria-haspopup="dialog"
          onClick={() => setFenetre('commande')}
        >
          Créer la commande
        </button>
        <button
          type="button"
          className={BOUTON}
          aria-haspopup="dialog"
          onClick={() => setFenetre('contrat')}
        >
          Créer le contrat
        </button>
      </div>
      {fenetre === 'commande' ? (
        <FenetreVersCommande quote={quote} onFermer={() => setFenetre(null)} />
      ) : null}
      {fenetre === 'contrat' ? (
        <FenetreVersContrat quote={quote} onFermer={() => setFenetre(null)} />
      ) : null}
    </section>
  );
}

function FenetreVersCommande({
  quote,
  onFermer,
}: {
  quote: QuoteView;
  onFermer: () => void;
}): React.ReactElement {
  const router = useRouter();
  const id = useId();
  const [date, setDate] = useState(aujourdhuiKinshasa());
  const [reference, setReference] = useState('');
  const [livraison, setLivraison] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [existante, setExistante] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function creer(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await salesContractsApi.quoteToOrder(quote.id, {
        orderedOn: date,
        customerReference: reference.trim() === '' ? null : reference.trim(),
        requestedDeliveryDate: livraison === '' ? null : livraison,
      });
      router.push(`${COMMANDES_BASE}/${encodeURIComponent(r.order.id)}`);
    } catch (err) {
      if (codeErreur(err) === 'ORDER_EXISTS_FOR_QUOTE') {
        const d = (err as { detail?: { details?: { orderId?: unknown } } }).detail?.details;
        if (typeof d?.orderId === 'string') setExistante(d.orderId);
      }
      setErreur(messageEngagement(err, 'La commande n’a pas pu être créée.'));
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title={`Créer la commande — devis ${quote.number}`}
      description="La commande reprend les lignes et les prix du devis. Elle naît en brouillon ; vous la confirmez ensuite."
      busy={envoi}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={BOUTON} onClick={onFermer} disabled={envoi}>
            Annuler
          </button>
          <button
            type="button"
            className={buttonClasses('primary', 'md')}
            disabled={envoi}
            onClick={() => void creer()}
          >
            {envoi ? 'Création…' : 'Créer la commande'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {erreur ? (
          <Alerte
            action={
              existante ? (
                <button
                  type="button"
                  className={BOUTON}
                  onClick={() => router.push(`${COMMANDES_BASE}/${encodeURIComponent(existante)}`)}
                >
                  Ouvrir la commande existante
                </button>
              ) : undefined
            }
          >
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        {quote.conversion?.alive ? (
          <p className="text-sm">
            Ce devis a déjà été converti en facture : la commande reste possible, mais vérifiez de
            ne pas facturer deux fois.
          </p>
        ) : null}
        <FormGrid>
          <Field id={`${id}-date`} label="Date de la commande" optional size="sm">
            <DatePicker value={date} onChange={setDate} shortcuts={['today']} />
          </Field>
          <Field id={`${id}-ref`} label="Référence du bon de commande du client" optional size="md">
            <TextInput
              value={reference}
              maxLength={60}
              onChange={(e) => setReference(e.target.value)}
              className="font-mono"
            />
          </Field>
          <Field id={`${id}-livraison`} label="Livraison souhaitée" optional size="sm">
            <DatePicker
              value={livraison}
              onChange={setLivraison}
              shortcuts={['plus7', 'plus30', 'endOfMonth']}
            />
          </Field>
        </FormGrid>
      </div>
    </Modal>
  );
}

function FenetreVersContrat({
  quote,
  onFermer,
}: {
  quote: QuoteView;
  onFermer: () => void;
}): React.ReactElement {
  const router = useRouter();
  const id = useId();
  const [titre, setTitre] = useState(quote.title ?? '');
  const [clauses, setClauses] = useState<FormulaireClauses>(() =>
    clausesVides(aujourdhuiKinshasa()),
  );
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function creer(): Promise<void> {
    const champs: Record<string, string> = {};
    if (titre.length > 200) champs['title'] = '200 caractères au plus.';
    const cl = preparerClauses(clauses, quote.lineInputs);
    if (!cl.ok) Object.assign(champs, cl.champs);
    if (!cl.ok || Object.keys(champs).length > 0) {
      setErreurs(champs);
      return;
    }
    setErreurs({});
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await salesContractsApi.quoteToContract(quote.id, {
        ...(titre.trim() === '' ? {} : { title: titre.trim() }),
        ...cl.corps,
      });
      router.push(`${CONTRATS_BASE}/${encodeURIComponent(r.contract.id)}`);
    } catch (err) {
      setErreurs(champsRefusesEngagement(err));
      setErreur(messageEngagement(err, 'Le contrat n’a pas pu être créé.'));
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title={`Créer le contrat — devis ${quote.number}`}
      description="Le contrat reprend le client, les lignes et les prix du devis. Saisissez ses dates et ses clauses ; il naît en brouillon."
      size="xl"
      busy={envoi}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={BOUTON} onClick={onFermer} disabled={envoi}>
            Annuler
          </button>
          <button
            type="button"
            className={buttonClasses('primary', 'md')}
            disabled={envoi}
            onClick={() => void creer()}
          >
            {envoi ? 'Création…' : 'Créer le contrat'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <FormGrid>
          <Field
            id={`${id}-titre`}
            label="Titre du contrat"
            optional
            size="lg"
            hint="Vide : l’objet du devis, ou « Contrat — devis DV… »."
            error={erreurs['title']}
          >
            <TextInput value={titre} maxLength={200} onChange={(e) => setTitre(e.target.value)} />
          </Field>
        </FormGrid>
        <ChampsClauses
          prefixe={`${id}-cl`}
          f={clauses}
          setF={setClauses}
          erreurs={erreurs}
          desactive={envoi}
          lignesContrat={quote.lineInputs}
          nomsLignes={quote.lines.map((l) => l.name)}
        />
      </div>
    </Modal>
  );
}
