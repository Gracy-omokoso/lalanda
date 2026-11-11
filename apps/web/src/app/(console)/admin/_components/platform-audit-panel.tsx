'use client';

// Journal d'audit de la PLATEFORME (S21b ; filtres, export et sécurité : ADR-0053 — P5).
//
// ── Deux journaux, jamais mélangés ───────────────────────────────────────────
//
// Celui-ci trace les actes d'ADMINISTRATION : rôles attribués, plans changés,
// organisations suspendues, secrets remplacés, fiches consultées, exports. Le journal
// d'une organisation (`/organisation/journal`) trace ce que ses membres y font. Les
// fusionner donnerait à un opérateur une vue sur l'activité interne des clients —
// exactement l'accès qu'ADR-0012 §4 refuse.
//
// ── Minimisation ─────────────────────────────────────────────────────────────
//
// L'API ne sert que les métadonnées d'une liste blanche : ni montant, ni adresse IP, ni
// valeur de secret (les quatre derniers caractères AVANT et APRÈS d'un secret, seuls,
// répondent à « quelle clé a été remplacée par quelle autre ? »). Une clé retirée est
// signalée, jamais montrée.
//
// ── Export ───────────────────────────────────────────────────────────────────
//
// Réservé au super-administrateur (`platform.audit.export`), avec un motif : l'export
// est lui-même inscrit au journal, et limité à dix par heure.

import { DatePicker, Field, FormGrid, Select, TextInput } from '@lalanda/ui';
import { useCallback, useEffect, useState } from 'react';

import { api, type PlatformAuditEventView } from '@/lib/api';

import { useAccesPlateforme } from './admin-access';
import { Bandeau, Vide } from './admin-chrome';
import {
  ACTIONS_FILTRABLES,
  formaterDateHeure,
  messageErreur,
  metadonneesLisibles,
} from './admin-model';
import {
  FILTRES_VIDES,
  MOTIFS_EXPORT,
  TYPES_CIBLE,
  erreurFiltres,
  filtresActifs,
  filtresEnvoyes,
  libelleActionJournal,
  noteMasquage,
  peutExporter,
  type FiltresJournal,
} from './journal-model';
import { SecurityEventsPanel } from './security-events-panel';

const BOUTON =
  'rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-40';

