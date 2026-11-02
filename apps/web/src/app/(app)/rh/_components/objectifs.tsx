'use client';

// « Objectifs » — ADR-0051 § 2.5, § 3.5, § 10 (lot H16). Éteint par défaut : l'écran
// explique comment l'activer. Activé : mes objectifs, ceux de mon équipe (relation),
// ceux de tous (`performance.read`). Le collaborateur propose, le manager ou les RH
// valident — jamais le collaborateur pour lui-même. Aucun avancement calculé : chaque
// déclaration est posée par une personne.

import { Modal, buttonClasses } from '@lalanda/ui';
import { Target } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';

import type { GoalFinalStatus } from '@lalanda/shared/hr';

import { rh2Api, type GoalView, type HrPerformanceSettingsView } from '@/lib/api-rh-2';

import { BOUTON_PETIT, CHAMP, Champ } from '../../ventes/_components/form-ui';

import {
  LIBELLES_STATUT_OBJECTIF,
  STATUTS_FINAUX_OBJECTIF,
  dernierAvancement,
  gestesObjectif,
  libelleCible,
  peutLirePerformance,
} from './evaluations-model';
import { useAccesRh } from './rh-access';
import { messageRh2 } from './rh2-model';
import {
  Carte,
  ErreurAction,
  FonctionEteinte,
  GrilleCartes,
  useEquipe,
  useMoi,
  useNoms,
} from './rh2-ui';
import { aujourdhui, formatJour, lire, type Lecture, type Ton } from './rh-model';
import {
  Bandeau,
  Chargement,
  DialogueDecision,
  EchecLecture,
  Panneau,
  PhraseSection,
} from './rh-ui';

function tonObjectif(s: GoalView['status']): Ton {
  if (s === 'proposed') return 'info';
  if (s === 'agreed') return 'warning';
  if (s === 'achieved') return 'success';
  if (s === 'not_achieved') return 'danger';
  return 'neutral';
}

export function Objectifs(): React.ReactElement {
  const { actions } = useAccesRh();
  const [reglages, setReglages] = useState<Lecture<HrPerformanceSettingsView> | null>(null);

  useEffect(() => {
    let annule = false;
    void lire(rh2Api.getPerformanceSettings()).then((l) => {
      if (!annule) setReglages(l);
    });
    return () => {
      annule = true;
    };
  }, []);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Target}
        titre="Objectifs"
        sousTitre="Ce qu’on attend de chacun sur une période, et où il en est. Le collaborateur propose, le manager valide ; l’avancement est déclaré par une personne, jamais calculé."
      />
      {reglages === null ? (
        <Chargement />
      ) : !reglages.ok ? (
        <EchecLecture erreur={reglages.erreur} repli="Réglages illisibles." />
      ) : !reglages.valeur.enabled ? (
        <FonctionEteinte fonction="performance" actions={actions} />
      ) : (
        <ObjectifsActifs />
      )}
    </section>
  );
}

type Dialogue =
  | { type: 'nouveau' }
  | { type: 'detail'; objectif: GoalView }
  | { type: 'avancer'; objectif: GoalView }
  | { type: 'clore'; objectif: GoalView }
  | null;

