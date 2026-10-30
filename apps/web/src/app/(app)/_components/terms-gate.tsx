'use client';

// Nouvelle acceptation des conditions après connexion (ADR-0043, docs/28 § 2.3 bis).
//
// Monté dans la coquille applicative : toute page de l'application le porte.
// La décision (afficher ou non, bloquer ou non) vient de `terms-gate-model.ts` ;
// ce composant ne fait que lire l'API et rendre.
//
// - Fenêtre BLOQUANTE (`Modal` non fermable) : la seule sortie sans accepter est
//   « Se déconnecter ».
// - Les pages légales restent joignables : liens ouverts dans un nouvel onglet,
//   et ces pages vivent hors de l'application (route group `(marketing)`).
// - La case n'est jamais pré-cochée ; la version envoyée est celle affichée.

import { Button, Modal } from '@lalanda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useState } from 'react';

import { api } from '@/lib/api';
import { LEGAL_VERSION, PUBLISHER_NAME } from '@/lib/legal';

import { oublierProfil } from './profile-context';
import {
  acceptErrorMessage,
  canAccept,
  phaseFromAcceptance,
  phaseFromCheckError,
  type TermsGatePhase,
} from './terms-gate-model';

const LIENS = [
  { href: '/cgu', label: 'Conditions générales d’utilisation' },
  { href: '/cgv', label: 'Conditions générales de vente' },
  { href: '/confidentialite', label: 'Politique de confidentialité' },
] as const;

export function TermsGate(): React.ReactElement | null {
  const router = useRouter();
  const caseId = useId();
  const [phase, setPhase] = useState<TermsGatePhase>({ kind: 'checking' });
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const verifier = useCallback(async (): Promise<void> => {
    try {
      const view = await api.getTermsAcceptance();
      setPhase(phaseFromAcceptance(view, LEGAL_VERSION));
    } catch (err) {
      setPhase(phaseFromCheckError(err));
    }
  }, []);

  useEffect(() => {
    void verifier();
  }, [verifier]);

  async function accepter(): Promise<void> {
    if (!canAccept({ checked, busy })) return;
    setBusy(true);
    setError(null);
    try {
      const view = await api.acceptTerms(LEGAL_VERSION);
      setPhase(phaseFromAcceptance(view, LEGAL_VERSION));
    } catch (err) {
      setError(acceptErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function seDeconnecter(): Promise<void> {
    setSigningOut(true);
    try {
      const { signOut } = await import('@/lib/auth-client');
      await signOut();
      oublierProfil();
      router.push('/login');
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  if (phase.kind === 'checking' || phase.kind === 'current') return null;

  if (phase.kind === 'check-failed') {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm"
      >
        <p className="min-w-0 flex-1">
          Nous n&apos;avons pas pu vérifier votre accord aux conditions d&apos;utilisation.
        </p>
        <Button size="sm" onClick={() => void verifier()}>
          Réessayer
        </Button>
      </div>
    );
  }

  const deconnexion = (
    <Button variant="ghost" busy={signingOut} onClick={() => void seDeconnecter()}>
      Se déconnecter
    </Button>
  );

  if (phase.kind === 'reload') {
    return (
      <Modal
        open
        dismissible={false}
        onClose={() => undefined}
        title="Une nouvelle version des conditions est publiée"
        size="sm"
        footer={
          <>
            {deconnexion}
            <Button variant="primary" onClick={() => window.location.reload()}>
              Recharger la page
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6">
          Rechargez la page pour lire la version en vigueur avant de l&apos;accepter.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open
      dismissible={false}
      onClose={() => undefined}
      busy={busy}
      title="Nos conditions ont changé"
      description={`Version ${LEGAL_VERSION}`}
      size="md"
      footer={
        <>
          {deconnexion}
          <Button
            variant="primary"
            busy={busy}
            disabled={!canAccept({ checked, busy })}
            onClick={() => void accepter()}
          >
            Accepter et continuer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm leading-6">
        <p>
          Lalanda est désormais édité par <strong>{PUBLISHER_NAME}</strong>. Pour continuer à
          utiliser le service, merci de lire et d&apos;accepter la nouvelle version de nos
          conditions.
        </p>
        <ul className="flex flex-col gap-2">
          {LIENS.map((lien) => (
            <li key={lien.href}>
              <Link
                href={lien.href}
                target="_blank"
                rel="noopener"
                className="font-medium underline underline-offset-4"
              >
                {lien.label}
                <span className="sr-only"> (nouvel onglet)</span>
              </Link>
            </li>
          ))}
        </ul>
        <label htmlFor={caseId} className="flex items-start gap-3 py-1">
          <input
            id={caseId}
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
          />
          <span>
            J&apos;ai lu et j&apos;accepte les conditions générales d&apos;utilisation, les
            conditions générales de vente et la politique de confidentialité.
          </span>
        </label>
        {error ? (
          <p
            role="alert"
            className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[var(--danger-bg)] px-3 py-2 text-[var(--danger)]"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
