'use client';

// Fenêtre de confirmation avec motif (annulation, litige, forçage) ou sans saisie.
// Le motif obligatoire est vérifié ici ; l'API le revérifie et reste juge.

import { Modal, buttonClasses } from '@lalanda/ui';
import { useId, useState } from 'react';

import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';

import { messageAchats } from './achats-model';

export function DialogueMotif({
  titre,
  description,
  libelle,
  bouton,
  motif,
  children,
  onFermer,
  onValider,
}: {
  titre: string;
  description?: string;
  /** Libellé du champ de motif. */
  libelle: string;
  bouton: string;
  /** `obligatoire` : motif requis ; `aucun` : simple confirmation. */
  motif: 'obligatoire' | 'aucun';
  children?: React.ReactNode;
  onFermer: () => void;
  /** Rejette en cas de refus de l'API : l'erreur s'affiche dans la fenêtre. */
  onValider: (motif: string) => Promise<void>;
}): React.ReactElement {
  const id = useId();
  const [texte, setTexte] = useState('');
  const [champ, setChamp] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function valider(): Promise<void> {
    const t = texte.trim();
    if (motif === 'obligatoire' && t === '') {
      setChamp('Le motif est obligatoire.');
      return;
    }
    setChamp(undefined);
    setErreur(null);
    setEnvoi(true);
    try {
      await onValider(t);
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
      description={description}
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
        {children}
        {motif === 'obligatoire' ? (
          <Champ id={`${id}-motif`} label={libelle} requis erreur={champ}>
            <textarea
              id={`${id}-motif`}
              rows={3}
              className={CHAMP}
              value={texte}
              maxLength={1000}
              onChange={(e) => setTexte(e.target.value)}
              {...aria(`${id}-motif`, champ)}
            />
          </Champ>
        ) : null}
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
      </div>
    </Modal>
  );
}
