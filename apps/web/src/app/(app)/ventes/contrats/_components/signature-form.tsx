'use client';

// « Déclarer la signature » d'un contrat ou d'un avenant — ADR-0050 § 2.3, lot V7.
// La signature électronique est hors périmètre (décision ouverte n° 6) : on téléverse la
// copie signée (PDF), puis on déclare la date et les signataires.

import { Modal, buttonClasses } from '@lalanda/ui';
import { useId, useState } from 'react';

import {
  salesContractsApi,
  type SalesContractFileView,
  type SignatureBody,
} from '@/lib/api-sales-contracts';

import { Alerte, BOUTON, BOUTON_PETIT, CHAMP, Champ, aria } from '../../_components/form-ui';
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
        <Champ id={`${id}-date`} label="Date de signature" requis erreur={champs['signedOn']}>
          <input
            id={`${id}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={CHAMP}
            {...aria(`${id}-date`, champs['signedOn'])}
          />
        </Champ>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">Copie signée (PDF, 10 Mo au plus)</legend>
          {copiesExistantes.length > 0 ? (
            <select
              aria-label="Copie signée déjà déposée"
              value={fichier ? '' : copie}
              onChange={(e) => {
                setCopie(e.target.value);
                setFichier(null);
              }}
              className={CHAMP}
            >
              <option value="">Déposer une nouvelle copie…</option>
              {copiesExistantes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fileName} — déposée le {formatJour(c.uploadedAt.slice(0, 10))}
                </option>
              ))}
            </select>
          ) : null}
          {copie === '' || copiesExistantes.length === 0 ? (
            <input
              type="file"
              accept="application/pdf,.pdf"
              aria-label="Fichier PDF de la copie signée"
              onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
          ) : null}
          {champs['file'] ? (
            <p className="text-xs font-medium text-[var(--danger)]">{champs['file']}</p>
          ) : null}
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold">Signataires</legend>
          {champs['signatories'] ? (
            <p className="text-xs font-medium text-[var(--danger)]">{champs['signatories']}</p>
          ) : null}
          {signataires.map((s) => (
            <div key={s.cle} className="grid gap-2 sm:grid-cols-[1fr_1fr_12rem_auto]">
              <input
                aria-label="Nom du signataire"
                placeholder="Nom"
                value={s.nom}
                maxLength={120}
                onChange={(e) => maj(s.cle, { nom: e.target.value })}
                className={CHAMP}
              />
              <input
                aria-label="Fonction du signataire"
                placeholder="Fonction (facultatif)"
                value={s.fonction}
                maxLength={120}
                onChange={(e) => maj(s.cle, { fonction: e.target.value })}
                className={CHAMP}
              />
              <select
                aria-label="Côté du signataire"
                value={s.cote}
                onChange={(e) =>
                  maj(s.cle, { cote: e.target.value as SignataireFormulaire['cote'] })
                }
                className={CHAMP}
              >
                <option value="customer">{COTE_LABELS.customer}</option>
                <option value="organization">{COTE_LABELS.organization}</option>
              </select>
              <button
                type="button"
                className={BOUTON_PETIT}
                onClick={() => setSignataires((x) => x.filter((y) => y.cle !== s.cle))}
              >
                Retirer
              </button>
            </div>
          ))}
          <button
            type="button"
            className={`${BOUTON_PETIT} self-start`}
            onClick={() => setSignataires((x) => [...x, signataireVide('customer')])}
          >
            + Signataire
          </button>
        </fieldset>
      </div>
    </Modal>
  );
}
