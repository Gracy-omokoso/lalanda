'use client';

// « Présences » — ADR-0051 § 2.3, § 3.4, § 10 (lot H16). Éteint par défaut : l'écran
// explique comment l'activer, sans aucune donnée. Activé : « J'arrive / Je pars »
// (l'heure du serveur, rien d'autre), ma semaine (minutes et constats du moteur), mes
// demandes de correction ; pour le manager ou les RH, la semaine d'une personne et les
// corrections à décider.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { Clock } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';

import { hrApi, type HrEmployeeListItem } from '@/lib/api-hr';
import {
  rh2Api,
  type AttendanceCorrectionPage,
  type AttendanceDaysView,
  type HrPresenceSettingsView,
} from '@/lib/api-rh-2';

import { BOUTON_PETIT, CHAMP, Champ } from '../../ventes/_components/form-ui';

import {
  LIBELLES_SOURCE,
  LIBELLES_STATUT_CORRECTION,
  MENTION_POINTAGE,
  accesPresences,
  libelleConstat,
  pointageSuggere,
  separationCorrection,
} from './presences-model';
import { useAccesRh } from './rh-access';
import {
  decaler,
  duree,
  heureKinshasa,
  instantKinshasa,
  jourCourt,
  joursSemaine,
  lundiDe,
  messageRh2,
} from './rh2-model';
import { ErreurAction, FonctionEteinte, useMoi } from './rh2-ui';
import { aujourdhui, lire, nomAffiche, type Lecture } from './rh-model';
import {
  Bandeau,
  Chargement,
  DialogueDecision,
  EchecLecture,
  Panneau,
  PhraseSection,
} from './rh-ui';

export function Presences(): React.ReactElement {
  const { actions } = useAccesRh();
  const moi = useMoi();
  const [reglages, setReglages] = useState<Lecture<HrPresenceSettingsView> | null>(null);

  useEffect(() => {
    let annule = false;
    void lire(rh2Api.getPresenceSettings()).then((l) => {
      if (!annule) setReglages(l);
    });
    return () => {
      annule = true;
    };
  }, []);

  const acces = accesPresences(reglages?.ok ? reglages.valeur : null, actions, moi.estManager);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Clock}
        titre="Présences"
        sousTitre="Qui était là, et quand. Les durées et les constats sont calculés par Lalanda ; ce sont des faits, jamais des sanctions. Aucune heure supplémentaire n’est calculée."
      />
      {reglages === null ? (
        <Chargement />
      ) : !reglages.ok ? (
        <EchecLecture erreur={reglages.erreur} repli="Réglages illisibles." />
      ) : !acces.active ? (
        <FonctionEteinte fonction="attendance" actions={actions} />
      ) : (
        <PresencesActives
          pointer={acces.pointer}
          equipe={acces.equipe}
          employeeId={moi.employeeId}
          moi={moi}
        />
      )}
    </section>
  );
}

