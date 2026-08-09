'use client';

// ─────────────────────────────────────────────────────────────────────────────
// RETOUR DE FOURNISSEUR DE PAIEMENT (S22b)
//
// ── Le piège que cette page évite ────────────────────────────────────────────
//
// `?statut=succes` vient du FOURNISSEUR, dans l'URL, côté navigateur. C'est un
// paramètre que n'importe qui peut taper. Écrire « Paiement confirmé » parce
// qu'il vaut `succes` reviendrait à laisser l'affichage d'un abonnement se
// décider dans la barre d'adresse.
//
// Pire, même sans malveillance, l'information est FAUSSE la plupart du temps :
// un retour de Checkout précède souvent le rappel signé qui active réellement
// l'abonnement. Un client qui lit « confirmé » puis retrouve son compte en offre
// gratuite trente secondes plus tard écrit au support.
//
// Cette page fait donc l'inverse : elle traite `statut` comme une INDICATION de
// ce que le client vient de vivre, et interroge l'API pour savoir ce qui est
// réellement acquis. Tant que le rappel n'est pas arrivé, elle dit « en attente
// de confirmation » — ce qui est la vérité — et relit périodiquement.
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, type SubscriptionStateView } from '@/lib/api';

import {
  etatAffiche,
  formatDate,
  messageRefus,
  PLAN_LABELS,
} from '../../_components/subscription-model';

/**
 * Relectures après un retour « succès ».
 *
 * Six tentatives espacées de cinq secondes, soit trente secondes : au-delà, le
 * rappel a probablement échoué ou le fournisseur est en retard, et faire tourner
 * une page indéfiniment n'apporte rien. Le client est alors renvoyé vers son
 * abonnement, où l'état réel s'affichera dès qu'il sera connu.
 */
const RELECTURES_MAX = 6;
const INTERVALLE_MS = 5000;

export function PaymentReturn(): React.ReactElement {
  const params = useSearchParams();
  // Seules deux valeurs sont reconnues ; toute autre est traitée comme un retour
  // inconnu plutôt que comme un succès.
  const statutBrut = params.get('statut');
  const statut = statutBrut === 'succes' || statutBrut === 'annule' ? statutBrut : 'inconnu';

  const [state, setState] = useState<SubscriptionStateView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [tentatives, setTentatives] = useState(0);
  const [attenteTerminee, setAttenteTerminee] = useState(false);
  const monte = useRef(true);

  const relire = useCallback(async (): Promise<SubscriptionStateView | null> => {
    try {
      const vue = await api.getSubscription();
      if (monte.current) setState(vue);
      return vue;
    } catch (err) {
      if (monte.current) setErreur(messageRefus(err, 'État de l’abonnement indisponible.'));
      return null;
    }
  }, []);

  useEffect(() => {
    monte.current = true;
    return () => {
      monte.current = false;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      const vue = await relire();
      // Un retour annulé n'a rien à attendre : aucun rappel n'arrivera.
      if (statut !== 'succes') {
        setAttenteTerminee(true);
        return;
      }
      // Déjà payant : le rappel est arrivé avant le retour du navigateur.
      if (vue?.paidAccess) setAttenteTerminee(true);
    })();
  }, [relire, statut]);

  useEffect(() => {
    if (statut !== 'succes' || attenteTerminee) return;
    if (tentatives >= RELECTURES_MAX) {
      setAttenteTerminee(true);
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        const vue = await relire();
        if (!monte.current) return;
        if (vue?.paidAccess) setAttenteTerminee(true);
        else setTentatives((n) => n + 1);
      })();
    }, INTERVALLE_MS);
    return () => clearTimeout(timer);
  }, [statut, attenteTerminee, tentatives, relire]);

  const confirme = state?.paidAccess === true;

  return (
    <div className="flex flex-col gap-6">
      <section
        className={`rounded-lg border p-6 ${
          confirme
            ? 'border-[var(--accent)] bg-[var(--surface)]'
            : 'border-[var(--border)] bg-[var(--surface)]'
        }`}
      >
        <h2 className="font-display text-lg font-bold tracking-tight">{titre(statut, confirme)}</h2>
        <p className="mt-2 text-sm text-[var(--foreground-muted)]">
          {message(statut, confirme, attenteTerminee)}
        </p>

        {state ? (
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs tracking-wide text-[var(--foreground-muted)] uppercase">
                Statut
              </dt>
              <dd className="mt-0.5 font-medium">{etatAffiche(state).titre}</dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-[var(--foreground-muted)] uppercase">
                Offre appliquée
              </dt>
              <dd className="mt-0.5 font-medium">{PLAN_LABELS[state.plan]}</dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-[var(--foreground-muted)] uppercase">
                Prochaine échéance
              </dt>
              <dd className="fig mt-0.5 font-medium">{formatDate(state.currentPeriodEnd)}</dd>
            </div>
          </dl>
        ) : null}

        {erreur ? (
          <p role="alert" className="mt-4 text-sm text-[var(--danger)]">
            {erreur}
          </p>
        ) : null}
      </section>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/souscription"
          className="inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium transition hover:bg-[var(--surface-muted)]"
        >
          Revenir à l’abonnement
        </Link>
        <Link
          href="/projects"
          className="inline-flex items-center justify-center rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-foreground)] transition hover:opacity-90"
        >
          Aller à mes projets
        </Link>
      </div>
    </div>
  );
}

function titre(statut: string, confirme: boolean): string {
  if (statut === 'annule') return 'Paiement annulé';
  if (confirme) return 'Abonnement actif';
  if (statut === 'succes') return 'Paiement en cours de confirmation';
  return 'Retour de paiement';
}

function message(statut: string, confirme: boolean, attenteTerminee: boolean): string {
  if (statut === 'annule') {
    return 'Aucun montant n’a été prélevé et votre offre actuelle est inchangée. Vous pouvez reprendre la souscription quand vous le souhaitez.';
  }
  if (confirme) {
    return 'Le paiement a été confirmé par votre fournisseur et votre offre est active.';
  }
  if (statut === 'succes' && !attenteTerminee) {
    // La confirmation vient d'un rappel SIGNÉ côté serveur, jamais de cette
    // page : le dire évite un « c'est payé mais rien n'a changé ».
    return 'Votre fournisseur a accepté le paiement. L’activation est confirmée par une notification signée de sa part, qui arrive en général en quelques secondes. Cette page se met à jour toute seule.';
  }
  if (statut === 'succes') {
    return 'La confirmation n’est pas encore parvenue. Ce n’est pas nécessairement un échec : certains fournisseurs prennent plusieurs minutes. Votre abonnement s’activera dès réception, sans action de votre part.';
  }
  return 'Nous n’avons pas reçu d’indication claire de votre fournisseur. Consultez l’état ci-dessous : il reflète ce qui est réellement enregistré.';
}