function ObjectifsActifs(): React.ReactElement {
  const { actions } = useAccesRh();
  const moi = useMoi();
  const equipe = useEquipe(moi.estManager);
  const noms = useNoms(
    peutLirePerformance(actions) && (actions?.includes('hr.read') ?? false),
    moi.estManager,
  );
  const [liste, setListe] = useState<Lecture<{ items: GoalView[] }> | null>(null);
  const [dialogue, setDialogue] = useState<Dialogue>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const relire = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let annule = false;
    void lire(rh2Api.listGoals()).then((l) => {
      if (!annule) setListe(l);
    });
    return () => {
      annule = true;
    };
  }, [version]);

  async function valider(g: GoalView): Promise<void> {
    setErreur(null);
    try {
      await rh2Api.agreeGoal(g.id, g.revision);
      setDialogue(null);
      relire();
    } catch (err) {
      setErreur(messageRh2(err, 'Validation impossible.'));
    }
  }

  const items = liste?.ok ? liste.valeur.items : [];
  const miens = items.filter((g) => g.employeeId === moi.employeeId);
  const autres = items.filter((g) => g.employeeId !== moi.employeeId);

  const cartes = (gs: GoalView[]): React.ReactElement => (
    <GrilleCartes>
      {gs.map((g) => (
        <Carte
          key={g.id}
          titre={g.title}
          detail={`${noms.get(g.employeeId) ?? 'Collaborateur'} · du ${formatJour(g.period.from)} au ${formatJour(g.period.to)}`}
          statut={LIBELLES_STATUT_OBJECTIF[g.status]}
          ton={tonObjectif(g.status)}
          valeur={dernierAvancement(g) ?? undefined}
          onOuvrir={() => setDialogue({ type: 'detail', objectif: g })}
        />
      ))}
    </GrilleCartes>
  );

  return (
    <>
      <Panneau
        titre="Mes objectifs"
        icone={Target}
        action={
          moi.employeeId ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              onClick={() => setDialogue({ type: 'nouveau' })}
            >
              + Proposer un objectif
            </button>
          ) : null
        }
      >
        {liste === null ? (
          <Chargement />
        ) : !liste.ok ? (
          <EchecLecture erreur={liste.erreur} repli="Objectifs illisibles." onReessayer={relire} />
        ) : miens.length === 0 ? (
          <PhraseSection>Aucun objectif pour vous.</PhraseSection>
        ) : (
          cartes(miens)
        )}
      </Panneau>
      {autres.length > 0 ? (
        <Panneau
          titre={
            peutLirePerformance(actions) ? 'Objectifs du personnel' : 'Objectifs de mon équipe'
          }
        >
          {cartes(autres)}
        </Panneau>
      ) : null}

      {dialogue?.type === 'nouveau' ? (
        <NouvelObjectif
          onFermer={() => setDialogue(null)}
          onCree={() => {
            setDialogue(null);
            relire();
          }}
        />
      ) : null}
      {dialogue?.type === 'detail'
        ? (() => {
            const g = dialogue.objectif;
            const gestes = gestesObjectif(g, moi, actions, equipe);
            return (
              <Modal
                open
                onClose={() => setDialogue(null)}
                title={g.title}
                description={`${noms.get(g.employeeId) ?? 'Collaborateur'} · ${LIBELLES_STATUT_OBJECTIF[g.status]}`}
                size="md"
                footer={
                  <div className="flex flex-wrap justify-end gap-2">
                    {gestes.avancer ? (
                      <button
                        type="button"
                        className={BOUTON_PETIT}
                        onClick={() => setDialogue({ type: 'avancer', objectif: g })}
                      >
                        Déclarer un avancement
                      </button>
                    ) : null}
                    {gestes.clore ? (
                      <button
                        type="button"
                        className={BOUTON_PETIT}
                        onClick={() => setDialogue({ type: 'clore', objectif: g })}
                      >
                        Poser le résultat
                      </button>
                    ) : null}
                    {gestes.valider ? (
                      <button
                        type="button"
                        className={buttonClasses('primary', 'sm')}
                        onClick={() => void valider(g)}
                      >
                        Valider l’objectif
                      </button>
                    ) : null}
                  </div>
                }
              >
                <div className="flex flex-col gap-2 text-sm">
                  {gestes.phrase ? (
                    <p className="rounded-[var(--radius-md)] border border-[var(--warn)]/50 p-3">
                      {gestes.phrase}
                    </p>
                  ) : null}
                  <p>
                    Du {formatJour(g.period.from)} au {formatJour(g.period.to)}
                    {g.weight !== null ? ` · poids ${g.weight}` : ''}
                  </p>
                  {g.description ? <p className="whitespace-pre-wrap">{g.description}</p> : null}
                  {g.measure ? <p>Mesure : {g.measure}</p> : null}
                  {libelleCible(g.target) ? <p>Cible : {libelleCible(g.target)}</p> : null}
                  {g.closeComment ? <p>Résultat : {g.closeComment}</p> : null}
                  {g.progress.length > 0 ? (
                    <ul className="flex flex-col gap-1 text-xs">
                      {g.progress.map((p) => (
                        <li key={p.at}>
                          {formatJour(p.at.slice(0, 10))} ·{' '}
                          {p.percent !== null ? `${p.percent} % · ` : ''}
                          {p.note}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <ErreurAction erreur={erreur} />
                </div>
              </Modal>
            );
          })()
        : null}
      {dialogue?.type === 'avancer' ? (
        <Avancement
          objectif={dialogue.objectif}
          onFermer={() => setDialogue(null)}
          onFait={() => {
            setDialogue(null);
            relire();
          }}
        />
      ) : null}
      {dialogue?.type === 'clore' ? (
        <Resultat
          objectif={dialogue.objectif}
          onFermer={() => setDialogue(null)}
          onFait={() => {
            setDialogue(null);
            relire();
          }}
        />
      ) : null}
    </>
  );
}

function NouvelObjectif({
  onFermer,
  onCree,
}: {
  onFermer: () => void;
  onCree: () => void;
}): React.ReactElement {
  const id = useId();
  const jour = aujourdhui();
  const [titre, setTitre] = useState('');
  const [du, setDu] = useState(jour);
  const [au, setAu] = useState(`${jour.slice(0, 4)}-12-31`);
  const [description, setDescription] = useState('');
  const [mesure, setMesure] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function creer(): Promise<void> {
    if (titre.trim() === '') {
      setErreur('Donnez un titre à l’objectif.');
      return;
    }
    setErreur(null);
    setEnvoi(true);
    try {
      await rh2Api.createGoal({
        period: { from: du, to: au },
        title: titre.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(mesure.trim() ? { measure: mesure.trim() } : {}),
      });
      onCree();
    } catch (err) {
      setErreur(messageRh2(err, 'Création impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title="Proposer un objectif"
      description="Votre manager ou les ressources humaines le valideront."
      size="md"
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
            onClick={() => void creer()}
          >
            {envoi ? 'Envoi…' : 'Proposer'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <Champ id={`${id}-t`} label="Titre" requis>
          <input
            id={`${id}-t`}
            className={CHAMP}
            value={titre}
            maxLength={200}
            onChange={(e) => setTitre(e.target.value)}
          />
        </Champ>
        <div className="grid grid-cols-2 gap-3">
          <Champ id={`${id}-du`} label="Du" requis>
            <input
              id={`${id}-du`}
              type="date"
              className={CHAMP}
              value={du}
              onChange={(e) => setDu(e.target.value)}
            />
          </Champ>
          <Champ id={`${id}-au`} label="Au" requis>
            <input
              id={`${id}-au`}
              type="date"
              className={CHAMP}
              value={au}
              onChange={(e) => setAu(e.target.value)}
            />
          </Champ>
        </div>
        <Champ id={`${id}-d`} label="Description (facultatif)">
          <textarea
            id={`${id}-d`}
            rows={3}
            className={CHAMP}
            value={description}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Champ>
        <Champ id={`${id}-m`} label="Comment saura-t-on que c’est atteint ? (facultatif)">
          <input
            id={`${id}-m`}
            className={CHAMP}
            value={mesure}
            maxLength={300}
            onChange={(e) => setMesure(e.target.value)}
          />
        </Champ>
        <ErreurAction erreur={erreur} />
      </div>
    </Modal>
  );
}

function Avancement({
  objectif,
  onFermer,
  onFait,
}: {
  objectif: GoalView;
  onFermer: () => void;
  onFait: () => void;
}): React.ReactElement {
  const id = useId();
  const [pourcent, setPourcent] = useState('');
  const [note, setNote] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(): Promise<void> {
    const p = pourcent.trim() === '' ? null : Number(pourcent);
    if (p !== null && (!Number.isInteger(p) || p < 0 || p > 100)) {
      setErreur('Pourcentage : un entier entre 0 et 100.');
      return;
    }
    if (note.trim() === '') {
      setErreur('Une note est obligatoire.');
      return;
    }
    setErreur(null);
    setEnvoi(true);
    try {
      await rh2Api.goalProgress(objectif.id, { percent: p, note: note.trim() });
      onFait();
    } catch (err) {
      setErreur(messageRh2(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title="Déclarer un avancement"
      description={`${objectif.title} — une déclaration, jamais un calcul.`}
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
            onClick={() => void envoyer()}
          >
            Enregistrer
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <Champ id={`${id}-p`} label="Où en êtes-vous ? (%, facultatif)">
          <input
            id={`${id}-p`}
            inputMode="numeric"
            className={CHAMP}
            value={pourcent}
            onChange={(e) => setPourcent(e.target.value)}
          />
        </Champ>
        <Champ id={`${id}-n`} label="Note" requis>
          <textarea
            id={`${id}-n`}
            rows={3}
            className={CHAMP}
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
        </Champ>
        <ErreurAction erreur={erreur} />
      </div>
    </Modal>
  );
}

const LIBELLES_FINAUX: Record<GoalFinalStatus, string> = {
  achieved: 'Atteint',
  partially_achieved: 'Partiellement atteint',
  not_achieved: 'Non atteint',
  dropped: 'Abandonné',
};

function Resultat({
  objectif,
  onFermer,
  onFait,
}: {
  objectif: GoalView;
  onFermer: () => void;
  onFait: () => void;
}): React.ReactElement {
  const [statut, setStatut] = useState<GoalFinalStatus>('achieved');
  return (
    <DialogueDecision
      titre="Poser le résultat"
      description="Le résultat est posé par une personne ; il n’a aucun effet automatique."
      libelle="Commentaire"
      bouton="Enregistrer"
      commentaire="obligatoire"
      onFermer={onFermer}
      onValider={async (t) => {
        await rh2Api.closeGoal(objectif.id, {
          expectedRevision: objectif.revision,
          status: statut,
          comment: t,
        });
        onFait();
      }}
    >
      <select
        aria-label="Résultat"
        className={CHAMP}
        value={statut}
        onChange={(e) => setStatut(e.target.value as GoalFinalStatus)}
      >
        {STATUTS_FINAUX_OBJECTIF.map((s) => (
          <option key={s} value={s}>
            {LIBELLES_FINAUX[s]}
          </option>
        ))}
      </select>
    </DialogueDecision>
  );
}
