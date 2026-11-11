'use client';

// « Déclarer non normalisée » (ADR-0024 § 4.4 et § 9.1).
//
// Seulement depuis « Vérification nécessaire », et seulement quand l'API ouvre
// le bouton (`actions.declareNotNormalized` : permission `fiscal.manage`). La
// déclaration exige une ré-authentification récente : sur `401
// REAUTH_REQUIRED`, la boîte de l'onglet Fiscalité demande le mot de passe et
// la requête est rejouée UNE fois (`avecReauth`) — c'est une déclaration
// humaine, pas un envoi à la DGI : la rejouer ne peut rien dupliquer.
//
// Personne ne saisit d'éléments de sécurité : si la facture a été normalisée,
// la revérification automatique finira par le voir.
//
// ADR-0074 : motif en `Field` + `TextArea` (aide, compteur et erreur reliés).
// Même lecture du motif (`lireMotifDeclaration`), même requête.

import { Field, FormGrid, TextArea } from '@lalanda/ui';
import { useState } from 'react';

import { api, type InvoiceView } from '@/lib/api';

import { avecReauth } from '../../../organisation/_components/fiscal-model';
import { useReauthDialog } from '../../../organisation/_components/reauth-dialog';
import { Alerte, BOUTON } from '../../_components/form-ui';

import { Dialogue } from './dialog-ui';
import { lireMotifDeclaration, messageFacture, MOTIF_MAX, MOTIF_MIN } from './invoice-model';

export function DeclareNotNormalizedDialog({
  vue,
  onFermer,
  onDeclare,
}: {
  vue: InvoiceView;
  onFermer: () => void;
  onDeclare: (v: InvoiceView) => void;
}): React.ReactElement {
  const reauth = useReauthDialog();
  const [motif, setMotif] = useState('');
  const [champ, setChamp] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function declarer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const lu = lireMotifDeclaration(motif);
    if (!lu.ok) {
      setChamp(lu.erreur);
      return;
    }
    setChamp(null);
    setEnvoi(true);
    setErreur(null);
    try {
      const v = await avecReauth(
        () => api.declareNotNormalized(vue.id, lu.motif),
        (mode) => reauth.demander(mode),
      );
      onDeclare(v);
    } catch (err) {
      setErreur(messageFacture(err, 'Déclaration impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Dialogue titre="Déclarer la facture non normalisée" onFermer={onFermer}>
      {vue.environment === 'test' ? (
        <p className="rounded-md border border-[var(--warn)]/50 px-3 py-2 text-sm font-medium">
          Mode test — environnement de test de la DGI.
        </p>
      ) : null}
      <div className="flex flex-col gap-2 text-sm">
        <p>
          Ne déclarez la facture non normalisée que s’il est <strong>établi</strong>, auprès de la
          DGI (site de vérification ou assistance), qu’elle ne l’a pas été.
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            Le document repassera en « Normalisation refusée » : vous pourrez relancer sa
            normalisation.
          </li>
          <li>
            Si d’autres factures ont été numérotées entre-temps, son numéro réservé ne pourra pas
            être réutilisé : il restera un trou dans la série, tracé dans le journal avec votre
            motif.
          </li>
          <li>Votre déclaration est enregistrée à votre nom dans le journal d’audit.</li>
        </ul>
        {vue.normalization?.dgiRequestId ? (
          <p className="text-xs text-[var(--foreground-muted)]">
            Identifiant de la demande à donner à la DGI :{' '}
            <span className="break-all font-mono">{vue.normalization.dgiRequestId}</span>
          </p>
        ) : null}
      </div>

      <form onSubmit={(e) => void declarer(e)} className="flex flex-col gap-3">
        <FormGrid>
          <Field
            id="declarer-motif"
            label={`Motif (${MOTIF_MIN} à ${MOTIF_MAX} caractères)`}
            required
            size="full"
            error={champ}
            hint={
              <>
                Par exemple : qui vous avez contacté à la DGI, quand, et ce qu’elle a répondu.{' '}
                {motif.trim().length}/{MOTIF_MAX}
              </>
            }
          >
            <TextArea
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              rows={4}
              maxLength={MOTIF_MAX}
            />
          </Field>
        </FormGrid>

        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={BOUTON} onClick={onFermer} disabled={envoi}>
            Annuler
          </button>
          <button
            type="submit"
            className={`${BOUTON} border-[var(--danger)] font-semibold`}
            disabled={envoi}
          >
            {envoi ? 'Déclaration…' : 'Déclarer non normalisée'}
          </button>
        </div>
      </form>
      {reauth.element}
    </Dialogue>
  );
}
