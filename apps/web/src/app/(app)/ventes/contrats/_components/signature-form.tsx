'use client';

// « Déclarer la signature » d'un contrat ou d'un avenant — ADR-0050 § 2.3, lot V7.
// La signature électronique est hors périmètre (décision ouverte n° 6) : on téléverse la
// copie signée (PDF), puis on déclare la date et les signataires.

import {
  DatePicker,
  Field,
  FormGrid,
  Modal,
  Select,
  SegmentedControl,
  TextInput,
  buttonClasses,
} from '@lalanda/ui';
import { useId, useState } from 'react';

import {
  salesContractsApi,
  type SalesContractFileView,
  type SignatureBody,
} from '@/lib/api-sales-contracts';

import { Alerte, BOUTON, BOUTON_PETIT } from '../../_components/form-ui';
import { formatJour } from '../../devis/_components/quote-model';

import {
  COTE_LABELS,
  aujourdhuiKinshasa,
  messageEngagement,
  preparerSignature,
  signataireVide,
  signatairesVides,
  type SignataireFormulaire,
} from './contract-model';

export function FenetreSignature({
  titre,
  contractId,
  amendmentId,
  expectedRevision,
  copiesExistantes,
  declarer,
  onFermer,
  onFait,
}: {
  titre: string;
  contractId: string;
  amendmentId: string | null;
  expectedRevision: number;
  /** Copies signées déjà déposées pour ce document (ajout seul : rien n'est remplacé). */
  copiesExistantes: readonly SalesContractFileView[];
  declarer: (corps: SignatureBody) => Promise<void>;
  onFermer: () => void;
  onFait: () => void;
}): React.ReactElement {
  const id = useId();
  const [date, setDate] = useState(aujourdhuiKinshasa());
  const [signataires, setSignataires] = useState<SignataireFormulaire[]>(signatairesVides);
  const [copie, setCopie] = useState<string>(
    copiesExistantes[copiesExistantes.length - 1]?.id ?? '',
  );
  const [fichier, setFichier] = useState<File | null>(null);
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const maj = (cle: string, patch: Partial<SignataireFormulaire>): void =>
    setSignataires((s) => s.map((x) => (x.cle === cle ? { ...x, ...patch } : x)));

  async function confirmer(): Promise<void> {
    const prep = preparerSignature({
      expectedRevision,
      date,
      signataires,
      fichierChoisi: fichier !== null || copie !== '',
    });
    if (!prep.ok) {
      setChamps(prep.champs);
      return;
    }
    setChamps({});
    setEnvoi(true);
    setErreur(null);
    try {
      const fileId = fichier
        ? (await salesContractsApi.addContractFile(contractId, fichier, 'signed_copy', amendmentId))
            .id
        : copie;
      await declarer({ ...prep.corps, fileId });
      onFait();
    } catch (err) {
      setErreur(messageEngagement(err, 'La signature n’a pas pu être déclarée.'));
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title={titre}
      description="La signature électronique n’est pas proposée : téléversez la copie signée (PDF) et indiquez qui a signé. Après la déclaration, le contenu ne se modifie plus."
      size="lg"
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
            onClick={() => void confirmer()}
          >
            {envoi ? 'Déclaration…' : 'Déclarer la signature'}
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
          <Field
            id={`${id}-date`}
            label="Date de signature"
            required
            size="sm"
            error={champs['signedOn']}
          >
            <DatePicker value={date} onChange={setDate} shortcuts={['today']} />
          </Field>
        </FormGrid>
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">Copie signée (PDF, 10 Mo au plus)</legend>
          {copiesExistantes.length > 0 ? (
            <FormGrid>
              <Field id={`${id}-copie`} label="Copie signée déjà déposée" size="lg">
                <Select<string>
                  value={fichier ? '' : copie}
                  onChange={(v) => {
                    setCopie(v);
                    setFichier(null);
                  }}
                  options={[
                    { value: '', label: 'Déposer une nouvelle copie…' },
                    ...copiesExistantes.map((c) => ({
                      value: c.id,
                      label: c.fileName,
                      description: `Déposée le ${formatJour(c.uploadedAt.slice(0, 10))}`,
                    })),
                  ]}
                />
              </Field>
            </FormGrid>
          ) : null}
          {copie === '' || copiesExistantes.length === 0 ? (
            <input
              type="file"
              accept="application/pdf,.pdf"
              aria-label="Fichier PDF de la copie signée"
              onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
              className="text-sm file:mr-3 file:rounded-[var(--radius-sm)] file:border file:border-[var(--border-strong)] file:bg-[var(--surface)] file:px-3 file:py-1.5 file:text-sm file:font-medium"
            />
          ) : null}
          {champs['file'] ? (
            <p className="text-xs font-medium text-[var(--danger)]">{champs['file']}</p>
          ) : null}
        </fieldset>
        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold">Signataires</legend>
          {champs['signatories'] ? (
            <p className="text-xs font-medium text-[var(--danger)]">{champs['signatories']}</p>
          ) : null}
          {signataires.map((s, i) => (
            <div
              key={s.cle}
              className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3"
            >
              <FormGrid>
                <Field id={`${id}-sig-${i}-nom`} label="Nom du signataire" size="md">
                  <TextInput
                    value={s.nom}
                    maxLength={120}
                    onChange={(e) => maj(s.cle, { nom: e.target.value })}
                  />
                </Field>
                <Field id={`${id}-sig-${i}-fonction`} label="Fonction" optional size="md">
                  <TextInput
                    value={s.fonction}
                    maxLength={120}
                    onChange={(e) => maj(s.cle, { fonction: e.target.value })}
                  />
                </Field>
                <Field id={`${id}-sig-${i}-cote`} label="Côté" group size="md">
                  <SegmentedControl<SignataireFormulaire['cote']>
                    value={s.cote}
                    onChange={(v) => maj(s.cle, { cote: v })}
                    options={[
                      { value: 'customer', label: COTE_LABELS.customer },
                      { value: 'organization', label: COTE_LABELS.organization },
                    ]}
                  />
                </Field>
              </FormGrid>
              <button
                type="button"
                className={`${BOUTON_PETIT} self-end max-sm:h-11`}
                aria-label={`Retirer le signataire ${i + 1}`}
                onClick={() => setSignataires((x) => x.filter((y) => y.cle !== s.cle))}
              >
                Retirer
              </button>
            </div>
          ))}
          <button
            type="button"
            className={`${BOUTON_PETIT} self-start max-sm:h-11`}
            onClick={() => setSignataires((x) => [...x, signataireVide('customer')])}
          >
            + Signataire
          </button>
        </fieldset>
      </div>
    </Modal>
  );
}
