'use client';

// « Planning » — ADR-0051 § 2.4, § 3.6, § 10 (lot H16). Éteint par défaut : l'écran
// explique comment l'activer, sans aucune donnée. Activé : la semaine par personne ;
// le manager (son équipe) ou les RH saisissent des brouillons, publient, copient une
// semaine. Les constats et le sous-effectif viennent du moteur : des signaux, jamais
// des refus. Aucune affectation automatique.
//
// ADR-0074 : personne en `EntityPicker`, jour en `DatePicker` (heures natives).

import {
  Badge,
  Button,
  Checkbox,
  DatePicker,
  EntityPicker,
  Field,
  FormGrid,
  Modal,
  TextInput,
  buttonClasses,
  correspondRecherche,
} from '@lalanda/ui';
import { CalendarRange } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';

import { hrApi, type HrEmployeeListItem } from '@/lib/api-hr';
import {
  rh2Api,
  type HrPresenceSettingsView,
  type PlanningGapsView,
  type ShiftListView,
  type ShiftView,
} from '@/lib/api-rh-2';

import { BOUTON_PETIT } from '../../ventes/_components/form-ui';

import {
  LIBELLES_STATUT_CRENEAU,
  brouillonsPublies,
  constatsDe,
  grille,
  horaire,
  libelleConstatPlanning,
  peutPlanifier,
  phraseSousEffectif,
  porteeParDefaut,
} from './planning-model';
import { useAccesRh } from './rh-access';
import { decaler, jourCourt, joursSemaine, lundiDe, messageRh2 } from './rh2-model';
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

export function Planning(): React.ReactElement {
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

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={CalendarRange}
        titre="Planning"
        sousTitre="Qui travaille quand et où. Le manager ou les ressources humaines établissent et publient la semaine ; Lalanda signale les chevauchements, les absences et le sous-effectif, sans jamais placer personne."
      />
      {reglages === null ? (
        <Chargement />
      ) : !reglages.ok ? (
        <EchecLecture erreur={reglages.erreur} repli="Réglages illisibles." />
      ) : !reglages.valeur.planning.enabled ? (
        <FonctionEteinte fonction="planning" actions={actions} />
      ) : (
        <PlanningActif
          planificateur={peutPlanifier(actions, moi.estManager)}
          portee={porteeParDefaut(actions, moi.estManager)}
          ecarts={moi.estManager || (actions !== null && actions.includes('hr.read'))}
        />
      )}
    </section>
  );
}

