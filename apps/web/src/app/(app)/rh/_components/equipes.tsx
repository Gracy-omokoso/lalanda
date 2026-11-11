'use client';

// Équipes — ADR-0060 § 2 : liste à gauche, fiche à droite (`?equipe=<id>`).
// Une équipe regroupe des utilisateurs de l'organisation, au-delà des services ;
// ajoutée à un projet, elle y donne accès à ses membres courants. Lecture `hr.read`,
// gestion `hr.manage` (création, modification, membres, suppression confirmée).
//
// ADR-0074 : responsable et membre à ajouter en `EntityPicker` sur les
// utilisateurs de l'organisation (sans « + » : un utilisateur s'invite depuis
// l'organisation, pas depuis une équipe).

import type { TeamMemberView, TeamView } from '@lalanda/shared/hr';
import {
  Button,
  EntityPicker,
  Field,
  FormGrid,
  Modal,
  SubmitButton,
  TextArea,
  TextInput,
  buttonClasses,
  correspondRecherche,
} from '@lalanda/ui';
import { FolderKanban, Plus, UserMinus, UserPlus, UsersRound } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useState } from 'react';

import { teamsApi } from '@/lib/teams-api';

import { Avatar, PileAvatars } from '../../projets/_components/elements';
import { Alerte, BOUTON_DANGER, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import {
  candidatsAjoutables,
  formEquipe,
  messageEquipe,
  resumeEquipe,
  validerEquipe,
  type FormEquipe,
} from './equipes-model';
import { useAccesRh } from './rh-access';
import { codeDe, lire, messageRh, peutGererRh, peutLireRh, type Lecture } from './rh-model';
import { Bandeau, Chargement, EchecLecture, PhraseSection } from './rh-ui';

function message(err: unknown, repli: string): string {
  return messageEquipe(codeDe(err), messageRh(err, repli));
}

function FormulaireEquipe({
  equipe,
  candidats,
  onEnregistre,
  onAnnuler,
}: {
  equipe: TeamView | null;
  candidats: TeamMemberView[];
  onEnregistre: (t: TeamView) => void;
  onAnnuler: () => void;
}): React.ReactElement {
  const id = useId();
  const [f, setF] = useState<FormEquipe>(() => formEquipe(equipe));
  const [champ, setChamp] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const r = validerEquipe(f);
    if (!r.ok) {
      setChamp(r.erreur);
      return;
    }
    setChamp(undefined);
    setErreur(null);
    setEnvoi(true);
    try {
      const t = equipe
        ? await teamsApi.update(equipe.id, { ...r.corps, expectedRevision: equipe.revision })
        : await teamsApi.create(r.corps);
      onEnregistre(t);
    } catch (err) {
      setErreur(message(err, 'L’équipe n’a pas pu être enregistrée.'));
    } finally {
      setEnvoi(false);
    }
  }

  const responsable = candidats.find((c) => c.userId === f.leadUserId) ?? null;

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void envoyer(e)} noValidate>
      <FormGrid>
        <Field id={`${id}-nom`} label="Nom de l’équipe" required size="lg" error={champ}>
          <TextInput
            value={f.name}
            maxLength={80}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>
        <Field
          id={`${id}-desc`}
          label="Description"
          optional
          size="full"
          hint="Ce que fait l’équipe, en une phrase."
        >
          <TextArea
            value={f.description}
            maxLength={1000}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Field>
        <Field
          id={`${id}-resp`}
          label="Responsable"
          size="lg"
          hint="Le responsable fait partie de l’équipe. Il peut venir de n’importe quel service."
        >
          <EntityPicker<TeamMemberView>
            value={responsable}
            onChange={(c) => setF({ ...f, leadUserId: c?.userId ?? '' })}
            search={async (q) => candidats.filter((c) => correspondRecherche([c.name], q))}
            refreshKey={candidats.length}
            getKey={(c) => c.userId}
            getLabel={(c) => c.name}
            placeholder="Aucun"
            debounceMs={0}
            emptyText="Aucun membre de l’organisation ne correspond."
          />
        </Field>
      </FormGrid>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <Button size="sm" onClick={onAnnuler} disabled={envoi} className="max-sm:h-11">
          Annuler
        </Button>
        <SubmitButton size="sm" busy={envoi} busyLabel="Enregistrement…" className="max-sm:h-11">
          {equipe ? 'Enregistrer' : 'Créer l’équipe'}
        </SubmitButton>
      </div>
    </form>
  );
}

