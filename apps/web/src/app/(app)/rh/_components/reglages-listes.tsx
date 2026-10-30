'use client';

// Réglages RH, référentiels (ADR-0045 § 2.5, § 2.6, § 2.9), lot H7 : types
// d'absence, jours fériés (liste VIDE par défaut : Lalanda ne publie aucun
// calendrier légal), modèles de listes d'accueil et de départ. Créations et
// modifications en fenêtre modale ; l'API reste juge.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { CalendarDays, ClipboardList, Tags } from 'lucide-react';
import { useEffect, useState } from 'react';

import { HR_CHECKLIST_ASSIGNEE_ROLES } from '@lalanda/shared/hr';

import {
  hrAdminApi,
  type ChecklistTemplateView,
  type HolidayView,
  type LeaveTypeFull,
} from '@/lib/api-hr-admin';

import { Alerte, BOUTON_DANGER, BOUTON_PETIT, CHAMP } from '../../ventes/_components/form-ui';

import { LIBELLES_LISTE, libelleAssigneModele, libelleDecalage } from './parcours-model';
import {
  FORM_FERIE_VIDE,
  LIGNE_MODELE_VIDE,
  formModele,
  formTypeAbsence,
  libelleFerie,
  resumeTypeAbsence,
  validerFerie,
  validerModele,
  validerTypeAbsence,
  type FormFerie,
  type FormModele,
  type FormTypeAbsence,
} from './reglages-model';
import { aujourdhui, lire, messageRh, type Lecture } from './rh-model';
import { Chargement, DialogueDecision, EchecLecture, Panneau, PhraseSection } from './rh-ui';

const LABEL = 'flex min-w-0 flex-col gap-1 text-xs font-medium';