function PlanningActif({
  planificateur,
  portee,
  ecarts,
}: {
  planificateur: boolean;
  portee: 'me' | 'team' | 'organization';
  ecarts: boolean;
}): React.ReactElement {
  const [lundi, setLundi] = useState(lundiDe(aujourdhui()));
  const [liste, setListe] = useState<Lecture<ShiftListView> | null>(null);
  const [trous, setTrous] = useState<PlanningGapsView | null>(null);
  const [version, setVersion] = useState(0);
  const [nouveau, setNouveau] = useState(false);
  const [ouvert, setOuvert] = useState<ShiftView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const relire = useCallback(() => setVersion((v) => v + 1), []);
  const jours = joursSemaine(lundi);
  const dimanche = decaler(lundi, 6);

  useEffect(() => {
    let annule = false;
    setListe(null);
    void lire(rh2Api.listShifts({ from: lundi, to: dimanche, scope: portee })).then((l) => {
      if (!annule) setListe(l);
    });
    if (ecarts) {
      rh2Api
        .planningGaps({ from: lundi, to: dimanche })
        .then((g) => {
          if (!annule) setTrous(g);
        })
        .catch(() => {
          if (!annule) setTrous(null);
        });
    }
    return () => {
      annule = true;
    };
  }, [lundi, dimanche, portee, ecarts, version]);

  async function agir(f: () => Promise<unknown>, repli: string): Promise<void> {
    setErreur(null);
    setEnvoi(true);
    try {
      await f();
      relire();
    } catch (err) {
      setErreur(messageRh2(err, repli));
    } finally {
      setEnvoi(false);
    }
  }

  const brouillons = liste?.ok ? brouillonsPublies(liste.valeur.items) : [];

  return (
    <>
      <Panneau
        titre={`Semaine du ${jourCourt(lundi)} au ${jourCourt(dimanche)}`}
        icone={CalendarRange}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={BOUTON_PETIT}
              onClick={() => setLundi(decaler(lundi, -7))}
            >
              ← Précédente
            </button>
            <button
              type="button"
              className={BOUTON_PETIT}
              onClick={() => setLundi(decaler(lundi, 7))}
            >
              Suivante →
            </button>
            {planificateur ? (
              <>
                <button
                  type="button"
                  className={BOUTON_PETIT}
                  disabled={envoi}
                  onClick={() =>
                    void agir(() => rh2Api.copyWeek(decaler(lundi, -7), lundi), 'Copie impossible.')
                  }
                >
                  Copier la semaine précédente
                </button>
                {brouillons.length > 0 ? (
                  <button
                    type="button"
                    className={BOUTON_PETIT}
                    disabled={envoi}
                    onClick={() =>
                      void agir(() => rh2Api.publishShifts(brouillons), 'Publication impossible.')
                    }
                  >
                    Publier {brouillons.length} brouillon{brouillons.length > 1 ? 's' : ''}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={buttonClasses('primary', 'sm')}
                  onClick={() => setNouveau(true)}
                >
                  + Créneau
                </button>
              </>
            ) : null}
          </div>
        }
      >
        <ErreurAction erreur={erreur} />
        {liste === null ? (
          <Chargement />
        ) : !liste.ok ? (
          <EchecLecture erreur={liste.erreur} repli="Planning illisible." onReessayer={relire} />
        ) : liste.valeur.items.length === 0 ? (
          <PhraseSection>
            Aucun créneau cette semaine.
            {planificateur
              ? ' Ajoutez-en avec « + Créneau » ou copiez la semaine précédente (les copies sont des brouillons).'
              : ''}
          </PhraseSection>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="text-left text-xs text-[var(--foreground-muted)]">
                <tr>
                  <th className="py-2 pr-3">Personne</th>
                  {jours.map((j) => (
                    <th key={j} className="py-2 pr-2">
                      {jourCourt(j)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {grille(liste.valeur.items, jours).map((l) => (
                  <tr key={l.employeeId}>
                    <td className="py-2 pr-3 font-medium">{l.nom}</td>
                    {l.jours.map((cs, i) => (
                      <td key={jours[i]} className="py-2 pr-2 align-top">
                        <ul className="flex flex-col gap-1">
                          {cs.map((c) => (
                            <li key={c.id}>
                              <button
                                type="button"
                                onClick={() => setOuvert(c)}
                                className={`w-full rounded-[var(--radius-sm)] border px-2 py-1 text-left text-xs transition hover:border-[var(--accent)] ${c.status === 'draft' ? 'border-dashed border-[var(--border-strong)]' : 'border-[var(--border)] bg-[var(--surface-muted)]'}`}
                              >
                                <span className="block tabular-nums">{horaire(c)}</span>
                                {c.label || c.location ? (
                                  <span className="block text-[var(--foreground-muted)]">
                                    {c.label ?? c.location}
                                  </span>
                                ) : null}
                                {c.status === 'draft' ? (
                                  <span className="block">Brouillon</span>
                                ) : null}
                                {constatsDe(c.id, liste.valeur.findings).length > 0 ||
                                c.unavailability ? (
                                  <span className="block text-[var(--danger)]">À revoir</span>
                                ) : null}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panneau>

      {trous && (trous.gaps.length > 0 || trous.findings.length > 0) ? (
        <Panneau titre="Constats de la semaine">
          <ul className="flex flex-col gap-1 text-sm">
            {trous.gaps.map((g) => (
              <li key={`${g.needId}-${g.date}`}>
                <Badge tone="warning">Sous-effectif</Badge> {jourCourt(g.date)} ·{' '}
                {phraseSousEffectif(g)}
              </li>
            ))}
            {trous.findings.map((f, i) => (
              <li key={`${f.code}-${i}`}>
                <Badge tone="warning">{libelleConstatPlanning(f.code)}</Badge>
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--foreground-muted)]">
            Des signaux calculés par Lalanda à partir des minimums et des seuils saisis par votre
            organisation. Aucune règle légale n’est appliquée ; le planificateur décide.
          </p>
        </Panneau>
      ) : null}

      {nouveau ? (
        <NouveauCreneau
          jourParDefaut={lundi}
          portee={portee}
          onFermer={() => setNouveau(false)}
          onCree={() => {
            setNouveau(false);
            relire();
          }}
        />
      ) : null}
      {ouvert ? (
        <DetailCreneau
          creneau={ouvert}
          constats={liste?.ok ? constatsDe(ouvert.id, liste.valeur.findings) : []}
          onFermer={() => setOuvert(null)}
          onChange={() => {
            setOuvert(null);
            relire();
          }}
        />
      ) : null}
    </>
  );
}

function NouveauCreneau({
  jourParDefaut,
  portee,
  onFermer,
  onCree,
}: {
  jourParDefaut: string;
  portee: 'me' | 'team' | 'organization';
  onFermer: () => void;
  onCree: () => void;
}): React.ReactElement {
  const id = useId();
  const [personnes, setPersonnes] = useState<HrEmployeeListItem[]>([]);
  const [personne, setPersonne] = useState('');
  const [jour, setJour] = useState(jourParDefaut);
  const [debut, setDebut] = useState('08:00');
  const [fin, setFin] = useState('16:00');
  const [lendemain, setLendemain] = useState(false);
  const [lieu, setLieu] = useState('');
  const [libelle, setLibelle] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [constats, setConstats] = useState<string[]>([]);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    let annule = false;
    const p =
      portee === 'organization'
        ? hrApi.listEmployees({ status: 'active', limit: 200 }).then((x) => x.items)
        : hrApi.getTeam().then((t) => t.members.map((m) => m.employee));
    p.then((items) => {
      if (!annule) setPersonnes(items);
    }).catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [portee]);
  // ADR-0074 § 4 : la personne se choisit en tapant son nom.
  const choix = personnes.map((p) => ({ id: p.id, nom: nomAffiche(p) }));

  async function creer(): Promise<void> {
    if (personne === '') {
      setErreur('Choisissez la personne.');
      return;
    }
    // Le jour était `required` ; le calendrier peut être vidé au clavier.
    if (jour === '') {
      setErreur('Le jour est obligatoire.');
      return;
    }
    setErreur(null);
    setEnvoi(true);
    try {
      const r = await rh2Api.createShift({
        employeeId: personne,
        date: jour,
        start: debut,
        end: fin,
        ...(lendemain ? { crossesMidnight: true } : {}),
        ...(lieu.trim() ? { location: lieu.trim() } : {}),
        ...(libelle.trim() ? { label: libelle.trim() } : {}),
      });
      const c = r.findings.map((f) => libelleConstatPlanning(f.code));
      if (c.length > 0) setConstats(c);
      else onCree();
    } catch (err) {
      setErreur(messageRh2(err, 'Créneau impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={constats.length > 0 ? onCree : onFermer}
      title="Nouveau créneau"
      description="Le créneau est un brouillon : la personne n’est prévenue qu’à la publication."
      size="sm"
      busy={envoi}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {constats.length > 0 ? (
            <button type="button" className={buttonClasses('primary', 'sm')} onClick={onCree}>
              Compris
            </button>
          ) : (
            <>
              <Button onClick={onFermer} disabled={envoi}>
                Retour
              </Button>
              <Button variant="primary" busy={envoi} onClick={() => void creer()}>
                {envoi ? 'Enregistrement…' : 'Créer le brouillon'}
              </Button>
            </>
          )}
        </div>
      }
    >
      {constats.length > 0 ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>Le créneau est enregistré. Lalanda signale :</p>
          <ul className="list-disc pl-5">
            {constats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="text-xs text-[var(--foreground-muted)]">
            Un signal, pas un refus : à vous de décider.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <FormGrid>
            <Field id={`${id}-p`} label="Personne" required size="lg">
              <EntityPicker<{ id: string; nom: string }>
                value={choix.find((p) => p.id === personne) ?? null}
                onChange={(p) => setPersonne(p?.id ?? '')}
                search={async (q) => choix.filter((p) => correspondRecherche([p.nom], q))}
                refreshKey={choix.length}
                getKey={(p) => p.id}
                getLabel={(p) => p.nom}
                placeholder="Tapez un nom"
                debounceMs={0}
                emptyText="Aucun collaborateur actif ne correspond."
              />
            </Field>
            <Field id={`${id}-j`} label="Jour" required size="sm" newRow>
              <DatePicker value={jour} required onChange={setJour} shortcuts={['today', 'plus7']} />
            </Field>
            <Field id={`${id}-d`} label="Début" required size="xs" newRow>
              <TextInput type="time" value={debut} onChange={(e) => setDebut(e.target.value)} />
            </Field>
            <Field id={`${id}-f`} label="Fin" required size="xs">
              <TextInput type="time" value={fin} onChange={(e) => setFin(e.target.value)} />
            </Field>
            <div className="col-span-full">
              <Checkbox checked={lendemain} onChange={setLendemain} label="Finit le lendemain" />
            </div>
            <Field id={`${id}-l`} label="Lieu" optional size="md" newRow>
              <TextInput value={lieu} maxLength={120} onChange={(e) => setLieu(e.target.value)} />
            </Field>
            <Field id={`${id}-t`} label="Intitulé" optional size="md">
              <TextInput
                value={libelle}
                maxLength={60}
                onChange={(e) => setLibelle(e.target.value)}
              />
            </Field>
          </FormGrid>
          <ErreurAction erreur={erreur} />
        </div>
      )}
    </Modal>
  );
}

function DetailCreneau({
  creneau: c,
  constats,
  onFermer,
  onChange,
}: {
  creneau: ShiftView;
  constats: string[];
  onFermer: () => void;
  onChange: () => void;
}): React.ReactElement {
  const [dialogue, setDialogue] = useState<'annuler' | 'indispo' | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function publier(): Promise<void> {
    setErreur(null);
    try {
      await rh2Api.publishShifts([c.id]);
      onChange();
    } catch (err) {
      setErreur(messageRh2(err, 'Publication impossible.'));
    }
  }

  return (
    <>
      <Modal
        open={dialogue === null}
        onClose={onFermer}
        title={`${c.employeeName} · ${jourCourt(c.date)}`}
        description={horaire(c)}
        size="sm"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            {c.canPlan && c.status !== 'cancelled' ? (
              <button type="button" className={BOUTON_PETIT} onClick={() => setDialogue('annuler')}>
                Annuler le créneau
              </button>
            ) : null}
            {!c.canPlan && c.status === 'published' ? (
              <button type="button" className={BOUTON_PETIT} onClick={() => setDialogue('indispo')}>
                Signaler une indisponibilité
              </button>
            ) : null}
            {c.canPlan && c.status === 'draft' ? (
              <button
                type="button"
                className={buttonClasses('primary', 'sm')}
                onClick={() => void publier()}
              >
                Publier
              </button>
            ) : null}
          </div>
        }
      >
        <div className="flex flex-col gap-2 text-sm">
          <Badge tone={c.status === 'published' ? 'success' : 'neutral'}>
            {LIBELLES_STATUT_CRENEAU[c.status]}
          </Badge>
          {c.label ? <p>{c.label}</p> : null}
          {c.location ? <p>Lieu : {c.location}</p> : null}
          {c.note ? <p>{c.note}</p> : null}
          {c.unavailability ? (
            <p>Indisponibilité signalée : « {c.unavailability.comment} »</p>
          ) : null}
          {constats.map((x) => (
            <Badge key={x} tone="warning">
              {x}
            </Badge>
          ))}
          <ErreurAction erreur={erreur} />
        </div>
      </Modal>
      {dialogue === 'annuler' ? (
        <DialogueDecision
          titre="Annuler le créneau"
          libelle=""
          bouton="Annuler le créneau"
          commentaire="aucun"
          onFermer={() => setDialogue(null)}
          onValider={async () => {
            await rh2Api.cancelShift(c.id, c.revision);
            onChange();
          }}
        />
      ) : null}
      {dialogue === 'indispo' ? (
        <DialogueDecision
          titre="Signaler une indisponibilité"
          description="Votre planificateur est prévenu ; c’est lui qui modifie le planning."
          libelle="Commentaire"
          bouton="Signaler"
          commentaire="obligatoire"
          onFermer={() => setDialogue(null)}
          onValider={async (t) => {
            await rh2Api.signalUnavailability(c.id, t);
            onChange();
          }}
        />
      ) : null}
    </>
  );
}
