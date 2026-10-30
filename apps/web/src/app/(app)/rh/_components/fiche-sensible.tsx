'use client';

// Onglet « Données sensibles » de la fiche collaborateur (ADR-0045 § 2.4, § 8),
// lot H7. Masquées par défaut : l'écran lit les formes masquées
// (`GET …/private`) ; « Afficher » demande une confirmation qui dit que
// l'affichage est journalisé, puis appelle `reveal` pour la seule section
// choisie. Le clair vit dans l'état de ce composant, jamais en cache ni en
// stockage local : il disparaît après 60 secondes, quand la page passe en
// arrière-plan ou quand on quitte l'onglet. La modification se fait en fenêtre
// modale (`hr.manage` + `hr.sensitive.read`) ; le collaborateur lit ses propres
// données mais ne les modifie pas.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { Eye, EyeOff, Lock, Pencil, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import {
  hrAdminApi,
  type EmployeePrivateSummary,
  type HrPrivateField,
  type HrPrivateSections,
} from '@/lib/api-hr-admin';

import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { useFiche } from './fiche-chrome';
import { FormulaireSensible } from './formulaire-sensible';
import { useAccesRh } from './rh-access';
import { formatJour, lire, type Lecture } from './rh-model';
import { Chargement, EchecLecture, Panneau, PhraseSection } from './rh-ui';
import {
  DUREE_AFFICHAGE_MS,
  PHRASE_JOURNALISEE,
  SECTIONS_SENSIBLES,
  lignesClaires,
  lignesMasquees,
  messageSensible,
  modifieeLe,
  peutModifierSensible,
  peutVoirSensible,
  phraseAlerteBancaire,
  type SectionSensible,
} from './sensible-model';

type Clair = { [F in HrPrivateField]?: HrPrivateSections[F] | null };

/** Demande d'affichage en attente de confirmation ; `edition` : ouvrir le formulaire ensuite. */
interface Demande {
  section: SectionSensible;
  edition: boolean;
}