function telecharger(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function PlatformAuditPanel(): React.ReactElement {
  const acces = useAccesPlateforme();
  const [saisie, setSaisie] = useState<FiltresJournal>(FILTRES_VIDES);
  const [filtres, setFiltres] = useState<FiltresJournal>(FILTRES_VIDES);
  const [events, setEvents] = useState<PlatformAuditEventView[] | null>(null);
  const [suivant, setSuivant] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async (f: FiltresJournal, before?: string): Promise<void> => {
    setChargement(true);
    try {
      const res = await api.listPlatformAuditEvents({
        ...filtresEnvoyes(f),
        limit: 100,
        ...(before ? { before } : {}),
      });
      setEvents((prec) => (before && prec ? [...prec, ...res.events] : res.events));
      setSuivant(res.nextCursor ?? null);
      setErreur(null);
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de charger le journal.'));
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger(filtres);
  }, [charger, filtres]);

  const appliquer = (e: React.FormEvent): void => {
    e.preventDefault();
    const probleme = erreurFiltres(saisie);
    if (probleme) {
      setErreur(probleme);
      return;
    }
    setFiltres(saisie);
  };

  const maj = (cle: keyof FiltresJournal) => (valeur: string) =>
    setSaisie({ ...saisie, [cle]: valeur });
  const texte = (cle: keyof FiltresJournal) => ({
    value: saisie[cle],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => maj(cle)(e.target.value),
  });

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={appliquer} className="flex flex-col gap-3">
        <FormGrid>
          <Field label="Action" size="lg">
            <Select
              value={saisie.action}
              onChange={maj('action')}
              options={[
                { value: '', label: 'Toutes les actions' },
                ...[
                  ...ACTIONS_FILTRABLES,
                  'platform.organization.viewed',
                  'platform.user.viewed',
                  'platform.audit.exported',
                ].map((a) => ({ value: a, label: libelleActionJournal(a), keywords: a })),
              ]}
            />
          </Field>
          <Field label="Type de cible" size="sm">
            <Select
              value={saisie.targetType}
              onChange={maj('targetType')}
              options={[
                { value: '', label: 'Tous' },
                ...TYPES_CIBLE.map((t) => ({ value: t, label: t })),
              ]}
            />
          </Field>
          <Field label="Acteur (identifiant)" size="md" newRow>
            <TextInput {...texte('actorUserId')} spellCheck={false} className="font-mono" />
          </Field>
          <Field label="Cible (identifiant)" size="md">
            <TextInput {...texte('targetId')} spellCheck={false} className="font-mono" />
          </Field>
          <Field label="Du" size="sm" newRow>
            <DatePicker value={saisie.from} onChange={maj('from')} />
          </Field>
          <Field label="Au" size="sm">
            <DatePicker value={saisie.to} onChange={maj('to')} />
          </Field>
        </FormGrid>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={BOUTON}>
            Appliquer les filtres
          </button>
          {filtresActifs(filtres) > 0 ? (
            <button
              type="button"
              className={BOUTON}
              onClick={() => {
                setSaisie(FILTRES_VIDES);
                setFiltres(FILTRES_VIDES);
              }}
            >
              Effacer ({filtresActifs(filtres)})
            </button>
          ) : null}
          <p className="max-w-md text-xs text-[var(--foreground-muted)]">
            Le journal est en lecture seule : il ne peut être ni modifié ni purgé depuis
            l’interface. Aucun montant ni aucune adresse IP n’y est affiché.
          </p>
        </div>
      </form>

      {peutExporter(acces.actions) ? <ExportJournal filtres={filtres} /> : null}

      {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}

      {chargement && !events ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : !events || events.length === 0 ? (
        <Vide>
          {filtresActifs(filtres) > 0
            ? 'Aucun événement pour ces filtres.'
            : 'Aucun acte d’administration enregistré.'}
        </Vide>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {events.map((event) => {
              const masque = noteMasquage(event.redactedKeys);
              return (
                <li
                  key={event.id}
                  className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{libelleActionJournal(event.action)}</span>
                    <span className="font-mono text-xs text-[var(--foreground-muted)]">
                      {formaterDateHeure(event.createdAt)}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-[var(--foreground-muted)]">
                    {event.actorUserId} · {event.actorRole} → {event.targetType} {event.targetId}
                  </p>
                  {metadonneesLisibles(event).length > 0 ? (
                    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                      {metadonneesLisibles(event).map(({ cle, valeur }) => (
                        <div key={cle} className="flex gap-1.5">
                          <dt className="text-[var(--foreground-muted)]">{cle}</dt>
                          <dd className="break-all font-mono">{valeur}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {masque ? (
                    <p className="text-xs italic text-[var(--foreground-muted)]">{masque}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {suivant ? (
            <button
              type="button"
              className={`${BOUTON} self-start`}
              disabled={chargement}
              onClick={() => void charger(filtres, suivant)}
            >
              {chargement ? 'Chargement…' : 'Événements plus anciens'}
            </button>
          ) : null}
        </div>
      )}

      <SecurityEventsPanel />
    </div>
  );
}

function ExportJournal({ filtres }: { filtres: FiltresJournal }): React.ReactElement {
  const [motif, setMotif] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ ton: 'succes' | 'echec'; texte: string } | null>(null);

  const exporter = async (): Promise<void> => {
    if (!motif) return;
    setEnCours(true);
    setMessage(null);
    try {
      const { blob, filename } = await api.exportPlatformAuditCsv(filtresEnvoyes(filtres), motif);
      telecharger(blob, filename);
      setMessage({
        ton: 'succes',
        texte: 'Export enregistré, et inscrit au journal avec son motif (5 000 lignes au plus).',
      });
    } catch (err) {
      setMessage({ ton: 'echec', texte: messageErreur(err, 'Export impossible.') });
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-[var(--border)] p-4">
      <Field label="Motif de l’export" required className="w-full max-w-60">
        <Select
          value={motif}
          onChange={setMotif}
          options={MOTIFS_EXPORT.map((m) => ({ value: m.valeur, label: m.libelle }))}
          placeholder="Choisir…"
        />
      </Field>
      <button
        type="button"
        className={BOUTON}
        disabled={!motif || enCours}
        onClick={() => void exporter()}
      >
        {enCours ? 'Export…' : 'Exporter en CSV (filtres appliqués)'}
      </button>
      <p className="max-w-md text-xs text-[var(--foreground-muted)]">
        L’export reprend les filtres appliqués. Il est inscrit au journal plateforme et limité à dix
        par heure.
      </p>
      {message ? (
        <div className="w-full">
          <Bandeau ton={message.ton}>{message.texte}</Bandeau>
        </div>
      ) : null}
    </div>
  );
}
