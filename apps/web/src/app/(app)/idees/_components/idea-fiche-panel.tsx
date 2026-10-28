'use client';

// Fiche d'une idée (ADR-0036 § 1, § 3, § 4) : problème, cible, solution,
// alternatives, modèle de revenus, marché, hypothèses, taille de marché SOURCÉE ;
// assistance IA sur demande (suggestions appliquées au formulaire seulement) ;
// passage vers le Canvas d'un projet existant ou nouveau.

import { Button, DataNature } from '@lalanda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import {
  HYPOTHESIS_STATUSES,
  ideaLabApi,
  MARKET_UNITS,
  type AssistIntent,
  type AssistResponse,
  type IdeaView,
} from '@/lib/idea-lab-api';

import { Bloc, Chargement, Erreur } from '../../croissance/_components/grow-ui';
import { useAccesIdees } from './idees-chrome';
import { IdeaHeader } from './idea-header';
import {
  appliquerSuggestion,
  corpsFiche,
  ficheDepuisIdee,
  LIBELLES_UNITES,
  lienNouveauProjet,
  messageErreur,
  nouvelIdHypothese,
  origineAssistance,
  type FicheForm,
} from './idea-model';

const CHAMP =
  'rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm disabled:opacity-70';

const LIBELLES_HYPOTHESES = {
  a_tester: 'À tester',
  confirmee: 'Confirmée',
  infirmee: 'Infirmée',
} as const;

function Texte({
  label,
  value,
  onChange,
  max,
  rows = 3,
  disabled,
  aide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  rows?: number;
  disabled: boolean;
  aide?: string;
}): React.ReactElement {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {aide && <span className="text-xs text-[var(--foreground-muted)]">{aide}</span>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={max}
        rows={rows}
        disabled={disabled}
        className={CHAMP}
      />
    </label>
  );
}

