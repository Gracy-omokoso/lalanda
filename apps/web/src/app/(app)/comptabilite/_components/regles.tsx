'use client';

// Règles de correspondance (ADR-0049 § 2.4) et premier exercice (§ 2.7) : les gestes que
// l'API offrait sans écran. Créer le brouillon depuis le plan comptable, le reprendre après
// un changement de plan, modifier le débit et le crédit d'une règle, valider la version
// avec la déclaration de relecture ; ouvrir un premier exercice.
//
// Aucun numéro de compte n'est écrit ici : les comptes viennent du pack et des règles.
// Le serveur reste juge de tout (droits, séparation des tâches, plan, révisions).

import { ACCOUNTING_TO_CONFIRM_LABEL } from '@lalanda/shared/accounting';
import { Badge, Button, Modal } from '@lalanda/ui';
import { useState } from 'react';

import {
  accountingApi,
  type AccountingChartPackDetail,
  type AccountingRuleInput,
  type AccountingRuleSetView,
  type AccountingSettingsView,
} from '@/lib/api-accounting';

import { CHAMP } from '../../ventes/_components/form-ui';

import { reglesAConfirmer } from './activation-model';
import { useAccesCompta } from './comptabilite-access';
import { codeDe, messageCompta, type Lecture } from './comptabilite-model';
import { AConfirmer } from './comptabilite-ui';
import { LIBELLES_STATUT_REGLES } from './libelles';
import {
  actionOuvrirExercice,
  actionsRegles,
  brouillonDe,
  corpsValidation,
  jourDe,
  motifsDuPack,
  phraseAttente,
  reglesProposees,
  remplacerRegle,
  repriseDuBrouillon,
} from './regles-model';
import { useLecture } from './use-lecture';

/** Détail du pack choisi (motifs, compte d'attente, règles proposées) ; `null` sans pack. */
export function usePackChoisi(
  reglages: AccountingSettingsView | null,
): Lecture<AccountingChartPackDetail> | null {
  const ref = reglages?.chartPack ?? null;
  return useLecture(
    () =>
      ref === null
        ? Promise.reject(new Error('Aucun plan comptable choisi.'))
        : accountingApi.getChartPack(ref.slug, ref.version),
    ref === null ? null : `${ref.slug}@${ref.version}`,
  );
}

function Erreur({ texte }: { texte: string | null }): React.ReactElement | null {
  if (texte === null) return null;
  return (
    <p role="alert" className="text-sm font-medium text-[var(--danger)]">
      {texte}
    </p>
  );
}

// ── Gestes sur les règles ───────────────────────────────────────────────────

/**
 * Créer, reprendre et valider : affiché dans l'étape « Règles » de l'assistant et en tête
 * du bloc des règles des réglages.
 */
