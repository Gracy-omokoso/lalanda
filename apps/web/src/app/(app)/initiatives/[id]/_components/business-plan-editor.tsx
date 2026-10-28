'use client';

// Business plan narratif d'un projet (ADR-0037).
//
// Trois natures de contenu, jamais mélangées à l'écran :
//   · le TEXTE de chaque section, écrit par l'utilisateur (ou accepté d'une
//     proposition de l'IA — l'origine reste affichée) ;
//   · la PROPOSITION de l'IA, encadrée « Suggestion IA » en pointillés, tant
//     qu'elle n'est ni acceptée ni écartée ;
//   · les TABLEAUX et HYPOTHÈSES du moteur, en lecture seule, relus par le
//     serveur dans le plan figé rattaché.
//
// L'IA n'est appelée que sur un clic : chaque appel consomme le quota du mois.

import { Alert, Badge, Button, DataNature } from '@lalanda/ui';
import { useCallback, useEffect, useState } from 'react';

import {
  businessPlanApi,
  type AssembledTable,
  type BusinessPlanView,
  type SectionId,
  type SectionView,
} from '@/lib/business-plan-api';

import {
  avancement,
  empreinteCourte,
  etatValidation,
  libelleOrigine,
  messageBrouillon,
  statutDocument,
} from './business-plan-model';

function messageDe(err: unknown, repli: string): string {
  return err instanceof Error && err.message !== '' ? err.message : repli;
}

function telecharger(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const dateFr = (iso: string): string =>
  new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(iso));