function PresencesActives({
  pointer,
  equipe,
  employeeId,
  moi,
}: {
  pointer: boolean;
  equipe: boolean;
  employeeId: string | null;
  moi: { employeeId: string | null; userId: string | null };
}): React.ReactElement {
  const [lundi, setLundi] = useState(lundiDe(aujourdhui()));
  const [cible, setCible] = useState<string | null>(employeeId);
  const [personnes, setPersonnes] = useState<HrEmployeeListItem[]>([]);
  const [semaine, setSemaine] = useState<Lecture<AttendanceDaysView> | null>(null);
  const [corrections, setCorrections] = useState<Lecture<AttendanceCorrectionPage> | null>(null);
  const [version, setVersion] = useState(0);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [demande, setDemande] = useState(false);
  const [decision, setDecision] = useState<{ id: string; accepter: boolean } | null>(null);
  const relire = useCallback(() => setVersion((v) => v + 1), []);
  const jours = joursSemaine(lundi);

  useEffect(() => {
    if (!equipe) return;
    let annule = false;
    hrApi
      .listEmployees({ status: 'active', limit: 200 })
      .then((p) => {
        if (!annule) setPersonnes(p.items);
      })
      .catch(() =>
        hrApi
          .getTeam()
          .then((t) => {
            if (!annule) setPersonnes(t.members.map((m) => m.employee));
          })
          .catch(() => undefined),
      );
    return () => {
      annule = true;
    };
  }, [equipe]);

  useEffect(() => {
    let annule = false;
    setSemaine(null);
    void lire(
      rh2Api.attendanceDays({
        ...(cible ? { employeeId: cible } : {}),
        from: lundi,
        to: decaler(lundi, 6),
      }),
    ).then((l) => {
      if (!annule) setSemaine(l);
    });
    void lire(rh2Api.listCorrections({ status: 'pending' })).then((l) => {
      if (!annule) setCorrections(l);
    });
    return () => {
      annule = true;
    };
  }, [cible, lundi, version]);

  const aujourdhuiJour = aujourdhui();
  const evenementsDuJour =
    semaine?.ok && cible === employeeId
      ? semaine.valeur.events.filter((e) => heureJour(e.at) === aujourdhuiJour)
      : [];
  const suggere = pointageSuggere(evenementsDuJour);

  async function pointer_(kind: 'in' | 'out'): Promise<void> {
    setErreur(null);
    setEnvoi(true);
    try {
      const r = await rh2Api.clock(kind);
      setNotice(
        `${kind === 'in' ? 'Arrivée' : 'Départ'} enregistré à ${heureKinshasa(r.event.at)}. ${r.notice}`,
      );
      relire();
    } catch (err) {
      setErreur(messageRh2(err, 'Pointage impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <>
      {pointer ? (
        <Panneau titre="Pointer" icone={Clock}>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={buttonClasses(suggere === 'in' ? 'primary' : 'secondary', 'md')}
              disabled={envoi}
              onClick={() => void pointer_('in')}
            >
              J’arrive
            </button>
            <button
              type="button"
              className={buttonClasses(suggere === 'out' ? 'primary' : 'secondary', 'md')}
              disabled={envoi}
              onClick={() => void pointer_('out')}
            >
              Je pars
            </button>
            <button type="button" className={BOUTON_PETIT} onClick={() => setDemande(true)}>
              + Demander une correction
            </button>
          </div>
          <p className="text-xs text-[var(--foreground-muted)]">{MENTION_POINTAGE}</p>
          {notice ? <p className="text-sm">{notice}</p> : null}
          <ErreurAction erreur={erreur} />
        </Panneau>
      ) : null}

      <Panneau
        titre={semaine?.ok ? `Semaine de ${semaine.valeur.employeeName}` : 'Semaine'}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {equipe && personnes.length > 0 ? (
              <select
                aria-label="Personne"
                className={`${CHAMP} w-auto`}
                value={cible ?? ''}
                onChange={(e) => setCible(e.target.value || null)}
              >
                {employeeId ? <option value={employeeId}>Moi</option> : null}
                {personnes
                  .filter((p) => p.id !== employeeId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {nomAffiche(p)}
                    </option>
                  ))}
              </select>
            ) : null}
            <button
              type="button"
              className={BOUTON_PETIT}
              onClick={() => setLundi(decaler(lundi, -7))}
            >
              ← Semaine précédente
            </button>
            <button
              type="button"
              className={BOUTON_PETIT}
              onClick={() => setLundi(decaler(lundi, 7))}
            >
              Semaine suivante →
            </button>
          </div>
        }
      >
        {semaine === null ? (
          <Chargement />
        ) : !semaine.ok ? (
          <EchecLecture
            erreur={semaine.erreur}
            repli="Présences illisibles."
            onReessayer={relire}
          />
        ) : (
          <>
            <p className="text-sm">
              Total de la semaine : <strong>{duree(semaine.valeur.minutes)}</strong>
            </p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
              {jours.map((j) => {
                const d = semaine.valeur.days.find((x) => x.date === j);
                return (
                  <li
                    key={j}
                    className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--border)] p-3 text-sm"
                  >
                    <span className="font-medium">{jourCourt(j)}</span>
                    {d && (d.pairs.length > 0 || d.firstIn) ? (
                      <>
                        <span className="tabular-nums">
                          {d.firstIn ? heureKinshasa(d.firstIn) : '—'} →{' '}
                          {d.lastOut ? heureKinshasa(d.lastOut) : '—'}
                        </span>
                        <span className="text-xs text-[var(--foreground-muted)]">
                          {duree(d.minutes)}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-[var(--foreground-muted)]">
                        {d?.leave
                          ? 'Absence accordée'
                          : d?.holiday
                            ? 'Jour férié'
                            : 'Aucun pointage'}
                      </span>
                    )}
                    {d?.findings.map((f, i) => (
                      <Badge key={`${f.code}-${i}`} tone="warning">
                        {libelleConstat(f.code)}
                      </Badge>
                    ))}
                  </li>
                );
              })}
            </ul>
            {semaine.valeur.events.length > 0 ? (
              <details className="text-xs">
                <summary className="cursor-pointer">Pointages de la semaine</summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {semaine.valeur.events.map((e) => (
                    <li key={e.id} className={e.voidedBy ? 'line-through opacity-60' : ''}>
                      {jourCourt(heureJour(e.at))} {heureKinshasa(e.at)} ·{' '}
                      {e.kind === 'in' ? 'arrivée' : 'départ'} · {LIBELLES_SOURCE[e.source]}
                      {e.note ? ` — ${e.note}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </Panneau>

      <Panneau titre="Corrections en attente">
        {corrections === null ? (
          <Chargement />
        ) : !corrections.ok ? (
          <EchecLecture erreur={corrections.erreur} repli="Corrections illisibles." />
        ) : corrections.valeur.items.length === 0 ? (
          <PhraseSection>Aucune correction en attente.</PhraseSection>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {corrections.valeur.items.map((c) => {
              const phrase = separationCorrection(c, moi);
              return (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">
                      {c.employeeName} · {jourCourt(c.date)}
                    </span>
                    <span className="text-xs text-[var(--foreground-muted)]">
                      {c.proposed
                        .map(
                          (p) => `${p.kind === 'in' ? 'arrivée' : 'départ'} ${heureKinshasa(p.at)}`,
                        )
                        .join(', ') || 'aucun pointage proposé'}
                      {c.voidEventIds.length > 0
                        ? ` · ${c.voidEventIds.length} pointage(s) à annuler`
                        : ''}{' '}
                      · {c.reason}
                    </span>
                    {phrase && equipe ? <span className="text-xs">{phrase}</span> : null}
                  </span>
                  <Badge tone="info">{LIBELLES_STATUT_CORRECTION[c.status]}</Badge>
                  {equipe && phrase === null ? (
                    <span className="flex gap-1">
                      <button
                        type="button"
                        className={BOUTON_PETIT}
                        onClick={() => setDecision({ id: c.id, accepter: false })}
                      >
                        Refuser
                      </button>
                      <button
                        type="button"
                        className={BOUTON_PETIT}
                        onClick={() => setDecision({ id: c.id, accepter: true })}
                      >
                        Accepter
                      </button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panneau>

      {demande ? (
        <DemandeCorrection
          onFermer={() => setDemande(false)}
          onFaite={() => {
            setDemande(false);
            relire();
          }}
        />
      ) : null}
      {decision ? (
        <DialogueDecision
          titre={decision.accepter ? 'Accepter la correction' : 'Refuser la correction'}
          description={
            decision.accepter
              ? 'Les pointages corrigés sont écrits ; les pointages annulés restent visibles, barrés.'
              : undefined
          }
          libelle="Commentaire"
          bouton={decision.accepter ? 'Accepter' : 'Refuser'}
          commentaire={decision.accepter ? 'facultatif' : 'obligatoire'}
          onFermer={() => setDecision(null)}
          onValider={async (t) => {
            if (decision.accepter) await rh2Api.approveCorrection(decision.id, t || undefined);
            else await rh2Api.rejectCorrection(decision.id, t);
            setDecision(null);
            relire();
          }}
        />
      ) : null}
    </>
  );
}

/** Jour civil de Kinshasa d'un horodatage. */
function heureJour(iso: string): string {
  return new Date(new Date(iso).getTime() + 3_600_000).toISOString().slice(0, 10);
}

function DemandeCorrection({
  onFermer,
  onFaite,
}: {
  onFermer: () => void;
  onFaite: () => void;
}): React.ReactElement {
  const id = useId();
  const [jour, setJour] = useState(aujourdhui());
  const [arrivee, setArrivee] = useState('');
  const [depart, setDepart] = useState('');
  const [motif, setMotif] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(): Promise<void> {
    const proposed: { kind: 'in' | 'out'; at: string }[] = [];
    for (const [kind, h] of [
      ['in', arrivee],
      ['out', depart],
    ] as const) {
      if (h === '') continue;
      const at = instantKinshasa(jour, h);
      if (at === null) {
        setErreur('Heure attendue au format HH:MM.');
        return;
      }
      proposed.push({ kind, at });
    }
    if (proposed.length === 0) {
      setErreur('Indiquez au moins une heure d’arrivée ou de départ.');
      return;
    }
    if (motif.trim() === '') {
      setErreur('Le motif est obligatoire.');
      return;
    }
    setErreur(null);
    setEnvoi(true);
    try {
      await rh2Api.requestCorrection({
        date: jour,
        proposed,
        voidEventIds: [],
        reason: motif.trim(),
      });
      onFaite();
    } catch (err) {
      setErreur(messageRh2(err, 'Demande impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title="Demander une correction"
      description="Un oubli de pointage ? Proposez l’heure réelle. Votre manager ou les ressources humaines décident ; vous ne validez pas votre propre correction."
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
            {envoi ? 'Envoi…' : 'Envoyer'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <Champ id={`${id}-jour`} label="Jour" requis>
          <input
            id={`${id}-jour`}
            type="date"
            max={aujourdhui()}
            className={CHAMP}
            value={jour}
            onChange={(e) => setJour(e.target.value)}
          />
        </Champ>
        <div className="grid grid-cols-2 gap-3">
          <Champ id={`${id}-in`} label="Arrivée (heure de Kinshasa)">
            <input
              id={`${id}-in`}
              type="time"
              className={CHAMP}
              value={arrivee}
              onChange={(e) => setArrivee(e.target.value)}
            />
          </Champ>
          <Champ id={`${id}-out`} label="Départ">
            <input
              id={`${id}-out`}
              type="time"
              className={CHAMP}
              value={depart}
              onChange={(e) => setDepart(e.target.value)}
            />
          </Champ>
        </div>
        <Champ id={`${id}-motif`} label="Motif" requis>
          <input
            id={`${id}-motif`}
            className={CHAMP}
            value={motif}
            maxLength={300}
            onChange={(e) => setMotif(e.target.value)}
          />
        </Champ>
        <ErreurAction erreur={erreur} />
      </div>
    </Modal>
  );
}
