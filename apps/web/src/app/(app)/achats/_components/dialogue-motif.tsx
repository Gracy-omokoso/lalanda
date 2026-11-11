'use client';

// Fenêtre de confirmation avec motif (annulation, litige, forçage) ou sans saisie.
// Le motif obligatoire est vérifié ici ; l'API le revérifie et reste juge.
// ADR-0074 : `Field` + `TextArea`, boutons `Button` avec état d'envoi.

import { Button, Field, Modal, TextArea } from '@lalanda/ui';
import { useId, useState } from 'react';

import { Alerte } from '../../ventes/_components/form-ui';

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
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button onClick={onFermer} disabled={envoi} className="max-sm:h-11">
            Retour
          </Button>
          <Button
            variant="primary"
            busy={envoi}
            onClick={() => void valider()}
            className="max-sm:h-11"
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
              onChange={(e) => {
                setTexte(e.target.value);
                if (champ && e.target.value.trim() !== '') setChamp(undefined);
              }}
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
