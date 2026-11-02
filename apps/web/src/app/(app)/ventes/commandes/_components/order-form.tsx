'use client';

// Fenêtre de saisie d'une commande client (création, ou modification du brouillon) —
// ADR-0050 § 2.2, lot V7. Chaque « + » ouvre une fenêtre modale.

import { Modal, buttonClasses } from '@lalanda/ui';
import { useId, useState } from 'react';

import { salesContractsApi, type SalesOrderView } from '@/lib/api-sales-contracts';

import { Alerte, BOUTON, CHAMP, Champ, aria } from '../../_components/form-ui';
import type { FormulaireDocument } from '../../factures/_components/invoice-model';
import { ChampsDocument } from '../../contrats/_components/engagement-document-fields';
import {
  aujourdhuiKinshasa,
  champsRefusesEngagement,
  formulaireDepuisEngagement,
  formulaireEngagementVide,
  messageEngagement,
} from '../../contrats/_components/contract-model';

import { metaVide, preparerCommande, type MetaCommande } from './order-model';

export function FenetreCommande({
  vue,
  onFermer,
  onEnregistre,
}: {
  /** `null` : nouvelle commande. */
  vue: SalesOrderView | null;
  onFermer: () => void;
  onEnregistre: (v: SalesOrderView) => void;
}): React.ReactElement {
  const id = useId();
  const [form, setForm] = useState<FormulaireDocument>(() =>
    vue ? formulaireDepuisEngagement(vue) : formulaireEngagementVide(),
  );
  const [meta, setMeta] = useState<MetaCommande>(() =>
    vue
      ? {
          orderedOn: vue.orderedOn,
          customerReference: vue.customerReference ?? '',
          requestedDeliveryDate: vue.requestedDeliveryDate ?? '',
          notes: vue.notes ?? '',
          opportunityId: vue.opportunityId,
        }
      : metaVide(aujourdhuiKinshasa()),
  );
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function enregistrer(): Promise<void> {
    setErreur(null);
    const prep = preparerCommande(form, meta);
    if (!prep.ok) {
      setErreurs(prep.champs);
      return;
    }
    setErreurs({});
    setEnvoi(true);
    try {
      const v = vue
        ? await salesContractsApi.updateOrder(vue.id, {
            ...prep.corps,
            expectedRevision: vue.revision,
          })
        : await salesContractsApi.createOrder(prep.corps);
      onEnregistre(v);
    } catch (err) {
      setErreurs(champsRefusesEngagement(err));
      setErreur(messageEngagement(err, 'Enregistrement impossible.'));
      setEnvoi(false);
    }
  }

  const champ =
    (k: keyof MetaCommande) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setMeta((m) => ({ ...m, [k]: e.target.value }));

  return (
    <Modal
      open
      onClose={onFermer}
      title={vue ? `Modifier la commande ${vue.number}` : 'Nouvelle commande client'}
      description="Les lignes et les prix sont figés à la confirmation. Le total est calculé par Lalanda à l’enregistrement."
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
            onClick={() => void enregistrer()}
          >
            {envoi ? 'Enregistrement…' : vue ? 'Enregistrer le brouillon' : 'Créer la commande'}
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
        <div className="grid gap-4 sm:grid-cols-3">
          <Champ id={`${id}-date`} label="Date de la commande" requis erreur={erreurs['orderedOn']}>
            <input
              id={`${id}-date`}
              type="date"
              value={meta.orderedOn}
              onChange={champ('orderedOn')}
              className={CHAMP}
              {...aria(`${id}-date`, erreurs['orderedOn'])}
            />
          </Champ>
          <Champ
            id={`${id}-ref`}
            label="Référence du bon de commande du client"
            erreur={erreurs['customerReference']}
          >
            <input
              id={`${id}-ref`}
              value={meta.customerReference}
              maxLength={60}
              onChange={champ('customerReference')}
              className={CHAMP}
              {...aria(`${id}-ref`, erreurs['customerReference'])}
            />
          </Champ>
          <Champ
            id={`${id}-livraison`}
            label="Livraison souhaitée"
            erreur={erreurs['requestedDeliveryDate']}
          >
            <input
              id={`${id}-livraison`}
              type="date"
              value={meta.requestedDeliveryDate}
              onChange={champ('requestedDeliveryDate')}
              className={CHAMP}
            />
          </Champ>
        </div>
        <ChampsDocument
          prefixe={`${id}-doc`}
          form={form}
          setForm={setForm}
          vue={vue}
          erreurs={erreurs}
          desactive={envoi}
          aJour={vue !== null}
        />
        <Champ id={`${id}-notes`} label="Notes" erreur={erreurs['notes']}>
          <textarea
            id={`${id}-notes`}
            value={meta.notes}
            rows={3}
            maxLength={1000}
            onChange={champ('notes')}
            className={CHAMP}
          />
        </Champ>
      </div>
    </Modal>
  );
}
