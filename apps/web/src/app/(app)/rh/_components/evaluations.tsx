'use client';

// « Évaluations » — ADR-0051 § 2.6, § 3.5, § 4, § 10 (lot H16).
//
// Visible seulement avec `performance.read` effectif ou pour la personne concernée
// (l'évalué, l'évaluateur). Les listes ne portent que des STATUTS ; le contenu vient
// de « Afficher » (`POST /hr/reviews/:id/reveal`, journalisé), ne vit que dans l'état de
// la fenêtre et s'efface dès que l'onglet est quitté. Aucune note n'est produite :
// une note est choisie par l'évaluateur dans l'échelle saisie par l'organisation.
// L'évalué et l'évaluateur ne clôturent pas.
//
// ADR-0074 : réponses en `TextArea`, note en `Select` (échelle de l'organisation),
// période et échéance en `DatePicker`, auto-évaluation en interrupteur, personnes
// évaluées en cases stylées.

import {
  Badge,
  Checkbox,
  DatePicker,
  Field,
  FormGrid,
  Modal,
  Select,
  Switch,
  TextArea,
  TextInput,
  buttonClasses,
} from '@lalanda/ui';
import { ClipboardList, Users } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';

import { HR_DEFAULT_REVIEW_TEMPLATE_TITLES, type ReviewSection } from '@lalanda/shared/hr';

import { hrApi, type HrEmployeeListItem } from '@/lib/api-hr';
import {
  rh2Api,
  type HrPerformanceSettingsView,
  type ReviewCycleView,
  type ReviewListItemView,
  type ReviewRevealView,
  type ReviewSectionContentView,
} from '@/lib/api-rh-2';

import { BOUTON_PETIT } from '../../ventes/_components/form-ui';

import {
  LIBELLES_SECTION,
  LIBELLES_STATUT_EVALUATION,
  MENTION_AUCUNE_NOTE,
  MENTION_PRISE_DE_CONNAISSANCE,
  accesEvaluations,
  etapesOffertes,
  peutGererCampagnes,
  peutLirePerformance,
  rolesSur,
  sectionsEditables,
  sectionsLisibles,
  valeursEchelle,
} from './evaluations-model';
import { type Moi } from './frais-model';
import { useAccesRh } from './rh-access';
import { messageRh2 } from './rh2-model';
import { Carte, ErreurAction, FonctionEteinte, GrilleCartes, useMoi, useNoms } from './rh2-ui';
import { aujourdhui, formatJour, lire, nomAffiche, type Lecture, type Ton } from './rh-model';
import { Bandeau, Chargement, EchecLecture, Panneau, PhraseSection } from './rh-ui';

function tonEvaluation(s: ReviewListItemView['status']): Ton {
  if (s === 'closed') return 'success';
  if (s === 'cancelled') return 'neutral';
  if (s === 'shared') return 'warning';
  return 'info';
}

export function Evaluations(): React.ReactElement {
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
        icone={ClipboardList}
        titre="Évaluations"
        sousTitre={`L’entretien périodique : une trame saisie par votre organisation, une auto-évaluation, l’appréciation de l’évaluateur, une prise de connaissance. ${MENTION_AUCUNE_NOTE}`}
      />
      {reglages === null ? (
        <Chargement />
      ) : !reglages.ok ? (
        <EchecLecture erreur={reglages.erreur} repli="Réglages illisibles." />
      ) : !reglages.valeur.enabled ? (
        <FonctionEteinte fonction="performance" actions={actions} />
      ) : (
        <EvaluationsActives />
      )}
    </section>
  );
}

