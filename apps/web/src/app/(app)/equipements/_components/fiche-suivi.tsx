'use client';

// Maintenance et couvertures d'un équipement (ADR-0046 § 3.3, § 3.4) : listes,
// planification et réalisation d'une intervention, garanties, assurances et
// contrats reliés à un document de la bibliothèque. Toute saisie en fenêtre
// modale (`assets.manage`) ; les coûts n'apparaissent qu'aux rôles qui les voient.
//
// ADR-0074 : grille sémantique, dates en `DatePicker`, natures en `Select`,
// devise en segments, document de la bibliothèque en `EntityPicker` (même
// recherche `POST /documents/search`, sans « + » : un document se dépose depuis
// la bibliothèque).

import {
  Badge,
  DatePicker,
  EntityPicker,
  Field,
  FormGrid,
  Modal,
  SegmentedControl,
  Select,
  SubmitButton,
  Switch,
  TextArea,
  TextInput,
  buttonClasses,
} from '@lalanda/ui';
import { FileText, ShieldCheck, Trash2, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';

import {
  assetsApi,
  type AssetCoverageKind,
  type AssetCoverageView,
  type AssetMaintenanceKind,
  type AssetMaintenanceView,
} from '@/lib/api-assets';
import { documentsApi, type LibraryDocumentView } from '@/lib/api-documents';

import { useShell } from '../../_components/shell-context';
import { Alerte, BOUTON_DANGER, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import {
  LIBELLES_COUVERTURE,
  LIBELLES_EXPIRATION,
  LIBELLES_MAINTENANCE,
  LIBELLES_STATUT_MAINTENANCE,
  formatJour,
  formatMontant,
  jourKinshasa,
  lire,
  messageEquipements,
  peutGererEquipements,
  tonExpiration,
  valeursAffichees,
  type Lecture,
} from './equipements-model';
import { ChampNombre, Chargement, EchecLecture, Panneau, PhraseSection } from './equipements-ui';
import {
  formulaireCouverture,
  preparerCouverture,
  preparerFait,
  preparerMaintenance,
  type FormulaireCouverture,
  type FormulaireFait,
  type FormulaireMaintenance,
} from './fiche-model';

const lienDocument = (id: string): string => `/documents/${encodeURIComponent(id)}`;

// ── Maintenance ─────────────────────────────────────────────────────────────

export function PanneauMaintenance({
  assetId,
  actif,
  onChange,
}: {
  assetId: string;
  /** Équipement non cédé : on peut planifier. */
  actif: boolean;
  onChange: () => void;
}): React.ReactElement {
  const { actions } = useShell();
  const gerer = peutGererEquipements(actions) && actif;
  const [lecture, setLecture] = useState<Lecture<{
    items: AssetMaintenanceView[];
    valuesHidden: boolean;
  }> | null>(null);
  const [version, setVersion] = useState(0);
  const [nouvelle, setNouvelle] = useState(false);
  const [aFaire, setAFaire] = useState<AssetMaintenanceView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    void lire(assetsApi.listMaintenance(assetId)).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [assetId, version]);

  const recharger = (): void => {
    setVersion((v) => v + 1);
    onChange();
  };

  async function annuler(m: AssetMaintenanceView): Promise<void> {
    setErreur(null);
    try {
      await assetsApi.updateMaintenance(assetId, m.id, {
        expectedRevision: m.revision,
        status: 'cancelled',
      });
      recharger();
    } catch (err) {
      setErreur(messageEquipements(err, 'Annulation impossible.'));
    }
  }

  const valeurs = lecture?.ok === true && valeursAffichees(actions, lecture.valeur.valuesHidden);

  return (
    <Panneau
      titre="Maintenance"
      icone={Wrench}
      id="eq-maintenance"
      action={
        gerer ? (
          <button
            type="button"
            className={buttonClasses('secondary', 'sm')}
            aria-haspopup="dialog"
            onClick={() => setNouvelle(true)}
          >
            Nouvelle intervention
          </button>
        ) : null
      }
    >
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {lecture === null ? (
        <Chargement />
      ) : !lecture.ok ? (
        <EchecLecture erreur={lecture.erreur} repli="Les interventions sont illisibles." />
      ) : lecture.valeur.items.length === 0 ? (
        <PhraseSection>Aucune intervention enregistrée.</PhraseSection>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
          {lecture.valeur.items.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{LIBELLES_MAINTENANCE[m.kind]}</span>
                  <Badge
                    tone={
                      m.status === 'done'
                        ? 'success'
                        : m.status === 'cancelled'
                          ? 'neutral'
                          : 'info'
                    }
                  >
                    {LIBELLES_STATUT_MAINTENANCE[m.status]}
                  </Badge>
                  {m.recurrence ? (
                    <span className="text-xs text-[var(--foreground-muted)]">
                      tous les {m.recurrence.everyMonths} mois
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {m.status === 'done'
                    ? `Faite le ${formatJour(m.doneOn)}`
                    : `Prévue le ${formatJour(m.plannedOn)}`}
                  {m.performedBy ? ` · ${m.performedBy}` : ''}
                  {valeurs && m.cost !== null ? ` · ${formatMontant(m.cost, m.currency)}` : ''}
                </span>
                {m.note ? <span className="text-xs break-words">{m.note}</span> : null}
              </div>
              {gerer && m.status === 'planned' ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={BOUTON_PETIT}
                    aria-haspopup="dialog"
                    onClick={() => setAFaire(m)}
                  >
                    Marquer faite
                  </button>
                  <button type="button" className={BOUTON_DANGER} onClick={() => void annuler(m)}>
                    Annuler
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {nouvelle ? (
        <DialogueMaintenance
          assetId={assetId}
          valeurs={valeursAffichees(actions, false)}
          onFermer={() => setNouvelle(false)}
          onFait={() => {
            setNouvelle(false);
            recharger();
          }}
        />
      ) : null}
      {aFaire ? (
        <DialogueFait
          assetId={assetId}
          intervention={aFaire}
          valeurs={valeursAffichees(actions, false)}
          onFermer={() => setAFaire(null)}
          onFait={() => {
            setAFaire(null);
            recharger();
          }}
        />
      ) : null}
    </Panneau>
  );
}

/** Coût informatif et sa devise : deux champs de la grille englobante. */
function CoutDevise({
  id,
  cout,
  devise,
  erreur,
  onCout,
  onDevise,
}: {
  id: string;
  cout: string;
  devise: 'USD' | 'CDF';
  erreur?: string | undefined;
  onCout: (v: string) => void;
  onDevise: (v: 'USD' | 'CDF') => void;
}): React.ReactElement {
  return (
    <>
      <Field
        id={id}
        label="Coût (informatif)"
        size="sm"
        newRow
        error={erreur}
        hint="Ne crée aucune dépense."
      >
        <ChampNombre value={cout} onChange={(e) => onCout(e.target.value)} />
      </Field>
      <Field id={`${id}-devise`} label="Devise" size="sm" group>
        <SegmentedControl<'USD' | 'CDF'>
          value={devise}
          onChange={onDevise}
          options={[
            { value: 'USD', label: 'USD' },
            { value: 'CDF', label: 'CDF' },
          ]}
        />
      </Field>
    </>
  );
}

function DialogueMaintenance({
  assetId,
  valeurs,
  onFermer,
  onFait,
}: {
  assetId: string;
  valeurs: boolean;
  onFermer: () => void;
  onFait: () => void;
}): React.ReactElement {
  const id = useId();
  const [f, setF] = useState<FormulaireMaintenance>({
    kind: 'preventive',
    dejaFaite: false,
    date: jourKinshasa(new Date()),
    cost: '',
    currency: 'USD',
    performedBy: '',
    note: '',
    everyMonths: '',
  });
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function valider(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    const p = preparerMaintenance(valeurs ? f : { ...f, cost: '' });
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      await assetsApi.createMaintenance(assetId, p.corps);
      onFait();
    } catch (err) {
      setErreur(messageEquipements(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal open onClose={onFermer} busy={envoi} title="Nouvelle intervention" size="md">
      <form noValidate onSubmit={(e) => void valider(e)} className="flex flex-col gap-3">
        <FormGrid>
          <Field id={`${id}-nature`} label="Nature" size="md">
            <Select<AssetMaintenanceKind>
              value={f.kind}
              onChange={(v) => setF({ ...f, kind: v })}
              options={Object.entries(LIBELLES_MAINTENANCE).map(([k, l]) => ({
                value: k as AssetMaintenanceKind,
                label: l,
              }))}
            />
          </Field>
          <Field
            id={`${id}-date`}
            label={f.dejaFaite ? 'Faite le' : 'Prévue le'}
            required
            size="sm"
            error={champs['date']}
          >
            <DatePicker
              value={f.date}
              shortcuts={f.dejaFaite ? ['today'] : ['today', 'plus7', 'plus30', 'endOfMonth']}
              onChange={(v) => setF({ ...f, date: v })}
            />
          </Field>
          <div className="@lg:col-span-12">
            <Switch
              checked={f.dejaFaite}
              onChange={(v) => setF({ ...f, dejaFaite: v })}
              label="Intervention déjà faite"
            />
          </div>
          {f.kind === 'preventive' ? (
            <Field
              id={`${id}-recurrence`}
              label="Répéter tous les … mois"
              size="md"
              hint="Vide : pas de répétition. Une fois faite, la suivante est planifiée."
              error={champs['everyMonths']}
            >
              <ChampNombre
                entier
                className="max-w-[8rem]"
                value={f.everyMonths}
                onChange={(e) => setF({ ...f, everyMonths: e.target.value })}
              />
            </Field>
          ) : null}
          <Field id={`${id}-par`} label="Réalisée par" size="md">
            <TextInput
              value={f.performedBy}
              maxLength={120}
              onChange={(e) => setF({ ...f, performedBy: e.target.value })}
            />
          </Field>
          {valeurs ? (
            <CoutDevise
              id={`${id}-cout`}
              cout={f.cost}
              devise={f.currency}
              erreur={champs['cost']}
              onCout={(v) => setF({ ...f, cost: v })}
              onDevise={(v) => setF({ ...f, currency: v })}
            />
          ) : null}
          <Field id={`${id}-note`} label="Note" size="full" optional>
            <TextArea
              rows={2}
              value={f.note}
              maxLength={1000}
              onChange={(e) => setF({ ...f, note: e.target.value })}
            />
          </Field>
        </FormGrid>
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <SubmitButton busy={envoi} busyLabel="Enregistrement…" className="self-start max-sm:w-full">
          Enregistrer
        </SubmitButton>
      </form>
    </Modal>
  );
}

function DialogueFait({
  assetId,
  intervention,
  valeurs,
  onFermer,
  onFait,
}: {
  assetId: string;
  intervention: AssetMaintenanceView;
  valeurs: boolean;
  onFermer: () => void;
  onFait: () => void;
}): React.ReactElement {
  const id = useId();
  const [f, setF] = useState<FormulaireFait>({
    doneOn: jourKinshasa(new Date()),
    cost: intervention.cost ? intervention.cost.replace('.', ',') : '',
    currency: intervention.currency ?? 'USD',
    performedBy: intervention.performedBy ?? '',
    note: intervention.note ?? '',
  });
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function valider(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    const p = preparerFait(valeurs ? f : { ...f, cost: '' }, intervention.revision);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      await assetsApi.completeMaintenance(assetId, intervention.id, p.corps);
      onFait();
    } catch (err) {
      setErreur(messageEquipements(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      busy={envoi}
      title="Intervention faite"
      description={
        intervention.recurrence
          ? `La suivante sera planifiée par Lalanda dans ${intervention.recurrence.everyMonths} mois.`
          : undefined
      }
      size="sm"
    >
      <form noValidate onSubmit={(e) => void valider(e)} className="flex flex-col gap-3">
        <FormGrid>
          <Field id={`${id}-le`} label="Faite le" required size="sm" error={champs['doneOn']}>
            <DatePicker
              value={f.doneOn}
              shortcuts={['today']}
              onChange={(v) => setF({ ...f, doneOn: v })}
            />
          </Field>
          <Field id={`${id}-par`} label="Réalisée par" size="md" newRow>
            <TextInput
              value={f.performedBy}
              maxLength={120}
              onChange={(e) => setF({ ...f, performedBy: e.target.value })}
            />
          </Field>
          {valeurs ? (
            <CoutDevise
              id={`${id}-cout`}
              cout={f.cost}
              devise={f.currency}
              erreur={champs['cost']}
              onCout={(v) => setF({ ...f, cost: v })}
              onDevise={(v) => setF({ ...f, currency: v })}
            />
          ) : null}
          <Field id={`${id}-note`} label="Note" size="full" optional>
            <TextArea
              rows={2}
              value={f.note}
              maxLength={1000}
              onChange={(e) => setF({ ...f, note: e.target.value })}
            />
          </Field>
        </FormGrid>
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <SubmitButton busy={envoi} busyLabel="Enregistrement…" className="self-start max-sm:w-full">
          Enregistrer
        </SubmitButton>
      </form>
    </Modal>
  );
}

// ── Couvertures ─────────────────────────────────────────────────────────────

export function PanneauCouvertures({
  assetId,
  actif,
  onChange,
}: {
  assetId: string;
  actif: boolean;
  onChange: () => void;
}): React.ReactElement {
  const { actions } = useShell();
  const gerer = peutGererEquipements(actions) && actif;
  const lireDocs = actions?.includes('docs.read') ?? false;
  const [lecture, setLecture] = useState<Lecture<{
    items: AssetCoverageView[];
    valuesHidden: boolean;
  }> | null>(null);
  const [version, setVersion] = useState(0);
  const [edition, setEdition] = useState<AssetCoverageView | 'nouvelle' | null>(null);
  const [aSupprimer, setASupprimer] = useState<AssetCoverageView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    let annule = false;
    void lire(assetsApi.listCoverages(assetId)).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [assetId, version]);

  const recharger = (): void => {
    setVersion((v) => v + 1);
    onChange();
  };
  const valeurs = lecture?.ok === true && valeursAffichees(actions, lecture.valeur.valuesHidden);

  async function supprimer(c: AssetCoverageView): Promise<void> {
    setErreur(null);
    setEnvoi(true);
    try {
      await assetsApi.deleteCoverage(assetId, c.id);
      setASupprimer(null);
      recharger();
    } catch (err) {
      setErreur(messageEquipements(err, 'Suppression impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Panneau
      titre="Garanties et assurances"
      icone={ShieldCheck}
      id="eq-couvertures"
      action={
        gerer ? (
          <button
            type="button"
            className={buttonClasses('secondary', 'sm')}
            aria-haspopup="dialog"
            onClick={() => setEdition('nouvelle')}
          >
            Ajouter
          </button>
        ) : null
      }
    >
      {erreur && aSupprimer === null ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {lecture === null ? (
        <Chargement />
      ) : !lecture.ok ? (
        <EchecLecture erreur={lecture.erreur} repli="Les couvertures sont illisibles." />
      ) : lecture.valeur.items.length === 0 ? (
        <PhraseSection>Aucune garantie, assurance ni contrat d’entretien.</PhraseSection>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
          {lecture.valeur.items.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {LIBELLES_COUVERTURE[c.kind]} — {c.provider}
                  </span>
                  <Badge tone={tonExpiration(c.expiry)}>{LIBELLES_EXPIRATION[c.expiry]}</Badge>
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  Du {formatJour(c.startOn)} au {formatJour(c.endOn)}
                  {c.reference ? ` · réf. ${c.reference}` : ''}
                  {valeurs && c.cost !== null ? ` · ${formatMontant(c.cost, c.currency)}` : ''}
                </span>
                {c.documentId ? (
                  lireDocs ? (
                    <Link
                      href={lienDocument(c.documentId)}
                      className="inline-flex items-center gap-1 self-start text-xs underline underline-offset-2"
                    >
                      <FileText aria-hidden="true" className="h-3.5 w-3.5" />
                      Document de la bibliothèque
                    </Link>
                  ) : (
                    <span className="text-xs text-[var(--foreground-muted)]">Document lié</span>
                  )
                ) : null}
              </div>
              {gerer ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={BOUTON_PETIT}
                    aria-haspopup="dialog"
                    onClick={() => setEdition(c)}
                  >
                    Modifier
                  </button>
                  <button
                    type="button"
                    className={BOUTON_DANGER}
                    aria-haspopup="dialog"
                    onClick={() => {
                      setErreur(null);
                      setASupprimer(c);
                    }}
                  >
                    <Trash2 aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                    Supprimer
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {edition !== null ? (
        <DialogueCouverture
          assetId={assetId}
          couverture={edition === 'nouvelle' ? null : edition}
          valeurs={valeursAffichees(actions, false)}
          lireDocs={lireDocs}
          onFermer={() => setEdition(null)}
          onFait={() => {
            setEdition(null);
            recharger();
          }}
        />
      ) : null}
      {aSupprimer ? (
        <Modal
          open
          onClose={() => setASupprimer(null)}
          busy={envoi}
          title="Supprimer cette couverture ?"
          description={`${LIBELLES_COUVERTURE[aSupprimer.kind]} — ${aSupprimer.provider}`}
          size="sm"
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={BOUTON_PETIT} onClick={() => setASupprimer(null)}>
                Retour
              </button>
              <button
                type="button"
                className={buttonClasses('danger', 'sm')}
                disabled={envoi}
                onClick={() => void supprimer(aSupprimer)}
              >
                {envoi ? 'Suppression…' : 'Supprimer'}
              </button>
            </div>
          }
        >
          <p className="text-sm">
            Le document lié reste dans la bibliothèque ; seules la couverture et ses rappels
            disparaissent.
          </p>
          {erreur ? (
            <Alerte>
              <p>{erreur}</p>
            </Alerte>
          ) : null}
        </Modal>
      ) : null}
    </Panneau>
  );
}

/** Document tel que le sélecteur le connaît : la fiche lue, ou son seul identifiant. */
type DocumentChoisi = Pick<LibraryDocumentView, 'id' | 'title'>;

/**
 * Choix d'un document de la bibliothèque : même recherche en CORPS qu'avant
 * (`POST /documents/search`, 50 au plus), en `EntityPicker` (ADR-0074 § 4).
 */
function ChoixDocument({
  valeur,
  onChange,
}: {
  valeur: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  const [choisi, setChoisi] = useState<DocumentChoisi | null>(null);
  const affiche: DocumentChoisi | null =
    valeur === '' ? null : choisi?.id === valeur ? choisi : { id: valeur, title: 'Document lié' };
  const chercher = useCallback(async (q: string): Promise<LibraryDocumentView[]> => {
    try {
      const p = await documentsApi.search({ ...(q ? { text: q } : {}), limit: 50 });
      return p.items;
    } catch {
      return [];
    }
  }, []);
  return (
    <EntityPicker<DocumentChoisi>
      value={affiche}
      onChange={(d) => {
        setChoisi(d);
        onChange(d?.id ?? '');
      }}
      search={chercher}
      getKey={(d) => d.id}
      getLabel={(d) => d.title}
      placeholder="Aucun document : tapez un titre"
      emptyText="Aucun document ne correspond."
      debounceMs={250}
    />
  );
}

function DialogueCouverture({
  assetId,
  couverture,
  valeurs,
  lireDocs,
  onFermer,
  onFait,
}: {
  assetId: string;
  couverture: AssetCoverageView | null;
  valeurs: boolean;
  lireDocs: boolean;
  onFermer: () => void;
  onFait: () => void;
}): React.ReactElement {
  const id = useId();
  const [f, setF] = useState<FormulaireCouverture>(() =>
    formulaireCouverture(couverture, jourKinshasa(new Date())),
  );
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function valider(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    const p = preparerCouverture(f, !valeurs);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      if (couverture === null) await assetsApi.createCoverage(assetId, p.corps);
      else {
        // La nature ne change pas après la création : elle n'est pas renvoyée.
        const reste: Partial<typeof p.corps> = { ...p.corps };
        delete reste.kind;
        await assetsApi.updateCoverage(assetId, couverture.id, {
          ...reste,
          expectedRevision: couverture.revision,
        });
      }
      onFait();
    } catch (err) {
      setErreur(messageEquipements(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      busy={envoi}
      title={couverture ? 'Modifier la couverture' : 'Nouvelle garantie ou assurance'}
      description="Un rappel est envoyé avant l’échéance. Aucune règle d’assurance obligatoire n’est posée."
      size="md"
    >
      <form noValidate onSubmit={(e) => void valider(e)} className="flex flex-col gap-3">
        <FormGrid>
          <Field id={`${id}-nature`} label="Nature" size="md">
            <Select<AssetCoverageKind>
              value={f.kind}
              disabled={couverture !== null}
              onChange={(v) => setF({ ...f, kind: v })}
              options={Object.entries(LIBELLES_COUVERTURE).map(([k, l]) => ({
                value: k as AssetCoverageKind,
                label: l,
              }))}
            />
          </Field>
          <Field
            id={`${id}-presta`}
            label="Prestataire"
            required
            size="md"
            error={champs['provider']}
          >
            <TextInput
              value={f.provider}
              maxLength={120}
              onChange={(e) => setF({ ...f, provider: e.target.value })}
            />
          </Field>
          <Field id={`${id}-ref`} label="Référence" size="md" newRow>
            <TextInput
              value={f.reference}
              maxLength={80}
              onChange={(e) => setF({ ...f, reference: e.target.value })}
            />
          </Field>
          <Field
            id={`${id}-rappel`}
            label="Rappel (jours avant)"
            size="sm"
            hint="Vide : réglage de l’organisation."
            error={champs['reminderDays']}
          >
            <ChampNombre
              entier
              value={f.reminderDays}
              onChange={(e) => setF({ ...f, reminderDays: e.target.value })}
            />
          </Field>
          <Field
            id={`${id}-debut`}
            label="Début"
            required
            size="sm"
            newRow
            error={champs['startOn']}
          >
            <DatePicker
              value={f.startOn}
              shortcuts={['today']}
              onChange={(v) => setF({ ...f, startOn: v })}
            />
          </Field>
          <Field id={`${id}-fin`} label="Fin" required size="sm" error={champs['endOn']}>
            <DatePicker
              value={f.endOn}
              shortcuts={['endOfYear']}
              onChange={(v) => setF({ ...f, endOn: v })}
            />
          </Field>
          {valeurs ? (
            <CoutDevise
              id={`${id}-cout`}
              cout={f.cost}
              devise={f.currency}
              erreur={champs['cost']}
              onCout={(v) => setF({ ...f, cost: v })}
              onDevise={(v) => setF({ ...f, currency: v })}
            />
          ) : null}
          {lireDocs ? (
            <Field
              id={`${id}-doc`}
              label="Document de la bibliothèque"
              size="lg"
              newRow
              hint="Police, certificat de garantie…"
            >
              <ChoixDocument
                valeur={f.documentId}
                onChange={(v) => setF({ ...f, documentId: v })}
              />
            </Field>
          ) : null}
        </FormGrid>
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <SubmitButton busy={envoi} busyLabel="Enregistrement…" className="self-start max-sm:w-full">
          Enregistrer
        </SubmitButton>
      </form>
    </Modal>
  );
}
