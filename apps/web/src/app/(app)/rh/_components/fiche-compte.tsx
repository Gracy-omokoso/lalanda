'use client';

// Compte Lalanda et matricule d'un collaborateur (ADR-0068 § 1 et § 2), dans
// l'onglet « Dossier » : relié / invitation en attente (renvoyer, annuler) / sans
// compte (inviter) ; correction du matricule par le droit RH administrateur, avec
// motif ; attribution d'un matricule à une fiche ancienne qui n'en a pas.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { KeyRound } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';

import { LIBELLES_INVITATION, hrLot1Api, type EmployeeAccountView } from '@/lib/api-hr-lot1';

import { Alerte, BOUTON_PETIT, CHAMP, Champ } from '../../ventes/_components/form-ui';

import { useFiche } from './fiche-chrome';
import { libelleEtatCompte, peutCorrigerMatricule, peutInviterSurLalanda } from './lot1-model';
import { useAccesRh } from './rh-access';
import { formatJour, messageRh, peutGererRh } from './rh-model';
import { Chargement, Panneau } from './rh-ui';

export function FicheCompte(): React.ReactElement | null {
  const { fiche, remplacer } = useFiche();
  const { actions } = useAccesRh();
  const gerer = peutGererRh(actions) && fiche.status !== 'anonymized';
  const inviter = gerer && peutInviterSurLalanda(actions);
  const corriger = gerer && peutCorrigerMatricule(actions);
  const [compte, setCompte] = useState<EmployeeAccountView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [correction, setCorrection] = useState(false);

  const relire = useCallback(() => {
    hrLot1Api
      .getAccount(fiche.id)
      .then(setCompte)
      .catch(() => setCompte(null));
  }, [fiche.id]);
  useEffect(() => relire(), [relire, fiche.revision]);

  if (fiche.status === 'anonymized') return null;

  async function agir(f: () => Promise<string | null>): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    setMessage(null);
    try {
      setMessage(await f());
      relire();
    } catch (err) {
      setErreur(messageRh(err, 'L’action n’a pas pu aboutir.'));
    } finally {
      setEnvoi(false);
    }
  }

  const etat = compte ? libelleEtatCompte(compte) : null;
  return (
    <Panneau titre="Compte Lalanda et matricule" icone={KeyRound} id="rh-fiche-compte">
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--foreground-muted)]">Matricule</span>
          <span className="font-medium">{fiche.employeeNumber ?? 'Aucun'}</span>
          {fiche.positionNumber ? (
            <>
              <span className="text-xs text-[var(--foreground-muted)]">· Poste</span>
              <span className="font-medium">{fiche.positionNumber}</span>
            </>
          ) : null}
          {gerer && fiche.employeeNumber === null ? (
            <button
              type="button"
              className={BOUTON_PETIT}
              disabled={envoi}
              onClick={() =>
                void agir(async () => {
                  remplacer(await hrLot1Api.assignEmployeeNumber(fiche.id, fiche.revision));
                  return 'Matricule attribué.';
                })
              }
            >
              Attribuer un matricule
            </button>
          ) : null}
          {corriger && fiche.employeeNumber !== null ? (
            <button
              type="button"
              className={BOUTON_PETIT}
              aria-haspopup="dialog"
              onClick={() => setCorrection(true)}
            >
              Corriger le matricule
            </button>
          ) : null}
        </div>

        {compte === null || etat === null ? (
          <Chargement />
        ) : (
          <div className="flex flex-col gap-2">
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={etat.ton}>{etat.texte}</Badge>
              {compte.invitation ? (
                <span className="text-xs text-[var(--foreground-muted)]">
                  {compte.invitation.email} ·{' '}
                  {compte.state === 'invitation_pending' ? 'valable jusqu’au' : 'expirée le'}{' '}
                  {formatJour(compte.invitation.expiresAt.slice(0, 10))}
                </span>
              ) : null}
            </span>
            {compte.state === 'none' ? (
              <p className="text-xs text-[var(--foreground-muted)]">
                {fiche.workEmail
                  ? inviter
                    ? 'Invitez cette personne : un membre qui a cette adresse est relié tout de suite, sinon une invitation part (rôle Salarié).'
                    : 'Invitation non envoyée : un administrateur qui peut inviter l’enverra d’ici.'
                  : 'Ajoutez un e-mail professionnel au dossier pour inviter cette personne.'}
              </p>
            ) : null}
            {inviter ? (
              <span className="flex flex-wrap gap-2">
                {compte.state === 'none' && fiche.workEmail ? (
                  <button
                    type="button"
                    className={buttonClasses('primary', 'sm')}
                    disabled={envoi}
                    onClick={() =>
                      void agir(async () => {
                        const r = await hrLot1Api.invite(fiche.id);
                        return LIBELLES_INVITATION[r.outcome];
                      })
                    }
                  >
                    Inviter sur Lalanda
                  </button>
                ) : null}
                {compte.state === 'invitation_pending' || compte.state === 'invitation_expired' ? (
                  <>
                    <button
                      type="button"
                      className={buttonClasses('secondary', 'sm')}
                      disabled={envoi}
                      onClick={() =>
                        void agir(async () => {
                          const r = await hrLot1Api.resendInvitation(fiche.id);
                          return r.emailDelivered === false
                            ? 'Nouvelle invitation créée ; le courriel n’a pas pu partir (envoi non configuré).'
                            : LIBELLES_INVITATION[r.outcome];
                        })
                      }
                    >
                      Renvoyer l’invitation
                    </button>
                    <button
                      type="button"
                      className={BOUTON_PETIT}
                      disabled={envoi}
                      onClick={() =>
                        void agir(async () => {
                          await hrLot1Api.cancelInvitation(fiche.id);
                          return 'Invitation annulée.';
                        })
                      }
                    >
                      Annuler l’invitation
                    </button>
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
        )}
        {message ? (
          <p className="text-xs" role="status">
            {message}
          </p>
        ) : null}
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
      </div>
      <Modal
        open={corriger && correction}
        onClose={() => setCorrection(false)}
        title="Corriger le matricule"
        description="Le matricule ne se modifie qu’exceptionnellement : la correction est tracée avec son motif. L’ancien numéro n’est jamais réattribué."
        size="sm"
      >
        <CorrectionMatricule
          onAnnuler={() => setCorrection(false)}
          onFait={(msg) => {
            setCorrection(false);
            setMessage(msg);
          }}
        />
      </Modal>
    </Panneau>
  );
}

function CorrectionMatricule({
  onAnnuler,
  onFait,
}: {
  onAnnuler: () => void;
  onFait: (message: string) => void;
}): React.ReactElement {
  const id = useId();
  const { fiche, remplacer } = useFiche();
  const [numero, setNumero] = useState(fiche.employeeNumber ?? '');
  const [motif, setMotif] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    if (numero.trim() === '' || motif.trim().length < 3) {
      setErreur('Indiquez le nouveau matricule et un motif (3 caractères au moins).');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      remplacer(
        await hrLot1Api.changeEmployeeNumber(fiche.id, {
          expectedRevision: fiche.revision,
          employeeNumber: numero.trim(),
          reason: motif.trim(),
        }),
      );
      onFait('Matricule corrigé ; la correction est tracée.');
    } catch (err) {
      setErreur(messageRh(err, 'Le matricule n’a pas pu être corrigé.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void envoyer(e)} noValidate>
      <Champ id={`${id}-num`} label="Nouveau matricule" requis>
        <input
          id={`${id}-num`}
          className={CHAMP}
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
        />
      </Champ>
      <Champ
        id={`${id}-motif`}
        label="Motif"
        requis
        aide="Par exemple : erreur de saisie à la création."
      >
        <textarea
          id={`${id}-motif`}
          rows={2}
          className={CHAMP}
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
        />
      </Champ>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" className={BOUTON_PETIT} onClick={onAnnuler} disabled={envoi}>
          Annuler
        </button>
        <button type="submit" className={buttonClasses('primary', 'sm')} disabled={envoi}>
          {envoi ? 'Correction…' : 'Corriger'}
        </button>
      </div>
    </form>
  );
}