function EvaluationsActives(): React.ReactElement {
  const { actions } = useAccesRh();
  const moi = useMoi();
  const noms = useNoms(
    peutLirePerformance(actions) && (actions?.includes('hr.read') ?? false),
    moi.estManager,
  );
  const gestion = peutGererCampagnes(actions);
  const [miennes, setMiennes] = useState<ReviewListItemView[] | null>(null);
  const [aRediger, setARediger] = useState<ReviewListItemView[]>([]);
  const [toutes, setToutes] = useState<ReviewListItemView[]>([]);
  const [campagnes, setCampagnes] = useState<ReviewCycleView[]>([]);
  const [erreur, setErreur] = useState<unknown>(null);
  const [ouverte, setOuverte] = useState<ReviewListItemView | null>(null);
  const [nouvelle, setNouvelle] = useState(false);
  const [version, setVersion] = useState(0);
  const relire = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let annule = false;
    Promise.all([
      rh2Api.listReviews({ mine: 'true' }),
      rh2Api.listReviews({ toWrite: 'true' }),
      peutLirePerformance(actions) ? rh2Api.listReviews() : Promise.resolve({ items: [] }),
      gestion ? rh2Api.listReviewCycles() : Promise.resolve({ items: [] }),
    ])
      .then(([m, w, t, c]) => {
        if (annule) return;
        setMiennes(m.items);
        setARediger(w.items);
        setToutes(t.items);
        setCampagnes(c.items);
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(err);
      });
    return () => {
      annule = true;
    };
  }, [actions, gestion, version]);

  if (erreur)
    return <EchecLecture erreur={erreur} repli="Évaluations illisibles." onReessayer={relire} />;
  if (miennes === null) return <Chargement />;
  const acces = accesEvaluations(actions, [...miennes, ...aRediger]);
  if (acces === 'aucun') {
    return <PhraseSection>Aucune évaluation ne vous concerne pour le moment.</PhraseSection>;
  }

  const campagneDe = (id: string): ReviewCycleView | undefined =>
    campagnes.find((c) => c.id === id);
  const cartes = (rs: ReviewListItemView[]): React.ReactElement => (
    <GrilleCartes>
      {rs.map((r) => (
        <Carte
          key={r.id}
          titre={noms.get(r.employeeId) ?? 'Collaborateur'}
          detail={campagneDe(r.cycleId)?.label ?? 'Évaluation'}
          statut={LIBELLES_STATUT_EVALUATION[r.status]}
          ton={tonEvaluation(r.status)}
          onOuvrir={() => setOuverte(r)}
        />
      ))}
    </GrilleCartes>
  );
  const autres = toutes.filter(
    (r) => !miennes.some((m) => m.id === r.id) && !aRediger.some((w) => w.id === r.id),
  );

  return (
    <>
      {gestion ? (
        <Panneau
          titre="Campagnes"
          icone={Users}
          action={
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              onClick={() => setNouvelle(true)}
            >
              + Campagne
            </button>
          }
        >
          {campagnes.length === 0 ? (
            <PhraseSection>
              Aucune campagne. La trame et l’échelle sont saisies par votre organisation.
            </PhraseSection>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)]">
              {campagnes.map((c) => (
                <Campagne key={c.id} campagne={c} onChange={relire} />
              ))}
            </ul>
          )}
        </Panneau>
      ) : null}
      <Panneau titre="À rédiger">
        {aRediger.length === 0 ? <PhraseSection>Rien à rédiger.</PhraseSection> : cartes(aRediger)}
      </Panneau>
      <Panneau titre="Mes évaluations">
        {miennes.length === 0 ? (
          <PhraseSection>Aucune évaluation vous concernant.</PhraseSection>
        ) : (
          cartes(miennes)
        )}
      </Panneau>
      {autres.length > 0 ? (
        <Panneau titre="Toutes les évaluations">{cartes(autres)}</Panneau>
      ) : null}

      {ouverte ? (
        <DetailEvaluation
          evaluation={ouverte}
          nom={noms.get(ouverte.employeeId) ?? 'Collaborateur'}
          avecAutoEvaluation={campagneDe(ouverte.cycleId)?.includesSelfAssessment ?? null}
          moi={moi}
          onFermer={() => setOuverte(null)}
          onChange={(r) => {
            setOuverte(r);
            relire();
          }}
        />
      ) : null}
      {nouvelle ? (
        <NouvelleCampagne
          onFermer={() => setNouvelle(false)}
          onCree={() => {
            setNouvelle(false);
            relire();
          }}
        />
      ) : null}
    </>
  );
}