export function FicheSensible(): React.ReactElement {
  const { fiche } = useFiche();
  const { actions, moi } = useAccesRh();
  const estSoi = moi?.ok === true && moi.valeur.employee?.id === fiche.id;
  const voir = peutVoirSensible(actions, estSoi);
  const modifier = peutModifierSensible(actions) && fiche.status !== 'anonymized';

  const [lecture, setLecture] = useState<Lecture<EmployeePrivateSummary> | null>(null);
  const [version, setVersion] = useState(0);
  const [clair, setClair] = useState<Clair>({});
  const [demande, setDemande] = useState<Demande | null>(null);
  const [edition, setEdition] = useState<SectionSensible | null>(null);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);

  const masquerTout = useCallback(() => {
    setClair({});
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = null;
  }, []);

  useEffect(() => {
    if (!voir) return;
    let annule = false;
    void lire(hrAdminApi.getPrivateSummary(fiche.id)).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [fiche.id, voir, version]);

  // Le clair disparaît quand la page passe en arrière-plan et au démontage (changement d'onglet).
  useEffect(() => {
    const cacher = (): void => {
      if (document.visibilityState === 'hidden') masquerTout();
    };
    document.addEventListener('visibilitychange', cacher);
    return () => {
      document.removeEventListener('visibilitychange', cacher);
      masquerTout();
    };
  }, [masquerTout]);

  if (!voir) {
    return (
      <PhraseSection>
        Les données sensibles ne sont visibles que des personnes autorisées à les consulter et du
        collaborateur lui-même.
      </PhraseSection>
    );
  }
  if (lecture === null) return <Chargement texte="Chargement des données sensibles…" />;
  if (!lecture.ok) {
    return (
      <EchecLecture
        erreur={lecture.erreur}
        repli="Les données sensibles sont illisibles."
        onReessayer={() => setVersion((v) => v + 1)}
      />
    );
  }

  const resume = lecture.valeur;
  const alerte = phraseAlerteBancaire(resume);
  const sections = SECTIONS_SENSIBLES.filter(
    (s) => s.champ !== 'exitNote' || fiche.status !== 'active' || resume.exitNote !== null,
  );

  async function afficher(d: Demande): Promise<void> {
    const r = await hrAdminApi.revealPrivate(fiche.id, [d.section.champ]);
    setClair((c) => ({ ...c, [d.section.champ]: r.sections[d.section.champ] ?? null }));
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = setTimeout(masquerTout, DUREE_AFFICHAGE_MS);
    setDemande(null);
    if (d.edition) setEdition(d.section);
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs text-[var(--foreground-muted)]">
        <Lock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Ces données sont chiffrées et masquées par défaut. Chaque affichage est inscrit au journal
          d’audit.{' '}
          {estSoi
            ? 'Il s’agit de votre propre dossier : pour corriger une valeur, adressez-vous aux ressources humaines.'
            : ''}
        </span>
      </p>
      {alerte ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--warn)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] p-3 text-sm"
        >
          <ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{alerte}</p>
        </div>
      ) : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {sections.map((s) => {
          const masquees = lignesMasquees(s.champ, resume);
          const affichee = s.champ in clair;
          const existe = resume[s.champ] !== null;
          const modif = modifieeLe(s.champ, resume);
          return (
            <Panneau
              key={s.champ}
              titre={s.titre}
              id={`rh-sensible-${s.champ}`}
              action={
                <div className="flex flex-wrap gap-2">
                  {existe ? (
                    affichee ? (
                      <button
                        type="button"
                        className={BOUTON_PETIT}
                        onClick={() =>
                          setClair((c) => {
                            const n = { ...c };
                            delete n[s.champ];
                            return n;
                          })
                        }
                      >
                        <EyeOff aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                        Masquer
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={BOUTON_PETIT}
                        aria-haspopup="dialog"
                        onClick={() => setDemande({ section: s, edition: false })}
                      >
                        <Eye aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                        Afficher
                      </button>
                    )
                  ) : null}
                  {modifier ? (
                    <button
                      type="button"
                      className={BOUTON_PETIT}
                      aria-haspopup="dialog"
                      onClick={() =>
                        existe && !affichee
                          ? setDemande({ section: s, edition: true })
                          : setEdition(s)
                      }
                    >
                      <Pencil aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                      {existe ? 'Modifier' : 'Renseigner'}
                    </button>
                  ) : null}
                </div>
              }
            >
              <p className="text-xs text-[var(--foreground-muted)]">{s.aide}</p>
              {affichee ? (
                <dl className="grid grid-cols-1 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
                  {lignesClaires(s.champ, clair[s.champ]).map(([k, v], i) => (
                    <div key={`${k}-${i}`} className="contents">
                      <dt className="text-xs text-[var(--foreground-muted)] sm:text-sm">{k}</dt>
                      <dd className="break-words font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : masquees.length === 0 ? (
                <PhraseSection>Rien n’est renseigné.</PhraseSection>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {masquees.map((l) => (
                    <li key={l} className="break-words">
                      {l}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {affichee ? <Badge tone="warning">Affiché — masqué dans 60 s</Badge> : null}
                {modif ? (
                  <span className="text-xs text-[var(--foreground-muted)]">
                    Modifié le {formatJour(modif.slice(0, 10))}
                  </span>
                ) : null}
              </div>
            </Panneau>
          );
        })}
      </div>

      {demande ? (
        <ConfirmationAffichage
          demande={demande}
          onFermer={() => setDemande(null)}
          onConfirmer={() => afficher(demande)}
        />
      ) : null}

      <Modal
        open={modifier && edition !== null}
        onClose={() => setEdition(null)}
        title={
          edition ? `${resume[edition.champ] ? 'Modifier' : 'Renseigner'} : ${edition.titre}` : ''
        }
        description="Les valeurs sont chiffrées avant d’être enregistrées. La modification est journalisée, sans les valeurs."
        size="lg"
      >
        {edition ? (
          <FormulaireSensible
            champ={edition.champ}
            actuel={clair[edition.champ] ?? null}
            onAnnuler={() => setEdition(null)}
            onEnregistrer={async (data) => {
              await hrAdminApi.writePrivateSection(fiche.id, edition.champ, data, resume.revision);
              masquerTout();
              setEdition(null);
              setVersion((v) => v + 1);
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function ConfirmationAffichage({
  demande,
  onFermer,
  onConfirmer,
}: {
  demande: Demande;
  onFermer: () => void;
  onConfirmer: () => Promise<void>;
}): React.ReactElement {
  const id = useId();
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function confirmer(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      await onConfirmer();
    } catch (err) {
      setErreur(messageSensible(err, 'Affichage impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title={`Afficher : ${demande.section.titre} ?`}
      size="sm"
      busy={envoi}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BOUTON_PETIT} onClick={onFermer} disabled={envoi}>
            Annuler
          </button>
          <button
            type="button"
            className={buttonClasses('primary', 'sm')}
            disabled={envoi}
            aria-describedby={`${id}-journal`}
            onClick={() => void confirmer()}
          >
            {envoi ? 'Affichage…' : demande.edition ? 'Afficher et modifier' : 'Afficher'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p id={`${id}-journal`}>{PHRASE_JOURNALISEE}</p>
        {demande.edition ? (
          <p className="text-[var(--foreground-muted)]">
            Pour modifier cette section, ses valeurs actuelles sont d’abord affichées.
          </p>
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