function FicheEquipe({
  equipe,
  candidats,
  gerer,
  onChange,
  onEditer,
  onSupprimer,
}: {
  equipe: TeamView;
  candidats: TeamMemberView[];
  gerer: boolean;
  onChange: (t: TeamView) => void;
  onEditer: () => void;
  onSupprimer: () => void;
}): React.ReactElement {
  const id = useId();
  const [choix, setChoix] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const ajoutables = candidatsAjoutables(candidats, equipe);
  const choisi = ajoutables.find((c) => c.userId === choix) ?? null;

  async function agir(p: Promise<TeamView>, repli: string): Promise<void> {
    setErreur(null);
    setEnvoi(true);
    try {
      onChange(await p);
      setChoix('');
    } catch (err) {
      setErreur(message(err, repli));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <article
      aria-labelledby={`${id}-titre`}
      className="flex min-w-0 flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 id={`${id}-titre`} className="text-lg font-semibold break-words">
            {equipe.name}
          </h3>
          {equipe.description ? (
            <p className="text-sm text-[var(--foreground-muted)]">{equipe.description}</p>
          ) : null}
          <p className="text-xs text-[var(--foreground-muted)]">
            {equipe.lead ? `Responsable : ${equipe.lead.name} · ` : ''}
            {resumeEquipe(equipe)}
          </p>
        </div>
        {gerer ? (
          <span className="flex gap-2">
            <button
              type="button"
              className={BOUTON_PETIT}
              onClick={onEditer}
              aria-haspopup="dialog"
            >
              Modifier
            </button>
            <button
              type="button"
              className={BOUTON_DANGER}
              onClick={onSupprimer}
              aria-haspopup="dialog"
            >
              Supprimer
            </button>
          </span>
        ) : null}
      </header>

      {equipe.projectCount > 0 ? (
        <p className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--foreground-muted)]">
          <FolderKanban aria-hidden="true" className="h-3.5 w-3.5" />
          Ajoutée à {equipe.projectCount} projet{equipe.projectCount > 1 ? 's' : ''} : ses membres y
          ont accès, y compris ceux qui la rejoindront.
        </p>
      ) : null}

      <section aria-label="Membres" className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">Membres</h4>
        {equipe.members.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">Aucun membre pour l’instant.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {equipe.members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 py-2 text-sm">
                <Avatar name={m.name} cle={m.userId} taille={28} />
                <span className="min-w-0 flex-1 break-words">
                  {m.name}
                  {equipe.lead?.userId === m.userId ? (
                    <span className="ml-2 text-xs text-[var(--foreground-muted)]">Responsable</span>
                  ) : null}
                </span>
                {gerer ? (
                  <button
                    type="button"
                    className={BOUTON_PETIT}
                    disabled={envoi}
                    onClick={() =>
                      void agir(
                        teamsApi.removeMember(equipe.id, m.userId),
                        'Le membre n’a pas pu être retiré.',
                      )
                    }
                  >
                    <UserMinus aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                    Retirer<span className="sr-only"> {m.name}</span>
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {gerer ? (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (choix === '') return;
            void agir(
              teamsApi.addMembers(equipe.id, { userIds: [choix] }),
              'Le membre n’a pas pu être ajouté.',
            );
          }}
        >
          <Field
            id={`${id}-ajout`}
            label="Ajouter un membre de l’organisation"
            className="min-w-0 sm:max-w-sm sm:flex-1"
          >
            <EntityPicker<TeamMemberView>
              value={choisi}
              onChange={(c) => setChoix(c?.userId ?? '')}
              search={async (q) => ajoutables.filter((c) => correspondRecherche([c.name], q))}
              refreshKey={ajoutables.length}
              getKey={(c) => c.userId}
              getLabel={(c) => c.name}
              placeholder="Tapez un nom…"
              debounceMs={0}
              emptyText="Aucun membre à ajouter ne correspond."
            />
          </Field>
          <button
            type="submit"
            className={buttonClasses('primary', 'sm')}
            disabled={envoi || choix === ''}
          >
            <UserPlus aria-hidden="true" className="h-4 w-4" />
            Ajouter
          </button>
        </form>
      ) : null}
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </article>
  );
}