function Campagne({
  campagne: c,
  onChange,
}: {
  campagne: ReviewCycleView;
  onChange: () => void;
}): React.ReactElement {
  const [erreur, setErreur] = useState<string | null>(null);
  async function agir(f: () => Promise<unknown>): Promise<void> {
    setErreur(null);
    try {
      await f();
      onChange();
    } catch (err) {
      setErreur(messageRh2(err, 'Action impossible.'));
    }
  }
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{c.label}</span>
        <span className="text-xs text-[var(--foreground-muted)]">
          Du {formatJour(c.period.from)} au {formatJour(c.period.to)} · échéance{' '}
          {formatJour(c.dueOn)} · {c.employeeIds.length} personne
          {c.employeeIds.length > 1 ? 's' : ''}
          {c.progress?.counts?.closed !== undefined
            ? ` · ${c.progress.counts.closed} clôturée(s)`
            : ''}
        </span>
        {erreur ? <span className="text-xs text-[var(--danger)]">{erreur}</span> : null}
      </span>
      <Badge tone={c.status === 'open' ? 'info' : 'neutral'}>
        {c.status === 'draft' ? 'Brouillon' : c.status === 'open' ? 'Ouverte' : 'Close'}
      </Badge>
      {c.status === 'draft' ? (
        <button
          type="button"
          className={BOUTON_PETIT}
          onClick={() => void agir(() => rh2Api.openReviewCycle(c.id, c.revision))}
        >
          Ouvrir
        </button>
      ) : null}
      {c.status === 'open' ? (
        <button
          type="button"
          className={BOUTON_PETIT}
          onClick={() => void agir(() => rh2Api.closeReviewCycle(c.id, c.revision))}
        >
          Clore la campagne
        </button>
      ) : null}
    </li>
  );
}