export function GestesRegles({
  jeux,
  pack,
  lienVersRegles = false,
}: {
  jeux: readonly AccountingRuleSetView[] | null;
  pack: Lecture<AccountingChartPackDetail> | null;
  /** Dans l'assistant : lien vers le tableau complet des règles. */
  lienVersRegles?: boolean;
}): React.ReactElement | null {
  const { actions, reglages, recharger } = useAccesCompta();
  const r = reglages?.ok ? reglages.valeur : null;
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [validation, setValidation] = useState<AccountingRuleSetView | null>(null);

  if (jeux === null || r === null) return null;
  const droits = actionsRegles(r, jeux, actions);
  const brouillon = brouillonDe(jeux);
  const detail = pack?.ok ? pack.valeur : null;
  const proposees = detail ? reglesProposees(detail) : null;
  const reprise = repriseDuBrouillon(brouillon, r, proposees?.length ?? null);

  async function agir(fn: () => Promise<unknown>, repli: string): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      await fn();
      recharger();
    } catch (err) {
      setErreur(messageCompta(err, repli));
      // Un brouillon existait déjà (autre onglet, autre personne) : on l'affiche.
      if (codeDe(err) === 'RULE_SET_DRAFT_EXISTS') recharger();
    } finally {
      setEnvoi(false);
    }
  }

  const aRevoir = brouillon ? reglesAConfirmer(brouillon) : 0;

  return (
    <div className="flex flex-col gap-2 text-sm">
      {droits.raison ? <p className="text-[var(--foreground-muted)]">{droits.raison}</p> : null}
      {brouillon && aRevoir > 0 ? (
        <p>
          <AConfirmer texte={`${aRevoir} règle${aRevoir > 1 ? 's' : ''} à revoir`} /> Une règle « à
          revoir » n’est jamais appliquée : ses opérations vont {phraseAttente(detail)}, avec leur
          motif, jusqu’à ce que vous la corrigiez. Elles restent visibles dans le tableau.
        </p>
      ) : null}
      {reprise ? <p className="font-medium">{reprise}</p> : null}
      <div className="flex flex-wrap gap-2">
        {droits.creer ? (
          <Button
            size="sm"
            variant={jeux.some((j) => j.status === 'validated') ? 'secondary' : 'primary'}
            disabled={envoi}
            onClick={() =>
              void agir(() => accountingApi.createRuleSet(), 'La création des règles a échoué.')
            }
          >
            {droits.libelleCreer}
          </Button>
        ) : null}
        {droits.modifier && brouillon && reprise && proposees ? (
          <Button
            size="sm"
            variant="primary"
            disabled={envoi}
            onClick={() =>
              void agir(
                () =>
                  accountingApi.updateRuleSet(brouillon.version, {
                    expectedRevision: brouillon.revision,
                    rules: proposees,
                  }),
                'La reprise des règles a échoué.',
              )
            }
          >
            Reprendre les règles proposées du plan choisi
          </Button>
        ) : null}
        {droits.modifier && brouillon ? (
          <Button
            size="sm"
            variant={reprise ? 'secondary' : 'primary'}
            disabled={envoi || brouillon.rules.length === 0}
            onClick={() => setValidation(brouillon)}
          >
            Valider la version {brouillon.version}
          </Button>
        ) : null}
        {lienVersRegles ? (
          <a
            href="/comptabilite/reglages#compta-regles"
            className="self-center underline underline-offset-2"
          >
            {brouillon && droits.modifier ? 'Voir et modifier les règles' : 'Voir les règles'}
          </a>
        ) : null}
      </div>
      <Erreur texte={erreur} />
      {validation ? (
        <FenetreValidation
          jeu={validation}
          onClose={() => setValidation(null)}
          onValide={() => {
            setValidation(null);
            recharger();
          }}
        />
      ) : null}
    </div>
  );
}

