'use client';

// Liste des idées de l'organisation (ADR-0036 § 1) : création rapide, état de la
// validation (score du moteur ou « indisponible »), expériences, passage au plan.

import { Button, DataNature, Modal } from '@lalanda/ui';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { ideaLabApi, type IdeaListResponse } from '@/lib/idea-lab-api';

import { Bloc, Chargement, EtatVide, Erreur, Pastille } from '../../croissance/_components/grow-ui';
import { useAccesIdees } from './idees-chrome';
import { ficheVide, corpsFiche, libelleScore, messageErreur, tonNiveau } from './idea-model';

export function IdeasPanel(): React.ReactElement {
  const acces = useAccesIdees();
  const router = useRouter();
  const [vue, setVue] = useState<IdeaListResponse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [titre, setTitre] = useState('');
  const [probleme, setProbleme] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [archivees, setArchivees] = useState(false);
  const [creation, setCreation] = useState(false);
  const [erreurCreation, setErreurCreation] = useState<string | null>(null);

  const charger = useCallback(async (): Promise<void> => {
    setErreur(null);
    try {
      setVue(await ideaLabApi.list());
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de charger vos idées.'));
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function creer(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const r = corpsFiche({ ...ficheVide(), title: titre, problem: probleme });
    if (!r.ok) {
      setErreurCreation(r.erreur);
      return;
    }
    setEnCours(true);
    setErreurCreation(null);
    try {
      const idea = await ideaLabApi.create(r.body);
      router.push(`/idees/${idea.id}`);
    } catch (err) {
      setErreurCreation(messageErreur(err, 'Création impossible.'));
      setEnCours(false);
    }
  }

  async function basculerIa(aiEnabled: boolean): Promise<void> {
    setMessage(null);
    try {
      await ideaLabApi.putSettings(aiEnabled);
      await charger();
    } catch (err) {
      setMessage(messageErreur(err, 'Réglage impossible.'));
    }
  }

  if (erreur) return <Erreur message={erreur} onRetry={() => void charger()} />;
  if (!vue) return <Chargement />;

  const actives = vue.ideas.filter((i) => !i.archived);
  const rangees = vue.ideas.filter((i) => i.archived);
  const peutEcrire = acces.modifier && vue.canEdit;

  return (
    <div className="flex flex-col gap-8">
      {peutEcrire && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-xs text-[var(--foreground-muted)]">
            {actives.length + rangees.length} / {vue.limits.ideas} idées
          </span>
          <Button
            variant="primary"
            onClick={() => {
              setErreurCreation(null);
              setCreation(true);
            }}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Nouvelle idée
          </Button>
        </div>
      )}
      <Modal
        open={peutEcrire && creation}
        onClose={() => setCreation(false)}
        title="Nouvelle idée"
        description="Commencez par le problème d’un client, pas par la solution."
        size="md"
        busy={enCours}
      >
        <form
          onSubmit={(e) => void creer(e)}
          aria-label="Nouvelle idée"
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Nom de l’idée</span>
            <input
              value={titre}
              onChange={(e) => setTitre(e.target.value)}
              maxLength={120}
              required
              className="rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Le problème que vous voulez résoudre</span>
            <textarea
              value={probleme}
              onChange={(e) => setProbleme(e.target.value)}
              maxLength={1000}
              rows={2}
              className="rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" busy={enCours}>
              Créer l’idée
            </Button>
            <span className="text-xs text-[var(--foreground-muted)]">
              {actives.length + rangees.length} / {vue.limits.ideas} idées
            </span>
          </div>
          {erreurCreation && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {erreurCreation}
            </p>
          )}
        </form>
      </Modal>

      {message && (
        <p role="status" className="text-sm text-[var(--danger)]">
          {message}
        </p>
      )}

      <Bloc titre="Vos idées">
        {actives.length === 0 ? (
          <EtatVide titre="Aucune idée pour l’instant">
            <p>
              Commencez par le problème d’un client, pas par la solution. Vous noterez ensuite
              l’idée sur la grille de validation, avec vos preuves.
            </p>
          </EtatVide>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {actives.map((i) => (
              <li key={i.id} className="doc-card flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/idees/${i.id}`}
                    className="font-display text-base font-semibold hover:text-[var(--accent)]"
                  >
                    {i.title}
                  </Link>
                  <DataNature nature="hypothese" />
                </div>
                {i.problem && (
                  <p className="line-clamp-2 text-sm text-[var(--foreground-muted)]">{i.problem}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Pastille
                    ton={i.validation.disponible ? tonNiveau(i.validation.niveau) : 'neutre'}
                  >
                    Validation : {libelleScore(i.validation)}
                  </Pastille>
                  <span className="text-[var(--foreground-muted)]">
                    {i.poidsRenseigne} % du poids noté · {i.completedExperiments} / {i.experiments}{' '}
                    expérience(s) conclue(s)
                    {i.promotions > 0 ? ' · passée au plan' : ''}
                  </span>
                </div>
                <div className="flex gap-3 text-sm">
                  <Link href={`/idees/${i.id}`} className="underline hover:text-[var(--accent)]">
                    Fiche
                  </Link>
                  <Link
                    href={`/idees/${i.id}/validation`}
                    className="underline hover:text-[var(--accent)]"
                  >
                    Valider
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Bloc>

      {rangees.length > 0 && (
        <Bloc
          titre="Idées archivées"
          aside={
            <button
              type="button"
              className="text-sm underline"
              onClick={() => setArchivees((v) => !v)}
              aria-expanded={archivees}
            >
              {archivees ? 'Masquer' : `Afficher (${rangees.length})`}
            </button>
          }
        >
          {archivees && (
            <ul className="flex flex-col gap-1 text-sm">
              {rangees.map((i) => (
                <li key={i.id}>
                  <Link href={`/idees/${i.id}`} className="underline">
                    {i.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Bloc>
      )}

      <Bloc titre="Assistance IA">
        <div className="doc-card flex flex-col gap-2 p-4 text-sm">
          <p>
            {vue.ai.enabled
              ? 'Activée : sur demande, dans la fiche d’une idée, l’IA reformule, propose des questions d’entretien et des hypothèses à tester. Elle ne propose jamais de chiffre.'
              : vue.ai.disabledBy === 'platform'
                ? 'Désactivée par la plateforme.'
                : 'Désactivée pour votre organisation : les propositions sont faites sans IA.'}
          </p>
          {vue.ai.quota && !vue.ai.quota.unlimited && vue.ai.quota.limit !== null && (
            <p className="text-xs text-[var(--foreground-muted)]">
              Messages IA ce mois-ci : {vue.ai.quota.used} / {vue.ai.quota.limit} (quota commun de
              votre offre).
            </p>
          )}
          {acces.reglerIa && vue.canManageAi && vue.ai.disabledBy !== 'platform' && (
            <div>
              <Button size="sm" onClick={() => void basculerIa(!vue.ai.enabled)}>
                {vue.ai.enabled ? 'Désactiver l’IA de l’Idea Lab' : 'Activer l’IA de l’Idea Lab'}
              </Button>
            </div>
          )}
        </div>
      </Bloc>
    </div>
  );
}
