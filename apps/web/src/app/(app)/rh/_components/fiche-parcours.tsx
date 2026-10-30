'use client';

// Onglet « Entrées et sorties » de la fiche collaborateur (ADR-0045 § 2.9, § 3.1),
// lot H7 : listes d'accueil et de départ (lancer depuis un modèle, cocher), sortie
// (fenêtre modale), réintégration d'une sortie future, anonymisation avec
// confirmation forte. Chaque élément de liste apparaît aussi dans « Mes tâches »
// de son assigné (l'API le sert) ; ici, l'assigné ou `hr.manage` coche.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { ClipboardCheck, DoorOpen, ShieldOff, Undo2, UserMinus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import { hrAdminApi, type ChecklistTemplateView, type ChecklistView } from '@/lib/api-hr-admin';

import {
  Alerte,
  BOUTON_DANGER,
  BOUTON_PETIT,
  CHAMP,
  Champ,
  aria,
} from '../../ventes/_components/form-ui';

import { useFiche } from './fiche-chrome';
import {
  CATEGORIES_SORTIE,
  LIBELLES_LISTE,
  LIBELLES_SORTIE,
  PHRASE_ANONYMISATION,
  PHRASE_SORTIE,
  avancement,
  confirmationAnonymisation,
  etatElement,
  libelleAssigne,
  modelesProposes,
  peutCocher,
  peutDemanderAnonymisation,
  peutReintegrer,
  validerSortie,
  type FormSortie,
} from './parcours-model';
import { useAccesRh } from './rh-access';
import {
  aujourdhui,
  formatJour,
  lire,
  messageRh,
  nomAffiche,
  peutGererRh,
  type Lecture,
} from './rh-model';
import { Chargement, DialogueDecision, EchecLecture, Panneau, PhraseSection } from './rh-ui';