export function BusinessPlanEditor({ projectId }: { projectId: string }): React.ReactElement {
  const [vue, setVue] = useState<BusinessPlanView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    ton: 'success' | 'warning' | 'danger';
    texte: string;
  } | null>(null);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async (): Promise<void> => {
    try {
      setVue(await businessPlanApi.get(projectId));
      setErreur(null);
    } catch (err) {
      setErreur(messageDe(err, 'Impossible de charger le business plan.'));
    }
  }, [projectId]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const agir = useCallback(
    async (fn: () => Promise<BusinessPlanView | void>, succes?: string): Promise<void> => {
      setOccupe(true);
      setMessage(null);
      try {
        const v = await fn();
        if (v) setVue(v);
        else await charger();
        if (succes) setMessage({ ton: 'success', texte: succes });
      } catch (err) {
        setMessage({ ton: 'danger', texte: messageDe(err, 'L’opération a échoué.') });
      } finally {
        setOccupe(false);
      }
    },
    [charger],
  );

  if (erreur) return <Alert tone="danger">{erreur}</Alert>;
  if (!vue) return <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>;

  const statut = statutDocument(vue);
  const validation = etatValidation(vue);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl font-semibold tracking-tight">Business plan</h2>
          <Badge tone={statut.ton}>{statut.libelle}</Badge>
          <span className="text-xs text-[var(--foreground-muted)]">{avancement(vue.sections)}</span>
        </div>
        <p className="text-sm text-[var(--foreground-muted)]">
          Vous rédigez chaque section ; l’IA peut proposer un brouillon à partir de votre Canvas, de
          vos hypothèses et de vos réponses. Les tableaux du plan financier sont ceux du moteur de
          Lalanda, insérés sans modification.
        </p>
      </header>

      {message ? <Alert tone={message.ton}>{message.texte}</Alert> : null}

      <RattachementPlan
        vue={vue}
        occupe={occupe}
        onChange={(n) => void agir(() => businessPlanApi.setPlan(projectId, n))}
      />

      {vue.sections.map((s) => (
        <SectionBloc
          key={s.id}
          section={s}
          vue={vue}
          occupe={occupe}
          onSave={(text) =>
            void agir(
              () => businessPlanApi.saveSection(projectId, s.id, text),
              'Section enregistrée.',
            )
          }
          onDraft={async (notes) => {
            setOccupe(true);
            setMessage(null);
            try {
              const r = await businessPlanApi.draft(projectId, s.id, notes);
              setMessage(messageBrouillon(r));
              await charger();
            } catch (err) {
              setMessage({ ton: 'danger', texte: messageDe(err, 'L’aide IA a échoué.') });
            } finally {
              setOccupe(false);
            }
          }}
          onAccept={() => void agir(() => businessPlanApi.accept(projectId, s.id as SectionId))}
          onDiscard={() => void agir(() => businessPlanApi.discard(projectId, s.id as SectionId))}
        />
      ))}

      <section
        aria-labelledby="bp-versions"
        className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4"
      >
        <h3 id="bp-versions" className="text-sm font-semibold uppercase tracking-wide">
          Validation et exports
        </h3>
        {validation.raisons.length > 0 ? (
          <ul className="list-disc pl-5 text-sm text-[var(--foreground-muted)]">
            {validation.raisons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={occupe || !validation.possible}
            onClick={() =>
              void agir(async () => {
                await businessPlanApi.validate(projectId);
              }, 'Version validée.')
            }
          >
            Valider une version
          </Button>
          {vue.permissions.export ? (
            <Button
              type="button"
              variant="secondary"
              disabled={occupe}
              onClick={() =>
                void agir(async () => {
                  const f = await businessPlanApi.downloadPdf(projectId);
                  telecharger(f.blob, f.filename);
                })
              }
            >
              PDF du brouillon
            </Button>
          ) : null}
        </div>
        {vue.versions.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">Aucune version validée.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {vue.versions.map((v) => (
              <li key={v.version} className="flex flex-wrap items-center gap-2 text-sm">
                <strong>Version {v.version}</strong>
                <span className="text-[var(--foreground-muted)]">
                  validée le {dateFr(v.approvedAt)} — plan financier v{v.plan.version}
                  {v.soleApprover ? ' — validée par son auteur (approbateur unique)' : ''}
                </span>
                {vue.permissions.export ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={occupe}
                    onClick={() =>
                      void agir(async () => {
                        const f = await businessPlanApi.downloadPdf(projectId, v.version);
                        telecharger(f.blob, f.filename);
                      })
                    }
                  >
                    PDF v{v.version}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RattachementPlan(props: {
  vue: BusinessPlanView;
  occupe: boolean;
  onChange: (version: number | null) => void;
}): React.ReactElement {
  const { vue } = props;
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide">Plan financier rattaché</h3>
      <p className="text-sm">
        <strong>{vue.plan.label}</strong>
      </p>
      {vue.plan.fingerprint ? (
        <p className="text-xs text-[var(--foreground-muted)]" title={vue.plan.fingerprint}>
          Empreinte SHA-256 : <span className="fig">{empreinteCourte(vue.plan.fingerprint)}</span>
          {vue.plan.superseded ? ' — une version plus récente du plan existe.' : ''}
        </p>
      ) : (
        <p className="text-xs text-[var(--foreground-muted)]">
          Sans plan figé, les tableaux sont recalculés à chaque affichage et le document ne peut pas
          être validé.
        </p>
      )}
      {vue.plan.error ? (
        <Alert tone="warning">Tableaux indisponibles : {vue.plan.error}</Alert>
      ) : null}
      {vue.permissions.write ? (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span>Version du plan :</span>
          <select
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1"
            disabled={props.occupe}
            value={vue.planVersion ?? ''}
            onChange={(e) => props.onChange(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">Aucune (brouillon)</option>
            {vue.planChoices.map((p) => (
              <option key={p.version} value={p.version}>
                v{p.version} du {dateFr(p.approvedAt)}
                {p.status === 'superseded' ? ' (remplacée)' : ''}
              </option>
            ))}
          </select>
          {vue.planChoices.length === 0 ? (
            <span className="text-xs text-[var(--foreground-muted)]">
              Validez d’abord le plan financier dans l’onglet Résultats.
            </span>
          ) : null}
        </label>
      ) : null}
    </section>
  );
}

function Tableau({ t }: { t: AssembledTable }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <h5 className="text-sm font-medium">{t.title}</h5>
      <table className="w-full text-sm">
        <tbody>
          {t.rows.map((r) => (
            <tr key={r.lineId} className="border-b border-[var(--border)] last:border-0">
              <td className="py-1 pr-2">
                {r.label}
                {r.seuil ? (
                  <span className="block text-xs text-[var(--foreground-muted)]">
                    {r.seuil.display}
                  </span>
                ) : null}
              </td>
              <td className="fig py-1 text-right font-semibold whitespace-nowrap">{r.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionBloc(props: {
  section: SectionView;
  vue: BusinessPlanView;
  occupe: boolean;
  onSave: (text: string) => void;
  onDraft: (notes: string) => Promise<void>;
  onAccept: () => void;
  onDiscard: () => void;
}): React.ReactElement {
  const { section: s, vue } = props;
  const [texte, setTexte] = useState(s.text);
  const [notes, setNotes] = useState('');
  useEffect(() => setTexte(s.text), [s.text]);
  const origine = libelleOrigine(s);
  const modifie = texte !== s.text;

  return (
    <section
      aria-labelledby={`bp-${s.id}`}
      className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`bp-${s.id}`} className="text-base font-semibold">
          {s.title}
        </h3>
        {origine ? <span className="text-xs text-[var(--foreground-muted)]">{origine}</span> : null}
      </div>
      <ul className="list-disc pl-5 text-xs text-[var(--foreground-muted)]">
        {s.questions.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ul>

      {vue.permissions.write ? (
        <>
          <textarea
            aria-label={`Texte de la section ${s.title}`}
            className="min-h-32 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-sm"
            value={texte}
            maxLength={12000}
            onChange={(e) => setTexte(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={props.occupe || !modifie}
              onClick={() => props.onSave(texte)}
            >
              Enregistrer
            </Button>
          </div>
        </>
      ) : (
        <p className="whitespace-pre-line text-sm">
          {s.empty ? 'Section non renseignée.' : s.text}
        </p>
      )}

      {s.proposal ? (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-[var(--module-grow)] p-3">
          <div className="flex items-center gap-2">
            <DataNature nature="suggestion" />
            <span className="text-xs font-medium">Proposé par l’IA — à relire</span>
          </div>
          <p className="whitespace-pre-line text-sm">{s.proposal.text}</p>
          {vue.permissions.write ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={props.occupe} onClick={props.onAccept}>
                Accepter ce brouillon
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={props.occupe}
                onClick={props.onDiscard}
              >
                Écarter
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {vue.permissions.write && vue.ai.enabled ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-[var(--foreground-muted)]">
            Aide IA : proposer un brouillon de cette section
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <textarea
              aria-label={`Vos réponses aux questions de la section ${s.title}`}
              placeholder="Vos réponses aux questions guides (facultatif)"
              className="min-h-20 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-sm"
              value={notes}
              maxLength={2000}
              onChange={(e) => setNotes(e.target.value)}
            />
            <p className="text-xs text-[var(--foreground-muted)]">{vue.ai.mention}</p>
            <div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={props.occupe || vue.ai.quota?.exceeded === true}
                onClick={() => void props.onDraft(notes)}
              >
                Proposer un brouillon (IA)
              </Button>
            </div>
          </div>
        </details>
      ) : null}

      {s.hypotheses && s.hypotheses.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium">
              Hypothèses retenues (saisies, non des résultats)
            </h4>
            <DataNature nature="hypothese" />
          </div>
          <table className="w-full text-sm">
            <tbody>
              {s.hypotheses.map((h) => (
                <tr key={h.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-1 pr-2">{h.label}</td>
                  <td className="fig py-1 text-right whitespace-nowrap">{h.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {s.tables.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <DataNature nature="prevision" />
            <span className="text-xs text-[var(--foreground-muted)]">
              Tableaux calculés par le moteur, insérés sans modification — {vue.plan.label}.
            </span>
          </div>
          {s.tables.map((t) => (
            <Tableau key={t.sheetId} t={t} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