function FenetreValidation({
  jeu,
  onClose,
  onValide,
}: {
  jeu: AccountingRuleSetView;
  onClose: () => void;
  onValide: () => void;
}): React.ReactElement {
  const aujourdhui = jourDe(new Date());
  const [coche, setCoche] = useState(false);
  const [nom, setNom] = useState('');
  const [date, setDate] = useState(aujourdhui);
  const [note, setNote] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const aRevoir = reglesAConfirmer(jeu);

  async function valider(): Promise<void> {
    const corps = corpsValidation(jeu.revision, { coche, nom, date, note }, aujourdhui);
    if (!corps.ok) {
      setErreur(corps.erreur);
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await accountingApi.validateRuleSet(jeu.version, corps.corps);
      onValide();
    } catch (err) {
      setErreur(messageCompta(err, 'La validation a échoué.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Valider la version ${jeu.version} des règles`}
      busy={envoi}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={envoi}>
            Annuler
          </Button>
          <Button variant="primary" onClick={() => void valider()} disabled={envoi}>
            Valider cette version
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p>
          Une fois validée, cette version ne se modifie plus : une nouvelle version la remplacera.
          {aRevoir > 0
            ? ` ${aRevoir} règle${aRevoir > 1 ? 's restent' : ' reste'} « à revoir » : elles ne seront pas appliquées et leurs opérations iront au compte d’attente.`
            : ''}
        </p>
        <label className="flex items-start gap-2 font-medium">
          <input
            type="checkbox"
            className="mt-1"
            checked={coche}
            onChange={(e) => setCoche(e.target.checked)}
          />
          Ces règles ont été relues par notre expert-comptable.
        </label>
        <div className="flex flex-col gap-1">
          <label htmlFor="relecture-nom" className="font-medium">
            Nom de l’expert-comptable ou du cabinet
          </label>
          <input
            id="relecture-nom"
            className={CHAMP}
            maxLength={120}
            value={nom}
            onChange={(e) => setNom(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="relecture-date" className="font-medium">
            Date de la relecture
          </label>
          <input
            id="relecture-date"
            type="date"
            className={`${CHAMP} sm:w-56`}
            max={aujourdhui}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="relecture-note" className="font-medium">
            Note (facultative)
          </label>
          <textarea
            id="relecture-note"
            className={CHAMP}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <p className="text-[var(--foreground-muted)]">
          Lalanda enregistre cette déclaration de relecture sans la vérifier. La personne qui a
          modifié les règles en dernier ne les valide pas, sauf si elle est seule habilitée.
        </p>
        <Erreur texte={erreur} />
      </div>
    </Modal>
  );
}

// ── Tableau des versions ────────────────────────────────────────────────────

export function TableauRegles({
  jeux,
  pack,
}: {
  jeux: Lecture<AccountingRuleSetView[]> | null;
  pack: Lecture<AccountingChartPackDetail> | null;
}): React.ReactElement | null {
  const { actions, reglages, recharger } = useAccesCompta();
  const [edition, setEdition] = useState<{
    jeu: AccountingRuleSetView;
    regle: AccountingRuleInput;
  } | null>(null);
  if (jeux === null || !jeux.ok || jeux.valeur.length === 0) return null;
  const r = reglages?.ok ? reglages.valeur : null;
  const modifiable = actionsRegles(r, jeux.valeur, actions).modifier;
  const detail = pack?.ok ? pack.valeur : null;
  const motifs = motifsDuPack(detail);

  return (
    <>
      <ul className="flex flex-col gap-4">
        {jeux.valeur.map((jeu) => {
          const n = reglesAConfirmer(jeu);
          const relu = jeu.validation?.expertReview;
          const brouillon = jeu.status === 'draft';
          // Les motifs viennent du pack dont le jeu est né, s'il est le pack choisi.
          const memePack =
            detail !== null &&
            jeu.basedOn?.packSlug === detail.slug &&
            jeu.basedOn.packVersion === detail.version;
          return (
            <li
              key={jeu.version}
              className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Version {jeu.version}</span>
                <Badge tone={jeu.status === 'validated' ? 'success' : 'neutral'}>
                  {LIBELLES_STATUT_REGLES[jeu.status]}
                </Badge>
                {n > 0 ? <AConfirmer texte={`${n} règle${n > 1 ? 's' : ''} à revoir`} /> : null}
                {jeu.basedOn ? (
                  <span className="text-xs text-[var(--foreground-muted)]">
                    Plan {jeu.basedOn.packSlug}, version {jeu.basedOn.packVersion}
                  </span>
                ) : null}
              </div>
              {relu?.declared ? (
                <p className="text-sm text-[var(--foreground-muted)]">
                  Déclaration de relecture : {relu.name ?? 'nom non précisé'}
                  {relu.date ? `, le ${relu.date}` : ''}. Lalanda enregistre cette déclaration de
                  relecture sans la vérifier.
                </p>
              ) : jeu.status === 'validated' ? (
                <p className="text-sm">Aucune déclaration de relecture.</p>
              ) : null}
              {jeu.rules.length === 0 ? (
                <p className="text-sm text-[var(--foreground-muted)]">
                  Aucune règle dans cette version.
                </p>
              ) : (
                <details open={brouillon} className="text-sm">
                  <summary className="cursor-pointer font-medium">
                    {jeu.rules.length} règle{jeu.rules.length > 1 ? 's' : ''}
                  </summary>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[36rem] text-sm">
                      <thead className="text-left text-xs text-[var(--foreground-muted)]">
                        <tr>
                          <th className="py-1.5 pr-3 font-medium">Opération</th>
                          <th className="py-1.5 pr-3 font-medium">Débit</th>
                          <th className="py-1.5 pr-3 font-medium">Crédit</th>
                          <th className="py-1.5 pr-3 font-medium">Statut</th>
                          {brouillon && modifiable ? (
                            <th className="py-1.5 font-medium">
                              <span className="sr-only">Modifier</span>
                            </th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {jeu.rules.map((regle) => (
                          <tr key={regle.key}>
                            <td className="py-1.5 pr-3">
                              <span className="font-mono">{regle.key}</span>
                            </td>
                            <td className="py-1.5 pr-3 font-mono">
                              {regle.debit.join(', ') || '—'}
                            </td>
                            <td className="py-1.5 pr-3 font-mono">
                              {regle.credit.join(', ') || '—'}
                            </td>
                            <td className="py-1.5 pr-3">
                              {regle.requiresReview ? (
                                <span className="flex flex-col gap-1">
                                  <AConfirmer texte={ACCOUNTING_TO_CONFIRM_LABEL} />
                                  <span className="text-xs text-[var(--foreground-muted)]">
                                    {memePack && motifs.get(regle.key)
                                      ? motifs.get(regle.key)
                                      : `Non appliquée : va ${phraseAttente(memePack ? detail : null)}.`}
                                  </span>
                                </span>
                              ) : null}
                            </td>
                            {brouillon && modifiable ? (
                              <td className="py-1.5">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setEdition({ jeu, regle })}
                                >
                                  Modifier
                                </Button>
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      {edition ? (
        <FenetreRegle
          jeu={edition.jeu}
          regle={edition.regle}
          onClose={() => setEdition(null)}
          onSaved={() => {
            setEdition(null);
            recharger();
          }}
        />
      ) : null}
    </>
  );
}

function FenetreRegle({
  jeu,
  regle,
  onClose,
  onSaved,
}: {
  jeu: AccountingRuleSetView;
  regle: AccountingRuleInput;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const [debit, setDebit] = useState(regle.debit.join(', '));
  const [credit, setCredit] = useState(regle.credit.join(', '));
  const [aRevoir, setARevoir] = useState(regle.requiresReview);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function enregistrer(): Promise<void> {
    const retour = remplacerRegle(jeu.rules, regle.key, { debit, credit, aRevoir });
    if (!retour.ok) {
      setErreur(retour.erreur);
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await accountingApi.updateRuleSet(jeu.version, {
        expectedRevision: jeu.revision,
        rules: retour.regles,
      });
      onSaved();
    } catch (err) {
      setErreur(messageCompta(err, 'L’enregistrement de la règle a échoué.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Modifier une règle du brouillon"
      busy={envoi}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={envoi}>
            Annuler
          </Button>
          <Button variant="primary" onClick={() => void enregistrer()} disabled={envoi}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p>
          Opération <span className="font-mono">{regle.key}</span>. Saisissez des numéros du plan de
          l’organisation, ou un jeton comme {'{customer}'}, séparés par des virgules.
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor="regle-debit" className="font-medium">
            Débit
          </label>
          <input
            id="regle-debit"
            className={`${CHAMP} font-mono`}
            value={debit}
            onChange={(e) => setDebit(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="regle-credit" className="font-medium">
            Crédit
          </label>
          <input
            id="regle-credit"
            className={`${CHAMP} font-mono`}
            value={credit}
            onChange={(e) => setCredit(e.target.value)}
          />
        </div>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={aRevoir}
            onChange={(e) => setARevoir(e.target.checked)}
          />
          À revoir : la règle n’est pas appliquée, ses opérations vont au compte d’attente.
        </label>
        <Erreur texte={erreur} />
      </div>
    </Modal>
  );
}

// ── Premier exercice ────────────────────────────────────────────────────────

/** Bouton « Ouvrir l'exercice N », ou la raison qui le grise. */
export function OuvrirExercice({
  annee,
  onOuvert,
}: {
  annee: number;
  onOuvert: () => void;
}): React.ReactElement {
  const { actions } = useAccesCompta();
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const droit = actionOuvrirExercice(actions);

  async function ouvrir(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      await accountingApi.createFiscalYear(annee);
      onOuvert();
    } catch (err) {
      setErreur(messageCompta(err, 'L’ouverture de l’exercice a échoué.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 text-sm">
      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!droit.offert || envoi}
          aria-describedby={droit.raison ? `raison-exercice-${annee}` : undefined}
          onClick={() => void ouvrir()}
        >
          Ouvrir l’exercice {annee}
        </Button>
      </div>
      {droit.raison ? (
        <p id={`raison-exercice-${annee}`} className="text-[var(--foreground-muted)]">
          {droit.raison}
        </p>
      ) : null}
      <Erreur texte={erreur} />
    </div>
  );
}
