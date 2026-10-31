'use client';

// Maintenance et couvertures d'un équipement (ADR-0046 § 3.3, § 3.4) : listes,
// planification et réalisation d'une intervention, garanties, assurances et
// contrats reliés à un document de la bibliothèque. Toute saisie en fenêtre
// modale (`assets.manage`) ; les coûts n'apparaissent qu'aux rôles qui les voient.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { FileText, ShieldCheck, Trash2, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import {
  assetsApi,
  type AssetCoverageKind,
  type AssetCoverageView,
  type AssetMaintenanceKind,
  type AssetMaintenanceView,
} from '@/lib/api-assets';
import { documentsApi, type LibraryDocumentView } from '@/lib/api-documents';

import { useShell } from '../../_components/shell-context';
import {
  Alerte,
  BOUTON_DANGER,
  BOUTON_PETIT,
  CHAMP,
  Champ,
  aria,
} from '../../ventes/_components/form-ui';

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
  erreur?: string;
  onCout: (v: string) => void;
  onDevise: (v: 'USD' | 'CDF') => void;
}): React.ReactElement {
  return (
    <Champ id={id} label="Coût (informatif)" erreur={erreur} aide="Ne crée aucune dépense.">
      <div className="flex gap-2">
        <ChampNombre
          id={id}
          value={cout}
          onChange={(e) => onCout(e.target.value)}
          {...aria(id, erreur, true)}
        />
        <select
          aria-label="Devise"
          className={`${CHAMP} w-24`}
          value={devise}
          onChange={(e) => onDevise(e.target.value as 'USD' | 'CDF')}
        >
          <option value="USD">USD</option>
          <option value="CDF">CDF</option>
        </select>
      </div>
    </Champ>
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ id={`${id}-nature`} label="Nature">
            <select
              id={`${id}-nature`}
              className={CHAMP}
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value as AssetMaintenanceKind })}
            >
              {Object.entries(LIBELLES_MAINTENANCE).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Champ>
          <Champ
            id={`${id}-date`}
            label={f.dejaFaite ? 'Faite le' : 'Prévue le'}
            requis
            erreur={champs['date']}
          >
            <input
              id={`${id}-date`}
              type="date"
              className={CHAMP}
              value={f.date}
              onChange={(e) => setF({ ...f, date: e.target.value })}
              {...aria(`${id}-date`, champs['date'])}
            />
          </Champ>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={f.dejaFaite}
              onChange={(e) => setF({ ...f, dejaFaite: e.target.checked })}
            />
            Intervention déjà faite
          </label>
          {f.kind === 'preventive' ? (
            <Champ
              id={`${id}-recurrence`}
              label="Répéter tous les … mois"
              aide="Vide : pas de répétition. Une fois faite, la suivante est planifiée."
              erreur={champs['everyMonths']}
            >
              <ChampNombre
                id={`${id}-recurrence`}
                entier
                value={f.everyMonths}
                onChange={(e) => setF({ ...f, everyMonths: e.target.value })}
                {...aria(`${id}-recurrence`, champs['everyMonths'], true)}
              />
            </Champ>
          ) : null}
          <Champ id={`${id}-par`} label="Réalisée par">
            <input
              id={`${id}-par`}
              className={CHAMP}
              value={f.performedBy}
              maxLength={120}
              onChange={(e) => setF({ ...f, performedBy: e.target.value })}
            />
          </Champ>
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
        </div>
        <Champ id={`${id}-note`} label="Note">
          <textarea
            id={`${id}-note`}
            rows={2}
            className={CHAMP}
            value={f.note}
            maxLength={1000}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
        </Champ>
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <button
          type="submit"
          className={buttonClasses('primary', 'md', 'self-start')}
          disabled={envoi}
        >
          {envoi ? 'Enregistrement…' : 'Enregistrer'}
        </button>
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
        <Champ id={`${id}-le`} label="Faite le" requis erreur={champs['doneOn']}>
          <input
            id={`${id}-le`}
            type="date"
            className={CHAMP}
            value={f.doneOn}
            onChange={(e) => setF({ ...f, doneOn: e.target.value })}
            {...aria(`${id}-le`, champs['doneOn'])}
          />
        </Champ>
        <Champ id={`${id}-par`} label="Réalisée par">
          <input
            id={`${id}-par`}
            className={CHAMP}
            value={f.performedBy}
            maxLength={120}
            onChange={(e) => setF({ ...f, performedBy: e.target.value })}
          />
        </Champ>
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
        <Champ id={`${id}-note`} label="Note">
          <textarea
            id={`${id}-note`}
            rows={2}
            className={CHAMP}
            value={f.note}
            maxLength={1000}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
        </Champ>
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <button
          type="submit"
          className={buttonClasses('primary', 'md', 'self-start')}
          disabled={envoi}
        >
          {envoi ? 'Enregistrement…' : 'Enregistrer'}
        </button>
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

/** Choix d'un document de la bibliothèque : recherche en CORPS (`POST /documents/search`). */
function ChoixDocument({
  id,
  valeur,
  onChange,
}: {
  id: string;
  valeur: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  const [q, setQ] = useState('');
  const [liste, setListe] = useState<LibraryDocumentView[]>([]);
  useEffect(() => {
    let annule = false;
    const t = setTimeout(() => {
      documentsApi
        .search({ ...(q.trim() ? { text: q.trim() } : {}), limit: 50 })
        .then((p) => {
          if (!annule) setListe(p.items);
        })
        .catch(() => {
          if (!annule) setListe([]);
        });
    }, 250);
    return () => {
      annule = true;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="search"
        aria-label="Rechercher un document"
        placeholder="Rechercher un document par son titre…"
        className={CHAMP}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select id={id} className={CHAMP} value={valeur} onChange={(e) => onChange(e.target.value)}>
        <option value="">Aucun document</option>
        {valeur !== '' && !liste.some((d) => d.id === valeur) ? (
          <option value={valeur}>Document lié</option>
        ) : null}
        {liste.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title}
          </option>
        ))}
      </select>
    </div>
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ id={`${id}-nature`} label="Nature">
            <select
              id={`${id}-nature`}
              className={CHAMP}
              value={f.kind}
              disabled={couverture !== null}
              onChange={(e) => setF({ ...f, kind: e.target.value as AssetCoverageKind })}
            >
              {Object.entries(LIBELLES_COUVERTURE).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Champ>
          <Champ id={`${id}-presta`} label="Prestataire" requis erreur={champs['provider']}>
            <input
              id={`${id}-presta`}
              className={CHAMP}
              value={f.provider}
              maxLength={120}
              onChange={(e) => setF({ ...f, provider: e.target.value })}
              {...aria(`${id}-presta`, champs['provider'])}
            />
          </Champ>
          <Champ id={`${id}-ref`} label="Référence">
            <input
              id={`${id}-ref`}
              className={CHAMP}
              value={f.reference}
              maxLength={80}
              onChange={(e) => setF({ ...f, reference: e.target.value })}
            />
          </Champ>
          <Champ
            id={`${id}-rappel`}
            label="Rappel (jours avant)"
            aide="Vide : réglage de l’organisation."
            erreur={champs['reminderDays']}
          >
            <ChampNombre
              id={`${id}-rappel`}
              entier
              value={f.reminderDays}
              onChange={(e) => setF({ ...f, reminderDays: e.target.value })}
              {...aria(`${id}-rappel`, champs['reminderDays'], true)}
            />
          </Champ>
          <Champ id={`${id}-debut`} label="Début" requis erreur={champs['startOn']}>
            <input
              id={`${id}-debut`}
              type="date"
              className={CHAMP}
              value={f.startOn}
              onChange={(e) => setF({ ...f, startOn: e.target.value })}
              {...aria(`${id}-debut`, champs['startOn'])}
            />
          </Champ>
          <Champ id={`${id}-fin`} label="Fin" requis erreur={champs['endOn']}>
            <input
              id={`${id}-fin`}
              type="date"
              className={CHAMP}
              value={f.endOn}
              onChange={(e) => setF({ ...f, endOn: e.target.value })}
              {...aria(`${id}-fin`, champs['endOn'])}
            />
          </Champ>
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
        </div>
        {lireDocs ? (
          <Champ
            id={`${id}-doc`}
            label="Document de la bibliothèque"
            aide="Police, certificat de garantie…"
          >
            <ChoixDocument
              id={`${id}-doc`}
              valeur={f.documentId}
              onChange={(v) => setF({ ...f, documentId: v })}
            />
          </Champ>
        ) : null}
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <button
          type="submit"
          className={buttonClasses('primary', 'md', 'self-start')}
          disabled={envoi}
        >
          {envoi ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
    </Modal>
  );
}
