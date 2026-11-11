'use client';

// Fenêtre de confirmation avec motif (stocks : annulation d'un bon ou d'un inventaire,
// ligne à traiter classée), reprise des achats avec les messages des stocks.
// Le motif obligatoire est vérifié ici ; l'API le revérifie et reste juge.

import { Button, Field, Modal, TextArea } from '@lalanda/ui';
import { useId, useState } from 'react';

import { Alerte } from '../../ventes/_components/form-ui';

import { messageStocks } from './stocks-model';

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
      setErreur(messageStocks(err, 'Action impossible.'));
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
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button size="sm" onClick={onFermer} disabled={envoi} className="max-sm:h-11">
            Retour
          </Button>
          <Button
            size="sm"
            variant="primary"
            busy={envoi}
            className="max-sm:h-11"
            onClick={() => void valider()}
          >
            {envoi ? 'Envoi…' : bouton}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {children}
        {motif === 'obligatoire' ? (
          <Field id={`${id}-motif`} label={libelle} required size="full" error={champ}>
            <TextArea
              rows={3}
              value={texte}
              maxLength={1000}
              autoFocus
              onChange={(e) => setTexte(e.target.value)}
            />
          </Field>
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
