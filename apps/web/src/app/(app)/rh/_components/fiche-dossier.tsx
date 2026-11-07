'use client';

// Onglet « Dossier » (ADR-0045 § 2.1) : données NON sensibles, modification en
// fenêtre modale (`hr.manage`). Les notes sont rappelées non sensibles.

import { Modal, buttonClasses } from '@lalanda/ui';
import { FileText, NotebookPen } from 'lucide-react';
import { useState } from 'react';

import { EntityAssetsPanel } from '@/components/entity-assets-panel';

import { lignesDossier } from './collaborateurs-model';
// ADR-0068 : compte Lalanda (invitation) et matricule.
import { FicheCompte } from './fiche-compte';
import { FicheFormulaire } from './fiche-formulaire';
import { useFiche } from './fiche-chrome';
import { useAccesRh } from './rh-access';
import { peutGererRh } from './rh-model';
import { Panneau } from './rh-ui';

export function FicheDossier(): React.ReactElement {
  const { fiche, contrats, remplacer } = useFiche();
  const { actions } = useAccesRh();
  const gerer = peutGererRh(actions) && fiche.status !== 'anonymized';
  const [edition, setEdition] = useState(false);

  return (
    <>
      <Panneau
        titre="Dossier"
        icone={FileText}
        id="rh-fiche-dossier"
        action={
          gerer ? (
            <button
              type="button"
              className={buttonClasses('secondary', 'sm')}
              aria-haspopup="dialog"
              onClick={() => setEdition(true)}
            >
              Modifier
            </button>
          ) : null
        }
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {lignesDossier(fiche, contrats).map(([k, v]) => (
            <div key={k} className="flex min-w-0 flex-col">
              <dt className="text-xs text-[var(--foreground-muted)]">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </Panneau>
      <FicheCompte />
      {fiche.notes ? (
        <Panneau titre="Notes" icone={NotebookPen} id="rh-fiche-notes">
          <p className="text-sm whitespace-pre-line break-words">{fiche.notes}</p>
        </Panneau>
      ) : null}
      {/* ADR-0046 — S9 : matériel affecté (§ 6.5), sans modifier les RH. */}
      <EntityAssetsPanel
        filtre={{ employeeId: fiche.id }}
        vide="Aucun équipement affecté à ce collaborateur."
      />
      <Modal
        open={gerer && edition}
        onClose={() => setEdition(false)}
        title="Modifier le dossier"
        size="lg"
      >
        <FicheFormulaire
          fiche={fiche}
          onAnnuler={() => setEdition(false)}
          onEnregistre={(f) => {
            remplacer(f);
            setEdition(false);
          }}
        />
      </Modal>
    </>
  );
}