function Erreurs({ erreurs }: { erreurs: string[] }): React.ReactElement | null {
  if (erreurs.length === 0) return null;
  return (
    <Alerte>
      <ul className="list-disc pl-4">
        {erreurs.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </Alerte>
  );
}

function Pied({
  envoi,
  onAnnuler,
  libelle = 'Enregistrer',
}: {
  envoi: boolean;
  onAnnuler: () => void;
  libelle?: string;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className={BOUTON_PETIT} onClick={onAnnuler} disabled={envoi}>
        Annuler
      </button>
      <button type="submit" className={buttonClasses('primary', 'sm')} disabled={envoi}>
        {envoi ? 'Enregistrement…' : libelle}
      </button>
    </div>
  );
}

function Case({
  label,
  aide,
  checked,
  onChange,
}: {
  label: string;
  aide?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): React.ReactElement {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="font-medium">{label}</span>
        {aide ? <span className="block text-xs text-[var(--foreground-muted)]">{aide}</span> : null}
      </span>
    </label>
  );
}

/** Une lecture de liste rechargée à la demande. */
function useListe<T>(charger: () => Promise<T[]>): {
  lecture: Lecture<T[]> | null;
  recharger: () => void;
} {
  const [lecture, setLecture] = useState<Lecture<T[]> | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let annule = false;
    void lire(charger()).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
    // `charger` est stable pour chaque appelant (fonction de module).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  return { lecture, recharger: () => setVersion((v) => v + 1) };
}

// ── Types d'absence ─────────────────────────────────────────────────────────

const chargerTypes = (): Promise<LeaveTypeFull[]> =>
  hrAdminApi.listLeaveTypes('all').then((r) => r.items);

export function TypesAbsenceReglages({ modifier }: { modifier: boolean }): React.ReactElement {
  const { lecture, recharger } = useListe(chargerTypes);
  const [edition, setEdition] = useState<LeaveTypeFull | 'nouveau' | null>(null);
  const [aArchiver, setAArchiver] = useState<LeaveTypeFull | null>(null);

  return (
    <Panneau
      titre="Types d’absence"
      icone={Tags}
      id="rh-reg-types"
      action={
        modifier ? (
          <button
            type="button"
            className={buttonClasses('secondary', 'sm')}
            aria-haspopup="dialog"
            onClick={() => setEdition('nouveau')}
          >
            Nouveau type
          </button>
        ) : null
      }
    >
      <p className="text-xs text-[var(--foreground-muted)]">
        Aucun droit à congé n’est posé par Lalanda : par défaut, aucun type n’acquiert de jours. Les
        valeurs d’acquisition, de report et de plafond sont celles que vous saisissez.
      </p>
      {lecture === null ? (
        <Chargement />
      ) : !lecture.ok ? (
        <EchecLecture erreur={lecture.erreur} repli="Types illisibles." onReessayer={recharger} />
      ) : lecture.valeur.length === 0 ? (
        <PhraseSection>Aucun type d’absence.</PhraseSection>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lecture.valeur.map((t) => (
            <li
              key={t.id}
              className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3 text-sm"
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold break-words">{t.label}</span>
                {t.active ? null : <Badge tone="neutral">Archivé</Badge>}
              </span>
              <ul className="flex flex-col text-xs text-[var(--foreground-muted)]">
                {resumeTypeAbsence(t).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              {modifier && t.active ? (
                <span className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={BOUTON_PETIT}
                    aria-haspopup="dialog"
                    onClick={() => setEdition(t)}
                  >
                    Modifier<span className="sr-only"> {t.label}</span>
                  </button>
                  <button
                    type="button"
                    className={BOUTON_DANGER}
                    aria-haspopup="dialog"
                    onClick={() => setAArchiver(t)}
                  >
                    Archiver<span className="sr-only"> {t.label}</span>
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={modifier && edition !== null}
        onClose={() => setEdition(null)}
        title={edition === 'nouveau' ? 'Nouveau type d’absence' : 'Modifier le type d’absence'}
        size="lg"
      >
        {edition !== null ? (
          <FormulaireType
            type={edition === 'nouveau' ? null : edition}
            onAnnuler={() => setEdition(null)}
            onEnregistre={() => {
              setEdition(null);
              recharger();
            }}
          />
        ) : null}
      </Modal>
      {aArchiver ? (
        <DialogueDecision
          titre={`Archiver « ${aArchiver.label} » ?`}
          libelle=""
          bouton="Archiver"
          commentaire="aucun"
          onFermer={() => setAArchiver(null)}
          onValider={async () => {
            await hrAdminApi.archiveLeaveType(aArchiver.id, aArchiver.revision);
            setAArchiver(null);
            recharger();
          }}
        >
          <p>Le type n’est plus proposé ; les demandes passées le gardent.</p>
        </DialogueDecision>
      ) : null}
    </Panneau>
  );
}

function FormulaireType({
  type,
  onAnnuler,
  onEnregistre,
}: {
  type: LeaveTypeFull | null;
  onAnnuler: () => void;
  onEnregistre: () => void;
}): React.ReactElement {
  const [f, setF] = useState<FormTypeAbsence>(() => formTypeAbsence(type));
  const [erreurs, setErreurs] = useState<string[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const maj = (p: Partial<FormTypeAbsence>): void => setF((x) => ({ ...x, ...p }));

  async function envoyer(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    const r = validerTypeAbsence(f);
    if (!r.ok) {
      setErreurs(r.erreurs);
      return;
    }
    setErreurs([]);
    setEnvoi(true);
    try {
      if (type) {
        await hrAdminApi.updateLeaveType(type.id, { ...r.corps, expectedRevision: type.revision });
      } else {
        await hrAdminApi.createLeaveType(r.corps);
      }
      onEnregistre();
    } catch (err) {
      setErreurs([messageRh(err, 'Le type n’a pas pu être enregistré.')]);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void envoyer(e)} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          Libellé
          <input
            className={CHAMP}
            value={f.label}
            maxLength={60}
            onChange={(e) => maj({ label: e.target.value })}
          />
        </label>
        <label className={LABEL}>
          Plus petite durée demandable
          <select
            className={CHAMP}
            value={f.unit}
            onChange={(e) => maj({ unit: e.target.value as FormTypeAbsence['unit'] })}
          >
            <option value="day">La journée</option>
            <option value="half_day">La demi-journée</option>
          </select>
        </label>
      </div>
      <Case
        label="Débite un solde"
        checked={f.deductsFromBalance}
        onChange={(v) => maj({ deductsFromBalance: v })}
      />
      {f.deductsFromBalance ? (
        <fieldset className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <legend className="px-1 text-xs font-semibold">
            Solde (valeurs de votre organisation)
          </legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={LABEL}>
              Acquisition
              <select
                className={CHAMP}
                value={f.acquisition}
                onChange={(e) =>
                  maj({ acquisition: e.target.value as FormTypeAbsence['acquisition'] })
                }
              >
                <option value="none">Aucune (attributions manuelles)</option>
                <option value="monthly">Chaque mois</option>
                <option value="yearly">Chaque année</option>
              </select>
            </label>
            {f.acquisition !== 'none' ? (
              <label className={LABEL}>
                Jours acquis
                <input
                  inputMode="decimal"
                  className={CHAMP}
                  value={f.jours}
                  onChange={(e) => maj({ jours: e.target.value })}
                />
              </label>
            ) : null}
            {f.acquisition === 'yearly' ? (
              <label className={LABEL}>
                Acquis
                <select
                  className={CHAMP}
                  value={f.le}
                  onChange={(e) => maj({ le: e.target.value as FormTypeAbsence['le'] })}
                >
                  <option value="leave_year_start">au début de l’année de congé</option>
                  <option value="anniversary">à la date anniversaire d’entrée</option>
                </select>
              </label>
            ) : null}
            {f.acquisition !== 'none' ? (
              <label className={LABEL}>
                Prorata
                <select
                  className={CHAMP}
                  value={f.proration}
                  onChange={(e) =>
                    maj({ proration: e.target.value as FormTypeAbsence['proration'] })
                  }
                >
                  <option value="calendar_days">Au prorata des jours de présence</option>
                  <option value="none">Sans prorata</option>
                </select>
              </label>
            ) : null}
            <label className={LABEL}>
              Report maximal (jours, vide = illimité)
              <input
                inputMode="decimal"
                className={CHAMP}
                value={f.reportMax}
                onChange={(e) => maj({ reportMax: e.target.value })}
              />
            </label>
            <label className={LABEL}>
              Report perdu après (mois, vide = jamais)
              <input
                inputMode="numeric"
                className={CHAMP}
                value={f.reportExpireMois}
                onChange={(e) => maj({ reportExpireMois: e.target.value })}
              />
            </label>
          </div>
          <Case
            label="Solde négatif permis"
            checked={f.allowNegative}
            onChange={(v) => maj({ allowNegative: v })}
          />
        </fieldset>
      ) : null}
      <Case
        label="Confidentiel"
        aide="Le type et le motif ne se lisent qu’aux ressources humaines et au collaborateur ; ailleurs : « Absent ». Validé par les RH seules."
        checked={f.confidential}
        onChange={(v) => maj({ confidential: v })}
      />
      <Case
        label="Ajouter l’étape RH"
        aide="Les ressources humaines valident après le manager."
        checked={f.requiresHrApproval}
        onChange={(v) => maj({ requiresHrApproval: v })}
      />
      <Case
        label="Justificatif demandé"
        aide="Non bloquant : l’écran le rappelle."
        checked={f.requiresDocument}
        onChange={(v) => maj({ requiresDocument: v })}
      />
      <Case
        label="Compté dans l’absentéisme"
        checked={f.countsAsAbsenteeism}
        onChange={(v) => maj({ countsAsAbsenteeism: v })}
      />
      <Case
        label="Saisi par les RH seulement"
        checked={f.hrOnly}
        onChange={(v) => maj({ hrOnly: v })}
      />
      <Erreurs erreurs={erreurs} />
      <Pied envoi={envoi} onAnnuler={onAnnuler} libelle={type ? 'Enregistrer' : 'Créer le type'} />
    </form>
  );
}

// ── Jours fériés ────────────────────────────────────────────────────────────

export function FeriesReglages({ modifier }: { modifier: boolean }): React.ReactElement {
  const annee = Number(aujourdhui().slice(0, 4));
  const [an, setAn] = useState(annee);
  const [lecture, setLecture] = useState<Lecture<HolidayView[]> | null>(null);
  const [version, setVersion] = useState(0);
  const [creation, setCreation] = useState(false);
  const [aSupprimer, setASupprimer] = useState<HolidayView | null>(null);

  useEffect(() => {
    let annule = false;
    void lire(hrAdminApi.listHolidays(an).then((r) => r.items)).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [an, version]);

  return (
    <Panneau
      titre="Jours fériés et de fermeture"
      icone={CalendarDays}
      id="rh-reg-feries"
      action={
        <span className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Année"
            className={`${CHAMP} w-auto`}
            value={an}
            onChange={(e) => setAn(Number(e.target.value))}
          >
            {[annee - 1, annee, annee + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          {modifier ? (
            <button
              type="button"
              className={buttonClasses('secondary', 'sm')}
              aria-haspopup="dialog"
              onClick={() => setCreation(true)}
            >
              Ajouter un jour
            </button>
          ) : null}
        </span>
      }
    >
      <p className="text-xs text-[var(--foreground-muted)]">
        Liste vide par défaut : Lalanda ne publie pas le calendrier légal des jours fériés.
        Saisissez ceux que votre organisation observe ; ils ne sont pas décomptés des absences.
      </p>
      {lecture === null ? (
        <Chargement />
      ) : !lecture.ok ? (
        <EchecLecture
          erreur={lecture.erreur}
          repli="Jours fériés illisibles."
          onReessayer={() => setVersion((v) => v + 1)}
        />
      ) : lecture.valeur.length === 0 ? (
        <PhraseSection>Aucun jour férié saisi pour {an}.</PhraseSection>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
          {lecture.valeur.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-medium break-words">{h.label}</span>
                <span className="block text-xs text-[var(--foreground-muted)]">
                  {libelleFerie(h)}
                </span>
              </span>
              {modifier ? (
                <button
                  type="button"
                  className={BOUTON_DANGER}
                  aria-haspopup="dialog"
                  onClick={() => setASupprimer(h)}
                >
                  Retirer<span className="sr-only"> {h.label}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={modifier && creation}
        onClose={() => setCreation(false)}
        title="Ajouter un jour férié ou de fermeture"
        size="sm"
      >
        <FormulaireFerie
          onAnnuler={() => setCreation(false)}
          onEnregistre={() => {
            setCreation(false);
            setVersion((v) => v + 1);
          }}
        />
      </Modal>
      {aSupprimer ? (
        <DialogueDecision
          titre={`Retirer « ${aSupprimer.label} » ?`}
          libelle=""
          bouton="Retirer"
          commentaire="aucun"
          onFermer={() => setASupprimer(null)}
          onValider={async () => {
            await hrAdminApi.deleteHoliday(aSupprimer.id);
            setASupprimer(null);
            setVersion((v) => v + 1);
          }}
        >
          <p>Les absences déjà décomptées ne sont pas recalculées.</p>
        </DialogueDecision>
      ) : null}
    </Panneau>
  );
}

function FormulaireFerie({
  onAnnuler,
  onEnregistre,
}: {
  onAnnuler: () => void;
  onEnregistre: () => void;
}): React.ReactElement {
  const [f, setF] = useState<FormFerie>(FORM_FERIE_VIDE);
  const [erreurs, setErreurs] = useState<string[]>([]);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    const r = validerFerie(f);
    if (!r.ok) {
      setErreurs(r.erreurs);
      return;
    }
    setErreurs([]);
    setEnvoi(true);
    try {
      await hrAdminApi.createHoliday(r.corps);
      onEnregistre();
    } catch (err) {
      setErreurs([messageRh(err, 'Le jour n’a pas pu être ajouté.')]);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => void envoyer(e)} noValidate>
      <label className={LABEL}>
        Date
        <input
          type="date"
          className={CHAMP}
          value={f.date}
          onChange={(e) => setF({ ...f, date: e.target.value })}
        />
      </label>
      <label className={LABEL}>
        Libellé
        <input
          className={CHAMP}
          value={f.label}
          maxLength={80}
          onChange={(e) => setF({ ...f, label: e.target.value })}
        />
      </label>
      <label className={LABEL}>
        Durée
        <select
          className={CHAMP}
          value={f.demi}
          onChange={(e) => setF({ ...f, demi: e.target.value as FormFerie['demi'] })}
        >
          <option value="">Journée entière</option>
          <option value="am">Matin seulement</option>
          <option value="pm">Après-midi seulement</option>
        </select>
      </label>
      <Case
        label="Chaque année à la même date"
        checked={f.recurring}
        onChange={(v) => setF({ ...f, recurring: v })}
      />
      <Erreurs erreurs={erreurs} />
      <Pied envoi={envoi} onAnnuler={onAnnuler} libelle="Ajouter" />
    </form>
  );
}

// ── Modèles de listes ───────────────────────────────────────────────────────

const chargerModeles = (): Promise<ChecklistTemplateView[]> =>
  hrAdminApi.listChecklistTemplates().then((r) => r.items);

export function ModelesReglages({ modifier }: { modifier: boolean }): React.ReactElement {
  const { lecture, recharger } = useListe(chargerModeles);
  const [edition, setEdition] = useState<ChecklistTemplateView | 'nouveau' | null>(null);
  const [aSupprimer, setASupprimer] = useState<ChecklistTemplateView | null>(null);

  return (
    <Panneau
      titre="Modèles de listes d’accueil et de départ"
      icone={ClipboardList}
      id="rh-reg-modeles"
      action={
        modifier ? (
          <button
            type="button"
            className={buttonClasses('secondary', 'sm')}
            aria-haspopup="dialog"
            onClick={() => setEdition('nouveau')}
          >
            Nouveau modèle
          </button>
        ) : null
      }
    >
      <p className="text-xs text-[var(--foreground-muted)]">
        Libellés sans portée légale. L’élément « accès Lalanda retiré » n’agit pas seul : il
        rappelle de le faire depuis la page des membres.
      </p>
      {lecture === null ? (
        <Chargement />
      ) : !lecture.ok ? (
        <EchecLecture erreur={lecture.erreur} repli="Modèles illisibles." onReessayer={recharger} />
      ) : lecture.valeur.length === 0 ? (
        <PhraseSection>Aucun modèle.</PhraseSection>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {lecture.valeur.map((m) => (
            <li
              key={m.id}
              className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3 text-sm"
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold break-words">{m.label}</span>
                <Badge tone="info">{LIBELLES_LISTE[m.kind]}</Badge>
              </span>
              <ol className="flex list-decimal flex-col gap-0.5 pl-5 text-xs">
                {m.items.map((i) => (
                  <li key={i.id}>
                    {i.label}{' '}
                    <span className="text-[var(--foreground-muted)]">
                      — {libelleAssigneModele(i.assignee)}, {libelleDecalage(i.offsetDays, m.kind)}
                    </span>
                  </li>
                ))}
              </ol>
              {modifier ? (
                <span className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={BOUTON_PETIT}
                    aria-haspopup="dialog"
                    onClick={() => setEdition(m)}
                  >
                    Modifier<span className="sr-only"> {m.label}</span>
                  </button>
                  <button
                    type="button"
                    className={BOUTON_DANGER}
                    aria-haspopup="dialog"
                    onClick={() => setASupprimer(m)}
                  >
                    Supprimer<span className="sr-only"> {m.label}</span>
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={modifier && edition !== null}
        onClose={() => setEdition(null)}
        title={edition === 'nouveau' ? 'Nouveau modèle de liste' : 'Modifier le modèle'}
        size="lg"
      >
        {edition !== null ? (
          <FormulaireModele
            modele={edition === 'nouveau' ? null : edition}
            onAnnuler={() => setEdition(null)}
            onEnregistre={() => {
              setEdition(null);
              recharger();
            }}
          />
        ) : null}
      </Modal>
      {aSupprimer ? (
        <DialogueDecision
          titre={`Supprimer le modèle « ${aSupprimer.label} » ?`}
          libelle=""
          bouton="Supprimer"
          commentaire="aucun"
          onFermer={() => setASupprimer(null)}
          onValider={async () => {
            await hrAdminApi.deleteChecklistTemplate(aSupprimer.id);
            setASupprimer(null);
            recharger();
          }}
        >
          <p>Les listes déjà lancées depuis ce modèle sont conservées.</p>
        </DialogueDecision>
      ) : null}
    </Panneau>
  );
}

function FormulaireModele({
  modele,
  onAnnuler,
  onEnregistre,
}: {
  modele: ChecklistTemplateView | null;
  onAnnuler: () => void;
  onEnregistre: () => void;
}): React.ReactElement {
  const [f, setF] = useState<FormModele>(() => formModele(modele));
  const [erreurs, setErreurs] = useState<string[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const majLigne = (i: number, p: Partial<FormModele['items'][number]>): void =>
    setF((x) => ({ ...x, items: x.items.map((l, j) => (j === i ? { ...l, ...p } : l)) }));

  async function envoyer(ev: React.FormEvent): Promise<void> {
    ev.preventDefault();
    const r = validerModele(f, modele);
    if (!r.ok) {
      setErreurs(r.erreurs);
      return;
    }
    setErreurs([]);
    setEnvoi(true);
    try {
      if (modele) {
        await hrAdminApi.updateChecklistTemplate(modele.id, {
          expectedRevision: modele.revision,
          label: r.corps.label,
          items: r.corps.items,
        });
      } else {
        await hrAdminApi.createChecklistTemplate(r.corps);
      }
      onEnregistre();
    } catch (err) {
      setErreurs([messageRh(err, 'Le modèle n’a pas pu être enregistré.')]);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void envoyer(e)} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          Nature
          <select
            className={CHAMP}
            value={f.kind}
            disabled={modele !== null}
            onChange={(e) => setF({ ...f, kind: e.target.value as FormModele['kind'] })}
          >
            <option value="onboarding">{LIBELLES_LISTE.onboarding}</option>
            <option value="offboarding">{LIBELLES_LISTE.offboarding}</option>
          </select>
        </label>
        <label className={LABEL}>
          Libellé
          <input
            className={CHAMP}
            value={f.label}
            maxLength={120}
            onChange={(e) => setF({ ...f, label: e.target.value })}
          />
        </label>
      </div>
      {f.items.map((l, i) => (
        <fieldset
          key={l.id ?? `n-${i}`}
          className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3 sm:grid-cols-2"
        >
          <legend className="px-1 text-xs font-semibold">Élément {i + 1}</legend>
          <label className={`${LABEL} sm:col-span-2`}>
            Libellé
            <input
              className={CHAMP}
              value={l.label}
              maxLength={200}
              onChange={(e) => majLigne(i, { label: e.target.value })}
            />
          </label>
          <label className={LABEL}>
            Assigné à
            <select
              className={CHAMP}
              value={l.assignee}
              onChange={(e) =>
                majLigne(i, { assignee: e.target.value as FormModele['items'][number]['assignee'] })
              }
            >
              {HR_CHECKLIST_ASSIGNEE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {libelleAssigneModele(r)}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Échéance (jours, négatif = avant)
            <input
              inputMode="numeric"
              className={CHAMP}
              value={l.offsetDays}
              onChange={(e) => majLigne(i, { offsetDays: e.target.value })}
            />
          </label>
          <label className={`${LABEL} sm:col-span-2`}>
            Note (facultative)
            <input
              className={CHAMP}
              value={l.note}
              maxLength={500}
              onChange={(e) => majLigne(i, { note: e.target.value })}
            />
          </label>
          <button
            type="button"
            className={`${BOUTON_DANGER} justify-self-start`}
            onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== i) })}
          >
            Retirer l’élément
          </button>
        </fieldset>
      ))}
      {f.items.length < 50 ? (
        <button
          type="button"
          className={`${BOUTON_PETIT} self-start`}
          onClick={() => setF({ ...f, items: [...f.items, { ...LIGNE_MODELE_VIDE }] })}
        >
          Ajouter un élément
        </button>
      ) : null}
      <Erreurs erreurs={erreurs} />
      <Pied
        envoi={envoi}
        onAnnuler={onAnnuler}
        libelle={modele ? 'Enregistrer' : 'Créer le modèle'}
      />
    </form>
  );
}
