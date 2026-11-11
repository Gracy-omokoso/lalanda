'use client';

// Réglages des contrats (§ 2.1) en fenêtre modale : délais d'alerte, préparation
// automatique des brouillons d'échéance, approbateur unique. Lecture `sales.read`,
// écriture `sales.contract.approve`. ADR-0050 — V7.
//
// ADR-0074 : délais à la largeur d'un nombre de jours, réglages en interrupteurs.

import { SALES_CONTRACT_LIMITS as L } from '@lalanda/shared/sales-contracts';
import { Field, FormGrid, Modal, Switch, TextInput, buttonClasses } from '@lalanda/ui';
import { useEffect, useId, useState } from 'react';

import { salesContractsApi, type SalesContractSettingsView } from '@/lib/api-sales-contracts';

import { Alerte, BOUTON } from '../../_components/form-ui';

import { messageEngagement } from './contract-model';

function lireJours(s: string, max: number): number | null {
  if (!/^\d{1,3}$/.test(s.trim())) return null;
  const n = Number.parseInt(s.trim(), 10);
  return n <= max ? n : null;
}

export function FenetreReglages({ onFermer }: { onFermer: () => void }): React.ReactElement {
  const id = useId();
  const [vue, setVue] = useState<SalesContractSettingsView | null>(null);
  const [preavis, setPreavis] = useState('');
  const [fin, setFin] = useState('');
  const [avance, setAvance] = useState('');
  const [auto, setAuto] = useState(true);
  const [unique, setUnique] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    salesContractsApi
      .getSettings()
      .then((v) => {
        setVue(v);
        setPreavis(String(v.noticeAlertDays));
        setFin(String(v.termEndAlertDays));
        setAvance(String(v.subscriptionLeadDays));
        setAuto(v.autoPrepareSubscriptionDrafts);
        setUnique(v.allowSoleApprover);
      })
      .catch((err: unknown) => setErreur(messageEngagement(err, 'Réglages illisibles.')));
  }, []);

  async function enregistrer(): Promise<void> {
    if (!vue) return;
    const p = lireJours(preavis, L.alertDaysMax);
    const f = lireJours(fin, L.alertDaysMax);
    const a = lireJours(avance, L.subscriptionLeadDaysMax);
    const c: Record<string, string> = {};
    if (p === null) c['preavis'] = `De 0 à ${L.alertDaysMax} jours.`;
    if (f === null) c['fin'] = `De 0 à ${L.alertDaysMax} jours.`;
    if (a === null) c['avance'] = `De 0 à ${L.subscriptionLeadDaysMax} jours.`;
    setChamps(c);
    if (p === null || f === null || a === null) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await salesContractsApi.putSettings({
        expectedRevision: vue.revision,
        noticeAlertDays: p,
        termEndAlertDays: f,
        subscriptionLeadDays: a,
        autoPrepareSubscriptionDrafts: auto,
        allowSoleApprover: unique,
      });
      onFermer();
    } catch (err) {
      setErreur(messageEngagement(err, 'Enregistrement impossible.'));
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title="Réglages des contrats"
      busy={envoi}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={BOUTON} onClick={onFermer} disabled={envoi}>
            Annuler
          </button>
          <button
            type="button"
            className={buttonClasses('primary', 'md')}
            disabled={envoi || vue === null}
            onClick={() => void enregistrer()}
          >
            Enregistrer
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <FormGrid>
          {(
            [
              ['preavis', 'Alerte de préavis', 'Jours avant la date limite.', preavis, setPreavis],
              ['fin', 'Alerte de fin de terme', 'Jours avant la fin.', fin, setFin],
              [
                'avance',
                'Préparer les brouillons d’échéance',
                'Nombre de jours à l’avance.',
                avance,
                setAvance,
              ],
            ] as const
          ).map(([cle, label, aide, valeur, poser]) => (
            <Field
              key={cle}
              id={`${id}-${cle}`}
              label={label}
              hint={aide}
              size="sm"
              error={champs[cle]}
            >
              <TextInput
                inputMode="numeric"
                value={valeur}
                onChange={(e) => poser(e.target.value)}
                trailing="jours"
                className="text-right tabular-nums"
              />
            </Field>
          ))}
        </FormGrid>
        <Switch
          checked={auto}
          onChange={setAuto}
          label="Préparer automatiquement les brouillons d’échéance (jamais émis seuls)"
        />
        <Switch
          checked={unique}
          onChange={setUnique}
          label="Si une seule personne peut approuver, elle approuve aussi ce qu’elle a préparé"
        />
      </div>
    </Modal>
  );
}
