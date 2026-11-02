'use client';

// Fenêtre de saisie d'un contrat (création, ou modification du brouillon) — ADR-0050
// § 2.3, lot V7. Document de vente (client, lignes) + clauses SAISIES + échéancier.

import { Modal, buttonClasses } from '@lalanda/ui';
import { useId, useMemo, useState } from 'react';

import {
  salesContractsApi,
  type SalesContractBody,
  type SalesContractView,
} from '@/lib/api-sales-contracts';

import { Alerte, BOUTON, CHAMP, Champ, aria } from '../../_components/form-ui';
import {
  preparerDocument,
  type FormulaireDocument,
} from '../../factures/_components/invoice-model';

import { ChampsClauses } from './clauses-fields';
import { ChampsDocument } from './engagement-document-fields';
import {
  aujourdhuiKinshasa,
  champsRefusesEngagement,
  clausesDepuisVue,
  clausesVides,
  formulaireDepuisEngagement,
  formulaireEngagementVide,
  messageEngagement,
  preparerClauses,
  type FormulaireClauses,
} from './contract-model';

/** Lignes au corps du brouillon (pour l'échéancier) et leurs désignations. */
export function lignesDuFormulaire(
  form: FormulaireDocument,
  repli: SalesContractView['lineInputs'],
): { lignes: SalesContractView['lineInputs']; noms: string[] } {
  const doc = preparerDocument({ ...form, type: 'FV', paiements: [], nature: null });
  const lignes = doc.ok ? [...doc.corps.lines] : repli;
  const noms = form.lignes.map((l, i) =>
    l.source === 'free' ? l.name || `Ligne ${i + 1}` : l.apercu || `Ligne ${i + 1}`,
  );
  return { lignes, noms };
}

export function FenetreContrat({
  vue,
  onFermer,
  onEnregistre,
}: {
  /** `null` : nouveau contrat. */
  vue: SalesContractView | null;
  onFermer: () => void;
  onEnregistre: (v: SalesContractView) => void;
}): React.ReactElement {
  const id = useId();
  const [titre, setTitre] = useState(vue?.title ?? '');
  const [form, setForm] = useState<FormulaireDocument>(() =>
    vue ? formulaireDepuisEngagement(vue) : formulaireEngagementVide(),
  );
  const [clauses, setClauses] = useState<FormulaireClauses>(() =>
    vue ? clausesDepuisVue(vue) : clausesVides(aujourdhuiKinshasa()),
  );
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const { lignes, noms } = useMemo(
    () => lignesDuFormulaire(form, vue?.lineInputs ?? []),
    [form, vue],
  );

  async function enregistrer(): Promise<void> {
    setErreur(null);
    const doc = preparerDocument({ ...form, type: 'FV', paiements: [], nature: null });
    const champs: Record<string, string> = doc.ok ? {} : { ...doc.champs };
    if (form.client === null || form.client.mode !== 'fiche') {
      champs['customer'] = 'Choisissez un client enregistré.';
    }
    if (titre.trim() === '') champs['title'] = 'Titre obligatoire.';
    if (titre.length > 200) champs['title'] = '200 caractères au plus.';
    const cl = preparerClauses(clauses, doc.ok ? doc.corps.lines : []);
    if (!cl.ok) Object.assign(champs, cl.champs);
    if (!doc.ok || !cl.ok || Object.keys(champs).length > 0) {
      setErreurs(champs);
      return;
    }
    setErreurs({});
    const corps: SalesContractBody = {
      title: titre.trim(),
      opportunityId: vue?.opportunityId ?? null,
      ownerUserId: vue?.ownerUserId ?? null,
      currency: doc.corps.currency,
      priceMode: doc.corps.priceMode,
      customer: doc.corps.customer,
      lines: doc.corps.lines,
      ...cl.corps,
    };
    setEnvoi(true);
    try {
      const v = vue
        ? await salesContractsApi.updateContract(vue.id, {
            ...corps,
            expectedRevision: vue.revision,
          })
        : await salesContractsApi.createContract(corps);
      onEnregistre(v);
    } catch (err) {
      setErreurs(champsRefusesEngagement(err));
      setErreur(messageEngagement(err, 'Enregistrement impossible.'));
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title={vue ? `Modifier le contrat ${vue.number} (version ${vue.version})` : 'Nouveau contrat'}
      description="Le contrat est rédigé hors de Lalanda : saisissez ici ses lignes, ses dates et ses clauses ; la copie signée se téléverse ensuite."
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
            {envoi ? 'Enregistrement…' : vue ? 'Enregistrer le brouillon' : 'Créer le contrat'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <Champ id={`${id}-titre`} label="Titre du contrat" requis erreur={erreurs['title']}>
          <input
            id={`${id}-titre`}
            value={titre}
            maxLength={200}
            onChange={(e) => setTitre(e.target.value)}
            className={CHAMP}
            {...aria(`${id}-titre`, erreurs['title'])}
          />
        </Champ>
        <ChampsDocument
          prefixe={`${id}-doc`}
          form={form}
          setForm={setForm}
          vue={vue}
          erreurs={erreurs}
          desactive={envoi}
          aJour={vue !== null}
        />
        <ChampsClauses
          prefixe={`${id}-cl`}
          f={clauses}
          setF={setClauses}
          erreurs={erreurs}
          desactive={envoi}
          lignesContrat={lignes}
          nomsLignes={noms}
        />
      </div>
    </Modal>
  );
}