function DetailEvaluation({
  evaluation: r,
  nom,
  avecAutoEvaluation,
  moi,
  onFermer,
  onChange,
}: {
  evaluation: ReviewListItemView;
  nom: string;
  avecAutoEvaluation: boolean | null;
  moi: Moi;
  onFermer: () => void;
  onChange: (r: ReviewListItemView) => void;
}): React.ReactElement {
  const { actions } = useAccesRh();
  const roles = rolesSur(r, moi, actions);
  const lisibles = sectionsLisibles(roles, r.status);
  const editables = sectionsEditables(roles, r.status, avecAutoEvaluation);
  const { etapes, phrase } = etapesOffertes(r, roles, actions, avecAutoEvaluation);
  const [contenu, setContenu] = useState<ReviewRevealView | null>(null);
  const [edition, setEdition] = useState<ReviewSection | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  // Le contenu disparaît dès que l'onglet est quitté (§ 10).
  useEffect(() => {
    const masquer = (): void => {
      if (document.visibilityState === 'hidden') {
        setContenu(null);
        setEdition(null);
      }
    };
    document.addEventListener('visibilitychange', masquer);
    return () => document.removeEventListener('visibilitychange', masquer);
  }, []);

  async function afficher(): Promise<void> {
    if (lisibles.length === 0) return;
    setErreur(null);
    setEnvoi(true);
    try {
      setContenu(await rh2Api.revealReview(r.id, lisibles));
    } catch (err) {
      setErreur(messageRh2(err, 'Affichage impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  async function etape(e: (typeof etapes)[number]['etape']): Promise<void> {
    setErreur(null);
    setEnvoi(true);
    try {
      const n = await rh2Api.reviewStep(r.id, e, r.revision);
      setContenu(null);
      onChange(n);
    } catch (err) {
      setErreur(messageRh2(err, 'Étape impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <>
      <Modal
        open={edition === null}
        onClose={onFermer}
        title={`Évaluation de ${nom}`}
        description={LIBELLES_STATUT_EVALUATION[r.status]}
        size="lg"
        busy={envoi}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            {contenu
              ? editables.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={BOUTON_PETIT}
                    onClick={() => setEdition(s)}
                  >
                    Rédiger : {LIBELLES_SECTION[s].toLowerCase()}
                  </button>
                ))
              : null}
            {etapes.map((e) => (
              <button
                key={e.etape}
                type="button"
                className={buttonClasses('primary', 'sm')}
                disabled={envoi}
                onClick={() => void etape(e.etape)}
              >
                {e.libelle}
              </button>
            ))}
          </div>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p className="rounded-[var(--radius-md)] border border-[var(--border)] p-3 text-xs">
            {MENTION_AUCUNE_NOTE}
            {roles.self && r.status === 'shared' ? ` ${MENTION_PRISE_DE_CONNAISSANCE}` : ''}
          </p>
          {phrase ? (
            <p className="rounded-[var(--radius-md)] border border-[var(--warn)]/50 p-3">
              {phrase}
            </p>
          ) : null}
          {contenu === null ? (
            lisibles.length > 0 ? (
              <button
                type="button"
                className={`${BOUTON_PETIT} self-start`}
                disabled={envoi}
                onClick={() => void afficher()}
              >
                Afficher le contenu (lecture journalisée)
              </button>
            ) : (
              <PhraseSection>Rien à afficher pour vous à cette étape.</PhraseSection>
            )
          ) : (
            <>
              {contenu.closedUnsigned ? (
                <p className="text-xs">Clôturée sans signature de prise de connaissance.</p>
              ) : null}
              {lisibles.map((s) => (
                <SectionAffichee
                  key={s}
                  section={s}
                  contenu={contenu.sections[s] ?? null}
                  trame={contenu.template.sections}
                />
              ))}
              {contenu.goalSnapshot && contenu.goalSnapshot.length > 0 ? (
                <div>
                  <p className="text-xs font-semibold uppercase text-[var(--foreground-muted)]">
                    Objectifs de la période
                  </p>
                  <ul className="list-disc pl-5 text-xs">
                    {contenu.goalSnapshot.map((g) => (
                      <li key={g.goalId}>{g.title}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
          <ErreurAction erreur={erreur} />
        </div>
      </Modal>
      {edition && contenu ? (
        <RedactionSection
          evaluation={r}
          section={edition}
          trame={contenu.template.sections}
          initial={contenu.sections[edition] ?? null}
          onFermer={() => setEdition(null)}
          onFaite={(n) => {
            setEdition(null);
            setContenu(null);
            onChange(n);
          }}
        />
      ) : null}
    </>
  );
}

function SectionAffichee({
  section,
  contenu,
  trame,
}: {
  section: ReviewSection;
  contenu: ReviewSectionContentView | null;
  trame: ReviewRevealView['template']['sections'];
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
      <p className="text-xs font-semibold uppercase text-[var(--foreground-muted)]">
        {LIBELLES_SECTION[section]}
      </p>
      {contenu === null ? (
        <p className="text-xs text-[var(--foreground-muted)]">Pas encore rédigé.</p>
      ) : (
        <>
          {Object.entries(contenu.answers).map(([k, v]) => (
            <p key={k} className="whitespace-pre-wrap">
              <span className="font-medium">
                {trame.find((t) => t.id === k)?.title ?? 'Commentaire'} :{' '}
              </span>
              {v}
            </p>
          ))}
          {contenu.ratings
            ? Object.entries(contenu.ratings).map(([k, v]) => (
                <p key={k} className="text-xs">
                  {trame.find((t) => t.id === k)?.title ?? k} : {v} (choisi par l’évaluateur)
                </p>
              ))
            : null}
          {contenu.overall !== undefined && contenu.overall !== null ? (
            <p className="text-xs">Appréciation générale choisie : {contenu.overall}</p>
          ) : null}
        </>
      )}
    </div>
  );
}

function RedactionSection({
  evaluation,
  section,
  trame,
  initial,
  onFermer,
  onFaite,
}: {
  evaluation: ReviewListItemView;
  section: ReviewSection;
  trame: ReviewRevealView['template']['sections'];
  initial: ReviewSectionContentView | null;
  onFermer: () => void;
  onFaite: (r: ReviewListItemView) => void;
}): React.ReactElement {
  const id = useId();
  const avecTrame = section === 'selfAssessment' || section === 'managerAssessment';
  const champs = avecTrame
    ? trame.filter((t) => t.kind !== 'scale')
    : [{ id: 'comment', title: 'Commentaire', kind: 'text' as const }];
  const echelles =
    section === 'managerAssessment' ? trame.filter((t) => t.kind === 'scale' && t.scale) : [];
  const [reponses, setReponses] = useState<Record<string, string>>(initial?.answers ?? {});
  const [notes, setNotes] = useState<Record<string, number>>(initial?.ratings ?? {});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function enregistrer(): Promise<void> {
    setErreur(null);
    setEnvoi(true);
    try {
      const answers = Object.fromEntries(
        Object.entries(reponses).filter(([, v]) => v.trim() !== ''),
      );
      const n = await rh2Api.writeReviewSection(evaluation.id, section, {
        expectedRevision: evaluation.revision,
        answers,
        ...(echelles.length > 0 ? { ratings: notes } : {}),
      });
      onFaite(n);
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
      title={LIBELLES_SECTION[section]}
      description="Le texte est chiffré ; il n’apparaît dans aucune liste, notification ni résumé."
      size="lg"
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
            onClick={() => void enregistrer()}
          >
            {envoi ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <FormGrid>
          {champs.map((c) => (
            <Field key={c.id} id={`${id}-${c.id}`} label={c.title} size="full">
              <TextArea
                rows={4}
                value={reponses[c.id] ?? ''}
                maxLength={20000}
                onChange={(e) => setReponses((r) => ({ ...r, [c.id]: e.target.value }))}
              />
            </Field>
          ))}
          {echelles.map((c) => (
            <Field
              key={c.id}
              id={`${id}-n-${c.id}`}
              label={`${c.title} — votre choix`}
              size="lg"
              newRow
              hint="Aucune note n’est proposée ni calculée."
            >
              <Select<string>
                value={notes[c.id] === undefined ? '' : String(notes[c.id])}
                onChange={(v) =>
                  setNotes((n) => {
                    const copie = { ...n };
                    if (v === '') delete copie[c.id];
                    else copie[c.id] = Number(v);
                    return copie;
                  })
                }
                options={[
                  { value: '', label: '— Pas de note —' },
                  ...valeursEchelle(c.scale!).map((v) => ({
                    value: String(v.valeur),
                    label: v.libelle,
                  })),
                ]}
              />
            </Field>
          ))}
        </FormGrid>
        <ErreurAction erreur={erreur} />
      </div>
    </Modal>
  );
}

function NouvelleCampagne({
  onFermer,
  onCree,
}: {
  onFermer: () => void;
  onCree: () => void;
}): React.ReactElement {
  const id = useId();
  const jour = aujourdhui();
  const [libelle, setLibelle] = useState('');
  const [du, setDu] = useState(`${jour.slice(0, 4)}-01-01`);
  const [au, setAu] = useState(`${jour.slice(0, 4)}-12-31`);
  const [echeance, setEcheance] = useState(jour);
  const [auto, setAuto] = useState(true);
  const [personnes, setPersonnes] = useState<HrEmployeeListItem[]>([]);
  const [choisis, setChoisis] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    let annule = false;
    hrApi
      .listEmployees({ status: 'active', limit: 200 })
      .then((p) => {
        if (!annule) setPersonnes(p.items);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, []);

  async function creer(): Promise<void> {
    if (libelle.trim() === '') {
      setErreur('Donnez un nom à la campagne.');
      return;
    }
    // Les dates étaient `required` en natif : même exigence avant l'envoi.
    if (du === '' || au === '' || echeance === '') {
      setErreur('Renseignez la période et l’échéance.');
      return;
    }
    setErreur(null);
    setEnvoi(true);
    try {
      await rh2Api.createReviewCycle({
        label: libelle.trim(),
        period: { from: du, to: au },
        // Modèle vide : des titres seulement, sans échelle ni critère imposés (§ 2.6).
        template: {
          sections: HR_DEFAULT_REVIEW_TEMPLATE_TITLES.map((title, i) => ({
            id: `section_${i + 1}`,
            title,
            kind: title === 'Objectifs' ? ('goals' as const) : ('text' as const),
          })),
        },
        includesSelfAssessment: auto,
        openOn: jour,
        dueOn: echeance,
        employeeIds: choisis,
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
      title="Nouvelle campagne"
      description="Une trame vide (titres seulement) : aucune échelle ni aucun critère n’est imposé. La campagne reste un brouillon jusqu’à son ouverture."
      size="lg"
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
            {envoi ? 'Enregistrement…' : 'Créer le brouillon'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <FormGrid>
          <Field id={`${id}-l`} label="Nom" required size="lg">
            <TextInput
              value={libelle}
              maxLength={120}
              onChange={(e) => setLibelle(e.target.value)}
            />
          </Field>
          <Field id={`${id}-du`} label="Période : du" required size="sm" newRow>
            <DatePicker value={du} onChange={setDu} required />
          </Field>
          <Field id={`${id}-au`} label="au" required size="sm">
            <DatePicker value={au} onChange={setAu} required />
          </Field>
          <Field id={`${id}-e`} label="Échéance" required size="sm">
            <DatePicker
              value={echeance}
              onChange={setEcheance}
              required
              shortcuts={['today', 'endOfMonth', 'plus30']}
            />
          </Field>
        </FormGrid>
        <Switch checked={auto} onChange={setAuto} label="Prévoir une auto-évaluation" />
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold">Personnes évaluées</legend>
          {personnes.length === 0 ? (
            <PhraseSection>Aucun collaborateur actif lisible.</PhraseSection>
          ) : (
            <div className="grid max-h-60 gap-1 overflow-y-auto sm:grid-cols-2">
              {personnes.map((p) => (
                <Checkbox
                  key={p.id}
                  checked={choisis.includes(p.id)}
                  onChange={(coche) =>
                    setChoisis((c) => (coche ? [...c, p.id] : c.filter((x) => x !== p.id)))
                  }
                  label={nomAffiche(p)}
                />
              ))}
            </div>
          )}
        </fieldset>
        <ErreurAction erreur={erreur} />
      </div>
    </Modal>
  );
}
