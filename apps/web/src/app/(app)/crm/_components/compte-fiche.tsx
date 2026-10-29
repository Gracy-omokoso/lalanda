'use client';

// Fiche compte 360° — ADR-0040 § 3.1.2, § 3.1.3 et § 8.2 : en-tête (nom,
// prospect/client, responsable, type DGI et NIF en lecture pour un client,
// « Convertir en client » pour un prospect), sections (contacts, opportunités,
// devis, factures et encaissements avec solde dû PAR DEVISE, projets liés,
// prochaines actions) et fil chronologique paginé.
//
// Une section `hidden` affiche une phrase, jamais un zéro. Tous les montants
// sont ceux de l'API (moteur) : rien n'est additionné, converti ni arrondi ici.

import type { CrmOverview, CrmTimelineEvent } from '@lalanda/shared/crm';
import { Badge, buttonClasses } from '@lalanda/ui';
import {
  Building2,
  CalendarClock,
  Contact,
  FileText,
  FolderKanban,
  History,
  Receipt,
  Target,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { api, type CustomerType, type CustomerView } from '@/lib/api';
import { crmApi, type CrmAccountListItem } from '@/lib/api-crm';

import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';
import {
  CUSTOMER_TYPES,
  formatMontant,
  formulaireClient,
  libelleTypeClient,
  preparerClient,
  type FormulaireClient,
} from '../../ventes/_components/sales-model';
import { QUOTE_STATUS_LABELS } from '../../ventes/devis/_components/quote-model';

import {
  LIBELLES_EVENEMENT,
  PHRASE_SECTION_MASQUEE_PROJETS,
  PHRASE_SECTION_MASQUEE_VENTES,
  RAISON_CONVERSION_FERMEE,
  STATUTS_OPPORTUNITE,
  ciblesFusion,
  ficheExistante,
  formatInstant,
  formulaireCompte,
  fusionPossible,
  fusionnerFil,
  libelleNature,
  libelleReglement,
  lienEvenement,
  montantsParDevise,
  phraseSection,
  phraseSourcesMasquees,
  preparerCompte,
  type FormulaireCompte,
} from './comptes-model';
import { useAccesCrm } from './crm-access';
import {
  ACTIVITY_LABELS,
  CRM_BASE,
  formatEcheance,
  lienActivite,
  lienCompte,
  lienOpportunite,
  messageCrm,
  peutConvertirCompte,
  peutGererCrm,
} from './crm-model';
import { Bandeau, ChoixMembre, Panneau, PhraseSection, Tuile } from './crm-ui';
import { MENTION_ESTIME, nomMembre } from './pipeline-model';

type Sections = CrmOverview['sections'];

const ACTIVITE_LIBELLE = (kind: string): string =>
  ACTIVITY_LABELS[kind as keyof typeof ACTIVITY_LABELS] ?? kind;

function Conversion({
  overview,
  onFait,
  onFermer,
}: {
  overview: CrmOverview;
  onFait: () => void;
  onFermer: () => void;
}): React.ReactElement {
  const a = overview.account;
  const [mode, setMode] = useState<'create' | 'link'>('create');
  const [f, setF] = useState<FormulaireClient>({
    ...formulaireClient(null),
    name: a.name,
    phone: a.phone ?? '',
    email: a.email ?? '',
    address: a.address ?? '',
  });
  const [champs, setChamps] = useState<Partial<Record<keyof FormulaireClient, string>>>({});
  const [q, setQ] = useState('');
  const [clients, setClients] = useState<CustomerView[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'link') return;
    const t = setTimeout(() => {
      api
        .listCustomers({ status: 'active', limit: 50, ...(q.trim() ? { q: q.trim() } : {}) })
        .then((p) => setClients(p.items))
        .catch(() => undefined);
    }, 200);
    return () => clearTimeout(t);
  }, [mode, q]);

  async function convertir(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    try {
      if (mode === 'create') {
        const p = preparerClient(f);
        if (!p.ok) {
          setChamps(p.champs);
          return;
        }
        setChamps({});
        await crmApi.convertAccount(a.id, {
          mode: 'create',
          customer: { ...p.corps },
          expectedRevision: a.revision,
        });
      } else {
        if (customerId === '') return;
        await crmApi.convertAccount(a.id, {
          mode: 'link',
          customerId,
          expectedRevision: a.revision,
        });
      }
      onFait();
    } catch (err) {
      const existante = ficheExistante(err);
      if (existante) {
        setMode('link');
        setCustomerId(existante);
        setErreur(
          'Une fiche client porte déjà ce NIF : elle est sélectionnée ci-dessous, rattachez-y le prospect.',
        );
        return;
      }
      setErreur(messageCrm(err, 'Conversion impossible.'));
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => void convertir(e)}
      className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--accent)] bg-[var(--surface)] p-4 sm:p-5"
    >
      <h3 className="text-sm font-semibold">Convertir « {a.name} » en client</h3>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Mode de conversion">
        <button
          type="button"
          className={BOUTON_PETIT}
          aria-pressed={mode === 'create'}
          onClick={() => setMode('create')}
        >
          Créer la fiche client
        </button>
        <button
          type="button"
          className={BOUTON_PETIT}
          aria-pressed={mode === 'link'}
          onClick={() => setMode('link')}
        >
          Rattacher à une fiche existante
        </button>
      </div>
      {mode === 'create' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ id="cv-type" label="Type de client (DGI)" requis erreur={champs.type}>
            <select
              id="cv-type"
              className={CHAMP}
              value={f.type}
              onChange={(e) => setF({ ...f, type: e.target.value as FormulaireClient['type'] })}
              {...aria('cv-type', champs.type)}
            >
              <option value="">Choisir…</option>
              {CUSTOMER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Champ>
          <Champ id="cv-nom" label="Nom ou dénomination" requis erreur={champs.name}>
            <input
              id="cv-nom"
              className={CHAMP}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              {...aria('cv-nom', champs.name)}
            />
          </Champ>
          <Champ
            id="cv-nif"
            label="NIF"
            erreur={champs.nif}
            aide={CUSTOMER_TYPES.find((t) => t.value === f.type)?.aide}
          >
            <input
              id="cv-nif"
              className={CHAMP}
              value={f.nif}
              onChange={(e) => setF({ ...f, nif: e.target.value })}
              {...aria('cv-nif', champs.nif, true)}
            />
          </Champ>
          {f.type === 'AO' ? (
            <Champ
              id="cv-exo"
              label="Référence d’exonération"
              requis
              erreur={champs.exemptionReference}
            >
              <input
                id="cv-exo"
                className={CHAMP}
                value={f.exemptionReference}
                onChange={(e) => setF({ ...f, exemptionReference: e.target.value })}
              />
            </Champ>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <input
            type="search"
            aria-label="Rechercher une fiche client"
            placeholder="Rechercher une fiche client…"
            className={CHAMP}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            aria-label="Fiche client"
            className={CHAMP}
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">Choisir une fiche…</option>
            {customerId !== '' && !clients.some((c) => c.id === customerId) ? (
              <option value={customerId}>Fiche au même NIF</option>
            ) : null}
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.nif ? ` — NIF ${c.nif}` : ''}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--foreground-muted)]">
            Si cette fiche a déjà son compte, le prospect y est fusionné (contacts, opportunités et
            activités compris).
          </p>
        </div>
      )}
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonClasses('primary', 'md')}>
          Convertir en client
        </button>
        <button type="button" className={buttonClasses('secondary', 'md')} onClick={onFermer}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function Fusion({
  overview,
  onFait,
  onFermer,
}: {
  overview: CrmOverview;
  onFait: (cible: string) => void;
  onFermer: () => void;
}): React.ReactElement {
  const a = overview.account;
  const [q, setQ] = useState('');
  const [comptes, setComptes] = useState<CrmAccountListItem[]>([]);
  const [cible, setCible] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      crmApi
        .listAccounts({ active: 'true', limit: 50, ...(q.trim() ? { q: q.trim() } : {}) })
        .then((p) => setComptes(ciblesFusion(a, p.items)))
        .catch(() => undefined);
    }, 200);
    return () => clearTimeout(t);
  }, [q, a]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (cible === '') return;
        const nom = comptes.find((c) => c.id === cible)?.name ?? 'ce compte';
        if (
          !window.confirm(
            `Fusionner « ${a.name} » dans « ${nom} » ? Ses contacts, opportunités et activités y seront déplacés.`,
          )
        )
          return;
        void crmApi
          .mergeAccount(a.id, cible, a.revision)
          .then(() => onFait(cible))
          .catch((err) => setErreur(messageCrm(err, 'Fusion impossible.')));
      }}
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--accent)] bg-[var(--surface)] p-4 sm:p-5"
    >
      <h3 className="text-sm font-semibold">Fusionner « {a.name} » dans un autre compte</h3>
      <p className="text-sm text-[var(--foreground-muted)]">
        Pour réunir deux fiches de la même entreprise. Le prospect fusionné est conservé pour la
        trace et disparaît des listes.
      </p>
      <input
        type="search"
        aria-label="Rechercher le compte qui reste"
        placeholder="Rechercher le compte qui reste…"
        className={CHAMP}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select
        aria-label="Compte qui reste"
        className={CHAMP}
        value={cible}
        onChange={(e) => setCible(e.target.value)}
      >
        <option value="">Choisir…</option>
        {comptes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} — {libelleNature(c.kind)}
          </option>
        ))}
      </select>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonClasses('primary', 'md')} disabled={cible === ''}>
          Fusionner
        </button>
        <button type="button" className={buttonClasses('secondary', 'md')} onClick={onFermer}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function Edition({
  overview,
  onFait,
  onFermer,
}: {
  overview: CrmOverview;
  onFait: () => void;
  onFermer: () => void;
}): React.ReactElement {
  const a = overview.account;
  const { membres } = useAccesCrm();
  const [f, setF] = useState<FormulaireCompte>({ ...formulaireCompte(a), ownerId: '' });
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const champ = (id: keyof FormulaireCompte, label: string, max: number) => (
    <Champ id={`ed-${id}`} label={label} erreur={champs[id]}>
      <input
        id={`ed-${id}`}
        className={CHAMP}
        value={f[id]}
        maxLength={max}
        onChange={(e) => setF({ ...f, [id]: e.target.value })}
      />
    </Champ>
  );
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const p = preparerCompte(f, a.kind);
        if (!p.ok) {
          setChamps(p.champs);
          return;
        }
        void crmApi
          .updateAccount(a.id, { ...p.corps, expectedRevision: a.revision })
          .then(onFait)
          .catch((err) => setErreur(messageCrm(err, 'Enregistrement impossible.')));
      }}
      className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--accent)] bg-[var(--surface)] p-4 sm:grid-cols-2 sm:p-5"
    >
      <h3 className="text-sm font-semibold sm:col-span-2">Modifier le compte</h3>
      {a.kind === 'prospect' ? champ('name', 'Nom', 200) : null}
      {champ('industry', 'Secteur', 80)}
      {champ('origin', 'Origine', 80)}
      {champ('website', 'Site web', 200)}
      {champ('phone', 'Téléphone', 30)}
      {champ('email', 'E-mail', 200)}
      {champ('address', 'Adresse', 300)}
      <Champ id="ed-owner" label="Responsable">
        <ChoixMembre
          id="ed-owner"
          valeur={f.ownerId}
          membres={membres}
          vide={a.ownerId ? `${nomMembre(membres, a.ownerId)} (inchangé)` : 'Sans responsable'}
          onChange={(ownerId) => setF({ ...f, ownerId })}
        />
      </Champ>
      <Champ id="ed-notes" label="Notes">
        <textarea
          id="ed-notes"
          rows={3}
          className={CHAMP}
          value={f.notes}
          maxLength={5000}
          onChange={(e) => setF({ ...f, notes: e.target.value })}
        />
      </Champ>
      {a.kind === 'customer' ? (
        <p className="text-xs text-[var(--foreground-muted)] sm:col-span-2">
          Coordonnées commerciales. Le nom, le NIF et l’adresse imprimés sur les factures restent
          ceux de la fiche client (Ventes).
        </p>
      ) : null}
      {erreur ? (
        <div className="sm:col-span-2">
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" className={buttonClasses('primary', 'md')}>
          Enregistrer
        </button>
        <button type="button" className={buttonClasses('secondary', 'md')} onClick={onFermer}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function SectionVentes({ s }: { s: Sections }): React.ReactElement {
  const phraseFactures = phraseSection(
    s.invoices,
    PHRASE_SECTION_MASQUEE_VENTES,
    'Aucune facture : un prospect n’en a pas.',
  );
  const phraseSolde = phraseSection(
    s.outstanding,
    PHRASE_SECTION_MASQUEE_VENTES,
    'Rien à encaisser.',
  );
  const phraseEnc = phraseSection(s.receipts, PHRASE_SECTION_MASQUEE_VENTES, 'Aucun encaissement.');
  return (
    <Panneau
      titre="Factures et encaissements"
      icone={Receipt}
      id="fiche-factures"
      className="lg:col-span-2"
    >
      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
          Solde dû par devise
        </h4>
        {phraseSolde !== null || s.outstanding.status !== 'known' ? (
          <PhraseSection>{phraseSolde}</PhraseSection>
        ) : s.outstanding.byCurrency.length === 0 ? (
          <PhraseSection>Rien à encaisser.</PhraseSection>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {s.outstanding.byCurrency.map((c) => (
              <Tuile
                key={c.currency}
                libelle={`Reste à encaisser · ${c.currency}`}
                valeur={formatMontant(c.outstanding, c.currency)}
                attention={c.overdueCount > 0}
                detail={
                  c.overdueCount > 0
                    ? `Dont échu : ${formatMontant(c.overdueOutstanding, c.currency)} (${c.overdueCount} facture${c.overdueCount > 1 ? 's' : ''})`
                    : `${c.openCount} facture${c.openCount > 1 ? 's' : ''} ouverte${c.openCount > 1 ? 's' : ''}`
                }
              />
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
            Factures et avoirs
          </h4>
          {phraseFactures !== null || s.invoices.status !== 'known' ? (
            <PhraseSection>{phraseFactures}</PhraseSection>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {s.invoices.items.map((i) => (
                <li key={i.id} className="break-words">
                  <Link
                    href={`/ventes/factures/${encodeURIComponent(i.id)}`}
                    className="font-mono underline"
                  >
                    {i.number ?? 'Brouillon'}
                  </Link>{' '}
                  {i.kind === 'credit_note' ? '(avoir) ' : ''}
                  {i.total ? `— ${formatMontant(i.total, i.currency)} ` : ''}·{' '}
                  {libelleReglement(i.settlementStatus)}
                </li>
              ))}
              {s.invoices.truncated ? <li className="text-xs">Liste tronquée.</li> : null}
            </ul>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
            Encaissements
          </h4>
          {phraseEnc !== null || s.receipts.status !== 'known' ? (
            <PhraseSection>{phraseEnc}</PhraseSection>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {s.receipts.items.map((r) => (
                <li key={r.id} className="break-words">
                  {r.receivedOn} — {formatMontant(r.amount, r.currency)}
                  {r.reference ? ` · ${r.reference}` : ''}
                </li>
              ))}
              {s.receipts.truncated ? <li className="text-xs">Liste tronquée.</li> : null}
            </ul>
          )}
        </div>
      </div>
    </Panneau>
  );
}

function Fil({ accountId }: { accountId: string }): React.ReactElement {
  const { membres } = useAccesCrm();
  const [items, setItems] = useState<CrmTimelineEvent[] | null>(null);
  const [suivant, setSuivant] = useState<string | null>(null);
  const [masquees, setMasquees] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const lire = useCallback(
    (cursor: string | null) => {
      crmApi
        .getAccountTimeline(accountId, cursor)
        .then((p) => {
          setItems((avant) => (cursor && avant ? fusionnerFil(avant, p.items) : p.items));
          setSuivant(p.nextCursor);
          setMasquees(phraseSourcesMasquees(p.hiddenSources));
        })
        .catch((err) => setErreur(messageCrm(err, 'Fil chronologique illisible.')));
    },
    [accountId],
  );

  useEffect(() => lire(null), [lire]);

  return (
    <Panneau titre="Fil chronologique" icone={History} id="fiche-fil" className="lg:col-span-2">
      {masquees ? <PhraseSection>{masquees}</PhraseSection> : null}
      {erreur ? <p className="text-sm text-[var(--danger)]">{erreur}</p> : null}
      {items === null ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : items.length === 0 ? (
        <PhraseSection>Rien pour l’instant.</PhraseSection>
      ) : (
        <ol className="relative flex flex-col gap-3 border-l border-[var(--border)] pl-4">
          {items.map((e) => {
            const lien = lienEvenement(e);
            return (
              <li key={e.id} className="relative text-sm">
                <span
                  aria-hidden="true"
                  className="absolute -left-[1.3rem] top-1.5 h-2.5 w-2.5 rounded-full bg-[var(--module-run)]"
                />
                <span className="block text-xs text-[var(--foreground-muted)]">
                  {formatInstant(e.at)} · {LIBELLES_EVENEMENT[e.type] ?? e.type}
                  {e.by ? ` · ${nomMembre(membres, e.by)}` : ''}
                </span>
                {lien ? (
                  <Link href={lien} className="break-words underline-offset-2 hover:underline">
                    {e.title}
                  </Link>
                ) : (
                  <span className="break-words">{e.title}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {suivant ? (
        <button
          type="button"
          className={`${BOUTON_PETIT} self-start`}
          onClick={() => lire(suivant)}
        >
          Afficher les événements plus anciens
        </button>
      ) : null}
    </Panneau>
  );
}

export function CompteFiche({ accountId }: { accountId: string }): React.ReactElement {
  const router = useRouter();
  const { actions, membres } = useAccesCrm();
  const gerer = peutGererCrm(actions);
  const convertir = peutConvertirCompte(actions);
  const [o, setO] = useState<CrmOverview | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [panneau, setPanneau] = useState<'conversion' | 'fusion' | 'edition' | null>(null);
  const [version, setVersion] = useState(0);

  const charger = useCallback(() => {
    crmApi
      .getAccountOverview(accountId)
      .then((v) => {
        setO(v);
        setErreur(null);
      })
      .catch((err) => setErreur(messageCrm(err, 'Compte illisible.')));
  }, [accountId]);

  useEffect(() => charger(), [charger]);

  if (o === null) {
    return erreur ? (
      <Alerte>
        <p>{erreur}</p>
      </Alerte>
    ) : (
      <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
        Chargement du compte…
      </p>
    );
  }

  const a = o.account;
  const s = o.sections;
  const client = s.identity.status === 'known' ? s.identity.customer : null;
  const rafraichir = () => {
    setPanneau(null);
    charger();
    setVersion((n) => n + 1);
  };

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Link href={`${CRM_BASE}/comptes`} className="text-sm underline underline-offset-2">
        ← Comptes
      </Link>
      <Bandeau
        icone={Building2}
        titre={a.name}
        sousTitre={[
          a.industry,
          a.ownerId ? `Responsable : ${nomMembre(membres, a.ownerId)}` : 'Sans responsable',
          a.active ? null : 'Archivé',
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            <Badge tone={a.kind === 'customer' ? 'success' : 'info'}>{libelleNature(a.kind)}</Badge>
            {gerer ? (
              <button type="button" className={BOUTON_PETIT} onClick={() => setPanneau('edition')}>
                Modifier
              </button>
            ) : null}
            {gerer && fusionPossible(a) ? (
              <button type="button" className={BOUTON_PETIT} onClick={() => setPanneau('fusion')}>
                Fusionner
              </button>
            ) : null}
            {a.kind === 'prospect' && gerer ? (
              <button
                type="button"
                className={buttonClasses('primary', 'sm')}
                disabled={!convertir}
                title={convertir ? undefined : RAISON_CONVERSION_FERMEE}
                aria-describedby={convertir ? undefined : 'raison-conversion'}
                onClick={() => setPanneau('conversion')}
              >
                Convertir en client
              </button>
            ) : null}
          </>
        }
      >
        {a.kind === 'prospect' && gerer && !convertir ? (
          <p id="raison-conversion" className="text-xs text-[var(--foreground-muted)]">
            {RAISON_CONVERSION_FERMEE}
          </p>
        ) : null}
        {client ? (
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tuile libelle="Type DGI" valeur={libelleTypeClient(client.type as CustomerType)} />
            <Tuile libelle="NIF" valeur={client.nif ?? 'Non renseigné'} />
            <Tuile libelle="Téléphone" valeur={client.phone ?? a.phone ?? '—'} />
            <Tuile libelle="E-mail" valeur={client.email ?? a.email ?? '—'} />
          </dl>
        ) : (
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tuile libelle="Origine" valeur={a.origin ?? '—'} />
            <Tuile libelle="Téléphone" valeur={a.phone ?? '—'} />
            <Tuile libelle="E-mail" valeur={a.email ?? '—'} />
            <Tuile libelle="Site web" valeur={a.website ?? '—'} />
          </dl>
        )}
      </Bandeau>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {panneau === 'conversion' && convertir ? (
        <Conversion overview={o} onFait={rafraichir} onFermer={() => setPanneau(null)} />
      ) : null}
      {panneau === 'fusion' ? (
        <Fusion
          overview={o}
          onFait={(cible) => router.push(lienCompte(cible))}
          onFermer={() => setPanneau(null)}
        />
      ) : null}
      {panneau === 'edition' ? (
        <Edition overview={o} onFait={rafraichir} onFermer={() => setPanneau(null)} />
      ) : null}

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Panneau titre="Prochaines actions" icone={CalendarClock} id="fiche-actions">
          {s.nextActions.status !== 'known' ? (
            <PhraseSection>Aucune action prévue.</PhraseSection>
          ) : s.nextActions.items.length === 0 ? (
            <PhraseSection>Aucune action prévue.</PhraseSection>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {s.nextActions.items.map((x) => (
                <li key={x.id} className="break-words">
                  <span className="font-medium">{formatEcheance(x.dueAt)}</span> —{' '}
                  <Link href={lienActivite(x.id)} className="underline-offset-2 hover:underline">
                    {ACTIVITE_LIBELLE(x.kind)} : {x.subject}
                  </Link>
                  {x.assigneeUserId ? (
                    <span className="text-xs text-[var(--foreground-muted)]">
                      {' '}
                      · {nomMembre(membres, x.assigneeUserId)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panneau>

        <Panneau titre="Contacts" icone={Contact} id="fiche-contacts">
          {s.contacts.status !== 'known' ? (
            <PhraseSection>
              Aucun contact. Rattachez des personnes depuis l’écran Contacts.
            </PhraseSection>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {s.contacts.items.map((c) => (
                <li key={c.id} className="break-words">
                  <strong>{c.name}</strong>
                  {c.jobTitle ? ` · ${c.jobTitle}` : ''}
                  <span className="block text-xs text-[var(--foreground-muted)]">
                    {[c.email, c.phone].filter(Boolean).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panneau>

        <Panneau titre="Opportunités" icone={Target} id="fiche-opportunites">
          {s.opportunities.status !== 'known' ? (
            <PhraseSection>Aucune opportunité pour ce compte.</PhraseSection>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <Tuile
                  libelle="En cours (estimé)"
                  valeur={
                    montantsParDevise(s.opportunities.totals.open).join(' · ') || 'Aucun montant'
                  }
                />
                <Tuile
                  libelle="Gagnées (estimé)"
                  valeur={
                    montantsParDevise(s.opportunities.totals.won).join(' · ') || 'Aucun montant'
                  }
                />
              </div>
              <ul className="flex flex-col gap-1 text-sm">
                {s.opportunities.items.map((x) => (
                  <li key={x.id} className="break-words">
                    <Link href={lienOpportunite(x.id)} className="underline">
                      {x.title}
                    </Link>{' '}
                    — {x.stageLabel ?? STATUTS_OPPORTUNITE[x.status] ?? x.status}
                    {x.amount ? ` · ${formatMontant(x.amount, x.currency)}` : ''}
                    {x.ownerId ? (
                      <span className="text-xs text-[var(--foreground-muted)]">
                        {' '}
                        · {nomMembre(membres, x.ownerId)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-[var(--foreground-muted)]">{MENTION_ESTIME}</p>
            </>
          )}
        </Panneau>

        <Panneau titre="Devis" icone={FileText} id="fiche-devis">
          {s.quotes.status !== 'known' ? (
            <PhraseSection>
              {phraseSection(s.quotes, PHRASE_SECTION_MASQUEE_VENTES, 'Aucun devis.')}
            </PhraseSection>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <Tuile
                  libelle="Envoyés"
                  valeur={montantsParDevise(s.quotes.totals.sent).join(' · ') || 'Aucun'}
                />
                <Tuile
                  libelle="Acceptés"
                  valeur={montantsParDevise(s.quotes.totals.accepted).join(' · ') || 'Aucun'}
                />
              </div>
              <ul className="flex flex-col gap-1 text-sm">
                {s.quotes.items.map((q) => (
                  <li key={q.id} className="break-words">
                    <Link
                      href={`/ventes/devis/${encodeURIComponent(q.id)}`}
                      className="font-mono underline"
                    >
                      {q.number}
                    </Link>{' '}
                    v{q.version} —{' '}
                    {QUOTE_STATUS_LABELS[q.status as keyof typeof QUOTE_STATUS_LABELS] ?? q.status}
                    {q.total ? ` · ${formatMontant(q.total, q.currency)}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panneau>

        <SectionVentes s={s} />

        <Panneau
          titre="Projets liés"
          icone={FolderKanban}
          id="fiche-projets"
          className="lg:col-span-2"
        >
          {s.projects.status !== 'known' ? (
            <PhraseSection>
              {phraseSection(s.projects, PHRASE_SECTION_MASQUEE_PROJETS, 'Aucun projet lié.')}
            </PhraseSection>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {s.projects.items.map((p) => (
                <li key={p.id} className="break-words">
                  <Link href={`/projets/${encodeURIComponent(p.id)}`} className="underline">
                    {p.name}
                  </Link>
                  {p.dueDate ? ` · échéance ${p.dueDate}` : ''}
                  {p.completedAt ? ' · terminé' : ''}
                </li>
              ))}
            </ul>
          )}
        </Panneau>

        <Fil key={version} accountId={a.id} />
      </div>
    </section>
  );
}