export function Equipes(): React.ReactElement {
  const { actions } = useAccesRh();
  const gerer = peutGererRh(actions);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const choisie = params.get('equipe');
  const [lecture, setLecture] = useState<Lecture<TeamView[]> | null>(null);
  const [candidats, setCandidats] = useState<TeamMemberView[]>([]);
  const [edition, setEdition] = useState<TeamView | 'nouvelle' | null>(null);
  const [suppression, setSuppression] = useState<TeamView | null>(null);
  const [erreurSuppression, setErreurSuppression] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const recharger = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!peutLireRh(actions)) return;
    let annule = false;
    void lire(teamsApi.list()).then((l) => {
      if (!annule) setLecture(l);
    });
    teamsApi
      .candidates()
      .then((c) => {
        if (!annule) setCandidats(c);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [actions, version]);

  const choisir = (teamId: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (teamId) q.set('equipe', teamId);
    else q.delete('equipe');
    router.replace(`${pathname}${q.size > 0 ? `?${q.toString()}` : ''}`, { scroll: false });
  };

  if (!peutLireRh(actions)) {
    return (
      <PhraseSection>
        Les équipes se consultent avec le droit de lire les dossiers du personnel. Les membres d’un
        projet voient, dans le projet, les équipes qui y sont ajoutées.
      </PhraseSection>
    );
  }

  const equipes = lecture?.ok ? lecture.valeur : [];
  const fiche = equipes.find((t) => t.id === choisie) ?? equipes[0] ?? null;
  const remplacer = (t: TeamView) =>
    setLecture({ ok: true, valeur: equipes.map((x) => (x.id === t.id ? t : x)) });

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={UsersRound}
        titre="Équipes"
        sousTitre="Des personnes qui travaillent ensemble, au-delà des services. Ajoutez une équipe à un projet : tous ses membres y accèdent."
        actions={
          gerer ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              aria-haspopup="dialog"
              onClick={() => setEdition('nouvelle')}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Nouvelle équipe
            </button>
          ) : null
        }
      />

      {lecture === null ? (
        <Chargement />
      ) : !lecture.ok ? (
        <EchecLecture
          erreur={lecture.erreur}
          repli="Les équipes sont illisibles."
          onReessayer={recharger}
        />
      ) : equipes.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--foreground-muted)]">
          Aucune équipe n’est encore créée.
          {gerer ? ' Créez la première : « Nouvelle équipe ».' : ''}
        </p>
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <ul className="flex min-w-0 flex-col gap-2" aria-label="Équipes de l’organisation">
            {equipes.map((t) => {
              const active = fiche?.id === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => choisir(t.id)}
                    className={`flex w-full min-w-0 items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 text-left text-sm transition-colors ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent-subtle,var(--surface-muted))]'
                        : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-muted)]'
                    }`}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium break-words">{t.name}</span>
                      <span className="text-xs text-[var(--foreground-muted)]">
                        {resumeEquipe(t)}
                      </span>
                    </span>
                    <PileAvatars membres={t.members} max={3} taille={24} />
                  </button>
                </li>
              );
            })}
          </ul>
          {fiche ? (
            <FicheEquipe
              key={fiche.id}
              equipe={fiche}
              candidats={candidats}
              gerer={gerer}
              onChange={remplacer}
              onEditer={() => setEdition(fiche)}
              onSupprimer={() => {
                setErreurSuppression(null);
                setSuppression(fiche);
              }}
            />
          ) : null}
        </div>
      )}

      {edition !== null ? (
        <Modal
          open
          onClose={() => setEdition(null)}
          title={edition === 'nouvelle' ? 'Nouvelle équipe' : `Modifier « ${edition.name} »`}
        >
          <FormulaireEquipe
            equipe={edition === 'nouvelle' ? null : edition}
            candidats={candidats}
            onAnnuler={() => setEdition(null)}
            onEnregistre={(t) => {
              setEdition(null);
              recharger();
              choisir(t.id);
            }}
          />
        </Modal>
      ) : null}

      {suppression !== null ? (
        <Modal
          open
          onClose={() => setSuppression(null)}
          title={`Supprimer « ${suppression.name} » ?`}
        >
          <div className="flex flex-col gap-4 text-sm">
            <p>
              {suppression.projectCount > 0
                ? `Ses membres perdront l’accès aux ${suppression.projectCount} projet(s) privé(s) où l’équipe est ajoutée, sauf s’ils y sont membres autrement.`
                : 'L’équipe n’est ajoutée à aucun projet.'}{' '}
              Les personnes restent membres de l’organisation.
            </p>
            {erreurSuppression ? (
              <Alerte>
                <p>{erreurSuppression}</p>
              </Alerte>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" className={BOUTON_PETIT} onClick={() => setSuppression(null)}>
                Annuler
              </button>
              <button
                type="button"
                className={BOUTON_DANGER}
                onClick={() => {
                  void teamsApi
                    .remove(suppression.id)
                    .then(() => {
                      setSuppression(null);
                      choisir(null);
                      recharger();
                    })
                    .catch((err: unknown) =>
                      setErreurSuppression(message(err, 'L’équipe n’a pas pu être supprimée.')),
                    );
                }}
              >
                Supprimer l’équipe
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