export function FicheParcours(): React.ReactElement {
  const { fiche, remplacer } = useFiche();
  const { actions, moi } = useAccesRh();
  const gerer = peutGererRh(actions) && fiche.status !== 'anonymized';
  const monUserId = moi?.ok === true ? (moi.valeur.employee?.userId ?? null) : null;
  const jour = aujourdhui();
  const nom = nomAffiche(fiche);

  const [listes, setListes] = useState<Lecture<ChecklistView[]> | null>(null);
  const [modeles, setModeles] = useState<ChecklistTemplateView[]>([]);
  const [version, setVersion] = useState(0);
  const [lancer, setLancer] = useState(false);
  const [sortie, setSortie] = useState(false);
  const [reintegrer, setReintegrer] = useState(false);
  const [anonymiser, setAnonymiser] = useState(false);
  const [suggestion, setSuggestion] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    void lire(hrAdminApi.listChecklists({ employeeId: fiche.id }).then((p) => p.items)).then(
      (l) => {
        if (!annule) setListes(l);
      },
    );
    return () => {
      annule = true;
    };
  }, [fiche.id, version]);

  useEffect(() => {
    if (!gerer) return;
    let annule = false;
    hrAdminApi
      .listChecklistTemplates()
      .then((p) => {
        if (!annule) setModeles(p.items);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [gerer]);

  async function cocher(l: ChecklistView, itemId: string, fait: boolean): Promise<void> {
    setErreur(null);
    try {
      await hrAdminApi.setChecklistItemDone(l.id, itemId, fait);
      setVersion((v) => v + 1);
    } catch (err) {
      setErreur(messageRh(err, 'L’élément n’a pas pu être mis à jour.'));
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {suggestion ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm"
        >
          <p>
            Sortie enregistrée. Lancez la liste de départ pour reprendre le matériel et les accès.
          </p>
          {gerer ? (
            <button
              type="button"
              className={BOUTON_PETIT}
              aria-haspopup="dialog"
              onClick={() => setLancer(true)}
            >
              Lancer une liste de départ
            </button>
          ) : null}
        </div>
      ) : null}

      <Panneau
        titre="Listes d’accueil et de départ"
        icone={ClipboardCheck}
        id="rh-fiche-listes"
        action={
          gerer ? (
            <button
              type="button"
              className={buttonClasses('secondary', 'sm')}
              aria-haspopup="dialog"
              onClick={() => setLancer(true)}
            >
              Lancer une liste
            </button>
          ) : null
        }
      >
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        {listes === null ? (
          <Chargement texte="Chargement des listes…" />
        ) : !listes.ok ? (
          <EchecLecture
            erreur={listes.erreur}
            repli="Les listes sont illisibles."
            onReessayer={() => setVersion((v) => v + 1)}
          />
        ) : listes.valeur.length === 0 ? (
          <PhraseSection>
            Aucune liste lancée pour ce collaborateur. Les éléments d’une liste apparaissent dans «
            Mes tâches » de chaque personne assignée.
          </PhraseSection>
        ) : (
          <div className="flex flex-col gap-4">
            {listes.valeur.map((l) => (
              <section key={l.id} aria-labelledby={`liste-${l.id}`} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 id={`liste-${l.id}`} className="text-sm font-semibold">
                    {l.kindLabel || LIBELLES_LISTE[l.kind]} — {l.label}
                  </h4>
                  <Badge tone={l.done === l.total ? 'success' : 'info'}>{avancement(l)}</Badge>
                </div>
                <p className="text-xs text-[var(--foreground-muted)]">
                  Échéances calculées depuis le {formatJour(l.pivotDate)}.
                </p>
                <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
                  {l.items.map((i) => {
                    const etat = etatElement(i, jour);
                    const cochable = gerer
                      ? true
                      : peutCocher(actions, i, monUserId) && fiche.status !== 'anonymized';
                    return (
                      <li key={i.id} className="flex items-start gap-3 py-2">
                        <input
                          id={`el-${l.id}-${i.id}`}
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0"
                          checked={i.doneAt !== null}
                          disabled={!cochable}
                          onChange={(e) => void cocher(l, i.id, e.target.checked)}
                        />
                        <label htmlFor={`el-${l.id}-${i.id}`} className="flex min-w-0 flex-col">
                          <span className={`break-words ${i.doneAt ? 'line-through' : ''}`}>
                            {i.label}
                          </span>
                          <span
                            className={`text-xs ${etat.retard ? 'font-medium text-[var(--danger)]' : 'text-[var(--foreground-muted)]'}`}
                          >
                            {etat.texte} · Assigné : {libelleAssigne(i, monUserId)}
                          </span>
                          {i.note ? (
                            <span className="text-xs text-[var(--foreground-muted)]">{i.note}</span>
                          ) : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {l.kind === 'offboarding' && fiche.userId ? (
                  <p className="text-xs text-[var(--foreground-muted)]">
                    Retirer l’accès à Lalanda se fait depuis la{' '}
                    <Link href="/organisation/membres" className="underline underline-offset-2">
                      page des membres
                    </Link>
                    .
                  </p>
                ) : null}
              </section>
            ))}
          </div>
        )}
      </Panneau>

      {gerer ? (
        <Panneau titre="Sortie" icone={DoorOpen} id="rh-fiche-sortie">
          {fiche.status === 'active' ? (
            <>
              <PhraseSection>{PHRASE_SORTIE}</PhraseSection>
              <button
                type="button"
                className={`${BOUTON_DANGER} self-start`}
                aria-haspopup="dialog"
                onClick={() => setSortie(true)}
              >
                <UserMinus aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                Enregistrer la sortie
              </button>
            </>
          ) : fiche.status === 'exited' ? (
            <>
              <p className="text-sm">
                Sortie le {fiche.endDate ? formatJour(fiche.endDate) : '—'}
                {fiche.exitCategory ? ` — ${LIBELLES_SORTIE[fiche.exitCategory]}` : ''}.
              </p>
              <div className="flex flex-wrap gap-2">
                {peutReintegrer(fiche, jour) ? (
                  <button
                    type="button"
                    className={BOUTON_PETIT}
                    aria-haspopup="dialog"
                    onClick={() => setReintegrer(true)}
                  >
                    <Undo2 aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                    Annuler la sortie
                  </button>
                ) : null}
                {peutDemanderAnonymisation(actions, fiche) ? (
                  <button
                    type="button"
                    className={BOUTON_DANGER}
                    aria-haspopup="dialog"
                    onClick={() => setAnonymiser(true)}
                  >
                    <ShieldOff aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                    Anonymiser le dossier
                  </button>
                ) : null}
              </div>
              {!peutDemanderAnonymisation(actions, fiche) ? (
                <p className="text-xs text-[var(--foreground-muted)]">
                  L’anonymisation est réservée aux personnes qui gèrent les dossiers et lisent les
                  données sensibles.
                </p>
              ) : null}
            </>
          ) : (
            <PhraseSection>Ce dossier est anonymisé : il ne se modifie plus.</PhraseSection>
          )}
        </Panneau>
      ) : null}

      <Modal
        open={lancer}
        onClose={() => setLancer(false)}
        title="Lancer une liste"
        description="Les éléments sont copiés du modèle, assignés et datés à partir de la date d’entrée ou de sortie."
        size="sm"
      >
        <LancerListe
          modeles={modelesProposes(modeles, fiche)}
          onAnnuler={() => setLancer(false)}
          onLancer={async (templateId) => {
            await hrAdminApi.instantiateChecklist(fiche.id, templateId);
            setLancer(false);
            setSuggestion(false);
            setVersion((v) => v + 1);
          }}
        />
      </Modal>

      <Modal
        open={sortie}
        onClose={() => setSortie(false)}
        title={`Enregistrer la sortie de ${nom}`}
        description={PHRASE_SORTIE}
        size="md"
      >
        <FormulaireSortie
          fiche={fiche}
          onAnnuler={() => setSortie(false)}
          onEnregistre={(f, proposee) => {
            remplacer(f);
            setSortie(false);
            setSuggestion(proposee);
          }}
        />
      </Modal>

      {reintegrer ? (
        <DialogueDecision
          titre="Annuler la sortie ?"
          description={`${nom} redevient actif. Les absences annulées par la sortie ne sont pas rétablies.`}
          libelle=""
          bouton="Annuler la sortie"
          commentaire="aucun"
          onFermer={() => setReintegrer(false)}
          onValider={async () => {
            remplacer(await hrAdminApi.reinstateEmployee(fiche.id, fiche.revision));
            setReintegrer(false);
          }}
        />
      ) : null}

      {anonymiser ? (
        <Anonymisation
          nom={nom}
          onFermer={() => setAnonymiser(false)}
          onConfirmer={async () => {
            remplacer(await hrAdminApi.anonymizeEmployee(fiche.id, fiche.revision));
            setAnonymiser(false);
          }}
        />
      ) : null}
    </div>
  );
}

function LancerListe({
  modeles,
  onAnnuler,
  onLancer,
}: {
  modeles: ChecklistTemplateView[];
  onAnnuler: () => void;
  onLancer: (templateId: string) => Promise<void>;
}): React.ReactElement {
  const id = useId();
  const [choix, setChoix] = useState(modeles[0]?.id ?? '');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  if (modeles.length === 0) {
    return (
      <PhraseSection>
        Aucun modèle de liste. Créez-en un dans les réglages des ressources humaines.
      </PhraseSection>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setEnvoi(true);
        setErreur(null);
        onLancer(choix)
          .catch((err: unknown) => setErreur(messageRh(err, 'La liste n’a pas pu être lancée.')))
          .finally(() => setEnvoi(false));
      }}
    >
      <Champ id={`${id}-modele`} label="Modèle" requis>
        <select
          id={`${id}-modele`}
          className={CHAMP}
          value={choix}
          onChange={(e) => setChoix(e.target.value)}
        >
          {modeles.map((m) => (
            <option key={m.id} value={m.id}>
              {LIBELLES_LISTE[m.kind]} — {m.label} ({m.items.length} éléments)
            </option>
          ))}
        </select>
      </Champ>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={BOUTON_PETIT} onClick={onAnnuler} disabled={envoi}>
          Annuler
        </button>
        <button type="submit" className={buttonClasses('primary', 'sm')} disabled={envoi}>
          {envoi ? 'Lancement…' : 'Lancer la liste'}
        </button>
      </div>
    </form>
  );
}

function FormulaireSortie({
  fiche,
  onAnnuler,
  onEnregistre,
}: {
  fiche: ReturnType<typeof useFiche>['fiche'];
  onAnnuler: () => void;
  onEnregistre: (f: ReturnType<typeof useFiche>['fiche'], listeProposee: boolean) => void;
}): React.ReactElement {
  const id = useId();
  const [f, setF] = useState<FormSortie>({ endDate: '', exitCategory: '' });
  const [erreurs, setErreurs] = useState<Partial<Record<keyof FormSortie, string>>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    const r = validerSortie(f, fiche);
    if (!r.ok) {
      setErreurs(r.erreurs);
      return;
    }
    setErreurs({});
    setErreur(null);
    setEnvoi(true);
    try {
      const res = await hrAdminApi.exitEmployee(fiche.id, r.corps);
      onEnregistre(res.employee, res.offboardingSuggested);
    } catch (err) {
      setErreur(messageRh(err, 'La sortie n’a pas pu être enregistrée.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void envoyer(e)} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Champ id={`${id}-date`} label="Date de sortie" requis erreur={erreurs.endDate}>
          <input
            id={`${id}-date`}
            type="date"
            className={CHAMP}
            value={f.endDate}
            onChange={(e) => setF({ ...f, endDate: e.target.value })}
            {...aria(`${id}-date`, erreurs.endDate)}
          />
        </Champ>
        <Champ
          id={`${id}-nature`}
          label="Nature de la sortie"
          requis
          erreur={erreurs.exitCategory}
          aide="Sert aux rapports. Le motif détaillé se note dans les données sensibles."
        >
          <select
            id={`${id}-nature`}
            className={CHAMP}
            value={f.exitCategory}
            onChange={(e) =>
              setF({ ...f, exitCategory: e.target.value as FormSortie['exitCategory'] })
            }
            {...aria(`${id}-nature`, erreurs.exitCategory, true)}
          >
            <option value="">Choisir…</option>
            {CATEGORIES_SORTIE.map((c) => (
              <option key={c} value={c}>
                {LIBELLES_SORTIE[c]}
              </option>
            ))}
          </select>
        </Champ>
      </div>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={BOUTON_PETIT} onClick={onAnnuler} disabled={envoi}>
          Annuler
        </button>
        <button type="submit" className={buttonClasses('primary', 'sm')} disabled={envoi}>
          {envoi ? 'Enregistrement…' : 'Enregistrer la sortie'}
        </button>
      </div>
    </form>
  );
}

function Anonymisation({
  nom,
  onFermer,
  onConfirmer,
}: {
  nom: string;
  onFermer: () => void;
  onConfirmer: () => Promise<void>;
}): React.ReactElement {
  const id = useId();
  const [saisie, setSaisie] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const ok = confirmationAnonymisation(saisie, nom);

  async function confirmer(): Promise<void> {
    if (!ok) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await onConfirmer();
    } catch (err) {
      setErreur(messageRh(err, 'L’anonymisation a échoué : rien n’a été effacé.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title={`Anonymiser le dossier de ${nom} ?`}
      size="sm"
      busy={envoi}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BOUTON_PETIT} onClick={onFermer} disabled={envoi}>
            Annuler
          </button>
          <button
            type="button"
            className={BOUTON_DANGER}
            disabled={!ok || envoi}
            onClick={() => void confirmer()}
          >
            {envoi ? 'Anonymisation…' : 'Anonymiser définitivement'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>{PHRASE_ANONYMISATION}</p>
        <Champ
          id={`${id}-nom`}
          label={`Pour confirmer, tapez « ${nom} »`}
          aide="Le bouton s’active quand le nom est retapé à l’identique."
        >
          <input
            id={`${id}-nom`}
            className={CHAMP}
            value={saisie}
            autoComplete="off"
            onChange={(e) => setSaisie(e.target.value)}
            {...aria(`${id}-nom`, undefined, true)}
          />
        </Champ>
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
      </div>
    </Modal>
  );
}
