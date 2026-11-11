'use client';

// Fenêtre de saisie d'une commande client (création, ou modification du brouillon) —
// ADR-0050 § 2.2, lot V7. Chaque « + » ouvre une fenêtre modale.
//
// ADR-0074 : dates en `DatePicker`, référence et notes en champs de
// `@lalanda/ui`, largeurs sémantiques. Mêmes champs envoyés (`preparerCommande`).

import { Button, DatePicker, Field, FormGrid, Modal, TextArea, TextInput } from '@lalanda/ui';
import { useId, useState } from 'react';

import { salesContractsApi, type SalesOrderView } from '@/lib/api-sales-contracts';

import { Alerte } from '../../_components/form-ui';
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

  const majMeta = (k: keyof MetaCommande, v: string): void => setMeta((m) => ({ ...m, [k]: v }));

  return (
    <Modal
      open
      onClose={onFermer}
      title={vue ? `Modifier la commande ${vue.number}` : 'Nouvelle commande client'}
      description="Les lignes et les prix sont figés à la confirmation. Le total est calculé par Lalanda à l’enregistrement."
      size="xl"
      busy={envoi}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={onFermer} disabled={envoi} className="max-sm:h-11">
            Annuler
          </Button>
          <Button
            variant="primary"
            busy={envoi}
            onClick={() => void enregistrer()}
            className="max-sm:h-11"
          >
            {envoi ? 'Enregistrement…' : vue ? 'Enregistrer le brouillon' : 'Créer la commande'}
          </Button>
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
            id={`${id}-date`}
            label="Date de la commande"
            required
            size="sm"
            error={erreurs['orderedOn']}
          >
            <DatePicker
              value={meta.orderedOn}
              onChange={(v) => majMeta('orderedOn', v)}
              shortcuts={['today']}
            />
          </Field>
          <Field
            id={`${id}-ref`}
            label="Référence du bon de commande du client"
            optional
            size="md"
            error={erreurs['customerReference']}
          >
            <TextInput
              value={meta.customerReference}
              maxLength={60}
              onChange={(e) => majMeta('customerReference', e.target.value)}
              className="font-mono"
            />
          </Field>
          <Field
            id={`${id}-livraison`}
            label="Livraison souhaitée"
            optional
            size="sm"
            error={erreurs['requestedDeliveryDate']}
          >
            <DatePicker
              value={meta.requestedDeliveryDate}
              onChange={(v) => majMeta('requestedDeliveryDate', v)}
              shortcuts={['plus7', 'plus30', 'endOfMonth']}
            />
          </Field>
        </FormGrid>
        <ChampsDocument
          prefixe={`${id}-doc`}
          form={form}
          setForm={setForm}
          vue={vue}
          erreurs={erreurs}
          desactive={envoi}
          aJour={vue !== null}
        />
        <FormGrid>
          <Field id={`${id}-notes`} label="Notes" optional size="full" error={erreurs['notes']}>
            <TextArea
              value={meta.notes}
              rows={3}
              maxLength={1000}
              onChange={(e) => majMeta('notes', e.target.value)}
            />
          </Field>
        </FormGrid>
      </div>
    </Modal>
  );
}