export function IdeaFichePanel({ id }: { id: string }): React.ReactElement {
  const acces = useAccesIdees();
  const router = useRouter();
  const [idea, setIdea] = useState<IdeaView | null>(null);
  const [form, setForm] = useState<FicheForm | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ton: 'ok' | 'ko'; texte: string } | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [assist, setAssist] = useState<AssistResponse | null>(null);
  const [assistEnCours, setAssistEnCours] = useState<AssistIntent | null>(null);
  const [projets, setProjets] = useState<{ id: string; name: string }[] | null>(null);
  const [projetChoisi, setProjetChoisi] = useState('');

  const charger = useCallback(async (): Promise<void> => {
    setErreur(null);
    try {
      const i = await ideaLabApi.get(id);
      setIdea(i);
      setForm(ficheDepuisIdee(i));
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de charger cette idée.'));
    }
  }, [id]);

  useEffect(() => {
    void charger();
    void api
      .listProjects()
      .then(({ projects }) => setProjets(projects.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setProjets([]));
  }, [charger]);

  if (erreur) return <Erreur message={erreur} onRetry={() => void charger()} />;
  if (!idea || !form) return <Chargement />;

  const lecture = !acces.modifier;
  const maj = (patch: Partial<FicheForm>): void => setForm({ ...form, ...patch });

  async function enregistrer(): Promise<void> {
    if (!form) return;
    const r = corpsFiche(form);
    if (!r.ok) {
      setMessage({ ton: 'ko', texte: r.erreur });
      return;
    }
    setEnCours(true);
    setMessage(null);
    try {
      const i = await ideaLabApi.update(id, r.body);
      setIdea(i);
      setForm(ficheDepuisIdee(i));
      setMessage({ ton: 'ok', texte: 'Fiche enregistrée.' });
    } catch (err) {
      setMessage({ ton: 'ko', texte: messageErreur(err, 'Enregistrement impossible.') });
    } finally {
      setEnCours(false);
    }
  }

  async function demander(intent: AssistIntent): Promise<void> {
    setAssistEnCours(intent);
    setMessage(null);
    try {
      setAssist(await ideaLabApi.assist(id, intent));
    } catch (err) {
      setMessage({ ton: 'ko', texte: messageErreur(err, 'Assistance indisponible.') });
    } finally {
      setAssistEnCours(null);
    }
  }

  async function promouvoir(): Promise<void> {
    if (projetChoisi === '') return;
    setMessage(null);
    try {
      const r = await ideaLabApi.promote(id, projetChoisi);
      router.push(`/initiatives/${r.projectId}/canvas`);
    } catch (err) {
      setMessage({ ton: 'ko', texte: messageErreur(err, 'Passage au projet impossible.') });
    }
  }

  async function archiver(archived: boolean): Promise<void> {
    try {
      const i = await ideaLabApi.setArchived(id, archived);
      setIdea(i);
    } catch (err) {
      setMessage({ ton: 'ko', texte: messageErreur(err, 'Action impossible.') });
    }
  }

  const m = form.marche;
  return (
    <div className="flex flex-col gap-8">
      <IdeaHeader idea={idea} courant="fiche" />

      <Bloc titre="La fiche" aside={<DataNature nature="hypothese" />}>
        <div className="doc-card flex flex-col gap-4 p-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Nom de l’idée</span>
            <input
              value={form.title}
              onChange={(e) => maj({ title: e.target.value })}
              maxLength={120}
              disabled={lecture}
              className={CHAMP}
            />
          </label>
          <Texte
            label="Problème"
            aide="Ce que vit le client aujourd’hui, avec ses mots."
            value={form.problem}
            onChange={(v) => maj({ problem: v })}
            max={1000}
            disabled={lecture}
          />
          <Texte
            label="Client cible"
            aide="Qui, où, et comment le joindre."
            value={form.target}
            onChange={(v) => maj({ target: v })}
            max={1000}
            disabled={lecture}
          />
          <Texte
            label="Solution"
            value={form.solution}
            onChange={(v) => maj({ solution: v })}
            max={1000}
            disabled={lecture}
          />
          <Texte
            label="Modèle de revenus envisagé"
            aide="Qui paie, quoi, et comment (vente, abonnement, commission…)."
            value={form.revenueModel}
            onChange={(v) => maj({ revenueModel: v })}
            max={1000}
            rows={2}
            disabled={lecture}
          />
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Pays (ISO)</span>
              <input
                value={form.country}
                onChange={(e) => maj({ country: e.target.value })}
                maxLength={2}
                disabled={lecture}
                className={CHAMP}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Marché, en mots</span>
              <input
                value={form.market}
                onChange={(e) => maj({ market: e.target.value })}
                maxLength={300}
                disabled={lecture}
                className={CHAMP}
              />
            </label>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Alternatives existantes</legend>
            {form.alternatives.map((a, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-3">
                <input
                  aria-label={`Alternative ${i + 1} : nom`}
                  placeholder="Nom"
                  value={a.name}
                  disabled={lecture}
                  onChange={(e) =>
                    maj({
                      alternatives: form.alternatives.map((x, j) =>
                        j === i ? { ...x, name: e.target.value } : x,
                      ),
                    })
                  }
                  className={CHAMP}
                />
                <input
                  aria-label={`Alternative ${i + 1} : description`}
                  placeholder="Ce qu’elle fait, son prix observé"
                  value={a.description}
                  disabled={lecture}
                  onChange={(e) =>
                    maj({
                      alternatives: form.alternatives.map((x, j) =>
                        j === i ? { ...x, description: e.target.value } : x,
                      ),
                    })
                  }
                  className={CHAMP}
                />
                <input
                  aria-label={`Alternative ${i + 1} : source`}
                  placeholder="D’où vient l’information"
                  value={a.source}
                  disabled={lecture}
                  onChange={(e) =>
                    maj({
                      alternatives: form.alternatives.map((x, j) =>
                        j === i ? { ...x, source: e.target.value } : x,
                      ),
                    })
                  }
                  className={CHAMP}
                />
              </div>
            ))}
            {!lecture && form.alternatives.length < 10 && (
              <div>
                <Button
                  size="sm"
                  onClick={() =>
                    maj({
                      alternatives: [
                        ...form.alternatives,
                        { name: '', description: '', source: '' },
                      ],
                    })
                  }
                >
                  Ajouter une alternative
                </Button>
              </div>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Hypothèses clés</legend>
            {form.hypotheses.map((h, i) => (
              <div key={h.id} className="grid gap-2 sm:grid-cols-[1fr_10rem]">
                <input
                  aria-label={`Hypothèse ${i + 1}`}
                  value={h.text}
                  disabled={lecture}
                  maxLength={300}
                  onChange={(e) =>
                    maj({
                      hypotheses: form.hypotheses.map((x) =>
                        x.id === h.id ? { ...x, text: e.target.value } : x,
                      ),
                    })
                  }
                  className={CHAMP}
                />
                <select
                  aria-label={`Statut de l’hypothèse ${i + 1}`}
                  value={h.status}
                  disabled={lecture}
                  onChange={(e) =>
                    maj({
                      hypotheses: form.hypotheses.map((x) =>
                        x.id === h.id
                          ? { ...x, status: e.target.value as (typeof HYPOTHESIS_STATUSES)[number] }
                          : x,
                      ),
                    })
                  }
                  className={CHAMP}
                >
                  {HYPOTHESIS_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {LIBELLES_HYPOTHESES[s]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {!lecture && form.hypotheses.length < 20 && (
              <div>
                <Button
                  size="sm"
                  onClick={() =>
                    maj({
                      hypotheses: [
                        ...form.hypotheses,
                        { id: nouvelIdHypothese(form.hypotheses), text: '', status: 'a_tester' },
                      ],
                    })
                  }
                >
                  Ajouter une hypothèse
                </Button>
              </div>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3">
            <legend className="px-1 text-sm font-medium">Taille de marché déclarée</legend>
            <p className="text-xs text-[var(--foreground-muted)]">
              Facultative. Si vous la renseignez, sa <strong>source est obligatoire</strong> :
              Lalanda n’estime aucun marché et n’accepte aucun chiffre sans sa provenance. Elle
              n’est reprise dans aucun plan.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <input
                aria-label="Valeur"
                placeholder="Valeur"
                inputMode="decimal"
                value={m.value}
                disabled={lecture}
                onChange={(e) => maj({ marche: { ...m, value: e.target.value } })}
                className={CHAMP}
              />
              <select
                aria-label="Unité"
                value={m.unit}
                disabled={lecture}
                onChange={(e) =>
                  maj({ marche: { ...m, unit: e.target.value as (typeof MARKET_UNITS)[number] } })
                }
                className={CHAMP}
              >
                {MARKET_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {LIBELLES_UNITES[u]}
                  </option>
                ))}
              </select>
              {m.unit === 'montant' && (
                <input
                  aria-label="Devise"
                  placeholder="Devise (USD, CDF…)"
                  maxLength={3}
                  value={m.currency}
                  disabled={lecture}
                  onChange={(e) => maj({ marche: { ...m, currency: e.target.value } })}
                  className={CHAMP}
                />
              )}
            </div>
            <input
              aria-label="Périmètre"
              placeholder="Ce qui est compté (ex. commerçantes de poisson des marchés de Kinshasa)"
              value={m.scope}
              disabled={lecture}
              maxLength={300}
              onChange={(e) => maj({ marche: { ...m, scope: e.target.value } })}
              className={CHAMP}
            />
            <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
              <input
                aria-label="Source (obligatoire)"
                placeholder="Source (obligatoire) : étude, institut, comptage…"
                value={m.source}
                disabled={lecture}
                maxLength={300}
                onChange={(e) => maj({ marche: { ...m, source: e.target.value } })}
                className={CHAMP}
              />
              <input
                aria-label="Date de la source"
                type="date"
                value={m.sourceDate}
                disabled={lecture}
                onChange={(e) => maj({ marche: { ...m, sourceDate: e.target.value } })}
                className={CHAMP}
              />
            </div>
            <input
              aria-label="Lien vers la source"
              placeholder="Lien vers la source (facultatif)"
              value={m.sourceUrl}
              disabled={lecture}
              maxLength={500}
              onChange={(e) => maj({ marche: { ...m, sourceUrl: e.target.value } })}
              className={CHAMP}
            />
          </fieldset>

          {!lecture && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" busy={enCours} onClick={() => void enregistrer()}>
                Enregistrer la fiche
              </Button>
              <Button size="sm" onClick={() => void archiver(!idea.archived)}>
                {idea.archived ? 'Réactiver l’idée' : 'Archiver l’idée'}
              </Button>
            </div>
          )}
          {message && (
            <p
              role="status"
              className={`text-sm ${message.ton === 'ok' ? 'text-[var(--ok)]' : 'text-[var(--danger)]'}`}
            >
              {message.texte}
            </p>
          )}
        </div>
      </Bloc>

      {!lecture && (
        <Bloc titre="Assistance IA" aside={<DataNature nature="suggestion" />}>
          <div className="doc-card flex flex-col gap-3 p-4 text-sm">
            <p className="text-[var(--foreground-muted)]">
              Sur demande, le texte de cette fiche est envoyé à l’IA, qui propose une reformulation,
              des questions d’entretien ou des hypothèses. Elle n’ajoute aucun chiffre ; rien n’est
              enregistré sans vous. Chaque demande compte un message IA.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                busy={assistEnCours === 'reformuler'}
                onClick={() => void demander('reformuler')}
              >
                Reformuler
              </Button>
              <Button
                size="sm"
                busy={assistEnCours === 'questions_entretien'}
                onClick={() => void demander('questions_entretien')}
              >
                Questions d’entretien
              </Button>
              <Button
                size="sm"
                busy={assistEnCours === 'hypotheses'}
                onClick={() => void demander('hypotheses')}
              >
                Hypothèses à tester
              </Button>
            </div>
            {assist && (
              <div className="flex flex-col gap-2 rounded-md border border-dashed border-[var(--module-grow)] p-3">
                <p className="text-xs text-[var(--foreground-muted)]">
                  {origineAssistance(assist.source, assist.reason)}
                </p>
                {assist.answer.intent === 'reformuler' && (
                  <>
                    <dl className="flex flex-col gap-1">
                      <dt className="font-medium">Problème</dt>
                      <dd>{assist.answer.reformulation.probleme || '—'}</dd>
                      <dt className="font-medium">Cible</dt>
                      <dd>{assist.answer.reformulation.cible || '—'}</dd>
                      <dt className="font-medium">Solution</dt>
                      <dd>{assist.answer.reformulation.solution || '—'}</dd>
                    </dl>
                    <div>
                      <Button
                        size="sm"
                        onClick={() => setForm(appliquerSuggestion(form, assist.answer))}
                      >
                        Reprendre dans le formulaire
                      </Button>
                    </div>
                  </>
                )}
                {assist.answer.intent === 'questions_entretien' && (
                  <ol className="list-decimal pl-5">
                    {assist.answer.questions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ol>
                )}
                {assist.answer.intent === 'hypotheses' && (
                  <>
                    <ul className="flex flex-col gap-1">
                      {assist.answer.hypotheses.map((h) => (
                        <li key={h.texte}>
                          <span className="font-medium">{h.texte}</span>
                          <span className="text-[var(--foreground-muted)]"> — test : {h.test}</span>
                        </li>
                      ))}
                    </ul>
                    <div>
                      <Button
                        size="sm"
                        onClick={() => setForm(appliquerSuggestion(form, assist.answer))}
                      >
                        Ajouter aux hypothèses du formulaire
                      </Button>
                    </div>
                  </>
                )}
                <p className="text-xs text-[var(--foreground-muted)]">{assist.mention}</p>
              </div>
            )}
          </div>
        </Bloc>
      )}

      {!lecture && (
        <Bloc titre="Passer au plan financier">
          <div className="doc-card flex flex-col gap-3 p-4 text-sm">
            <p className="text-[var(--foreground-muted)]">
              Le problème, la solution, la cible et le modèle de revenus deviennent des cartes du
              Canvas du projet. Aucun chiffre n’est repris ; vous poursuivez ensuite dans le Canvas
              et l’assistant de saisie habituels.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Projet existant"
                value={projetChoisi}
                onChange={(e) => setProjetChoisi(e.target.value)}
                className={CHAMP}
              >
                <option value="">Choisir un projet existant…</option>
                {(projets ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button disabled={projetChoisi === ''} onClick={() => void promouvoir()}>
                Ajouter au Canvas de ce projet
              </Button>
              <span className="text-[var(--foreground-muted)]">ou</span>
              <Link href={lienNouveauProjet(id)} className="underline hover:text-[var(--accent)]">
                Créer un nouveau projet à partir de cette idée
              </Link>
            </div>
            {idea.promotions.length > 0 && (
              <p className="text-xs text-[var(--foreground-muted)]">
                Déjà passée au plan {idea.promotions.length} fois (dernière fois le{' '}
                {new Date(idea.promotions.at(-1)!.at).toLocaleDateString('fr-FR')}).
              </p>
            )}
          </div>
        </Bloc>
      )}
    </div>
  );
}
