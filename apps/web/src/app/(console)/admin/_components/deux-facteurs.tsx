'use client';

// Double authentification de la console (ADR-0053 — P8, décision n° 2 retenue).
//
// Deux écrans montés par la coquille AVANT toute page de console :
//   - `EnrolementDeuxFacteurs` : opérateur non enrôlé. QR code (ou clé à saisir), code à
//     six chiffres + mot de passe, puis les dix codes de secours, montrés UNE fois ;
//   - `VerificationDeuxFacteurs` : opérateur enrôlé, session pas encore vérifiée. Mot de
//     passe + code (ou un code de secours) — c'est `POST /admin/reauth`.
//
// Ils ne protègent rien : l'API refuse toute route de console tant que ce n'est pas fait.
//
// ADR-0074 § 10 : le mot de passe et le code se saisissent sur deux écrans successifs
// (`ConfirmationDeuxTemps`), mais partent toujours ensemble, dans la même requête.

import { Checkbox } from '@lalanda/ui';
import { useState } from 'react';

import { api, type PlatformTwoFactorEnrollmentStart } from '@/lib/api';
import { useSession } from '@/lib/auth-client';

import { formatBackupCode } from '@lalanda/shared/platform';

import { Bandeau } from './admin-chrome';
import { ConfirmationDeuxTemps } from './confirmation-deux-temps';
import { messageDeuxFacteurs, texteCodesDeSecours } from './deux-facteurs-model';

const ETIQUETTE =
  'font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]';
const BOUTON =
  'rounded-md border border-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/10 disabled:opacity-40';

function Cadre({
  titre,
  children,
}: {
  titre: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
      <h1 className="font-display text-xl font-bold tracking-tight">{titre}</h1>
      {children}
    </section>
  );
}

export function EnrolementDeuxFacteurs({
  onTermine,
}: {
  onTermine: () => void;
}): React.ReactElement {
  const { data: session } = useSession();
  const [debut, setDebut] = useState<PlatformTwoFactorEnrollmentStart | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [conserve, setConserve] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function commencer(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      setDebut(await api.startPlatformTwoFactorEnrollment());
    } catch (err) {
      setErreur(messageDeuxFacteurs(err, 'Impossible de préparer l’enrôlement.'));
    } finally {
      setEnvoi(false);
    }
  }

  // Même corps qu'avant : mot de passe (s'il y en a un) et code, en un seul envoi.
  // Les erreurs remontent à `ConfirmationDeuxTemps`, qui les affiche.
  async function confirmer(motDePasse: string, facteur: { code?: string }): Promise<void> {
    const res = await api.confirmPlatformTwoFactorEnrollment({
      ...(motDePasse !== '' ? { password: motDePasse } : {}),
      code: facteur.code ?? '',
    });
    setCodes(res.backupCodes);
  }

  function telecharger(liste: string[]): void {
    const blob = new Blob([texteCodesDeSecours(liste, session?.user?.email ?? null)], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lalanda-codes-de-secours.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (codes) {
    return (
      <Cadre titre="Vos dix codes de secours">
        <p className="text-sm text-[var(--foreground-muted)]">
          La double authentification est active. Si vous perdez votre téléphone, chacun de ces codes
          remplace une fois le code de l’application. Ils ne seront{' '}
          <strong>plus jamais affichés</strong> : enregistrez-les maintenant, hors de votre
          téléphone.
        </p>
        <ul className="grid grid-cols-1 gap-2 font-mono text-sm sm:grid-cols-2">
          {codes.map((c) => (
            <li
              key={c}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 tracking-wider"
            >
              {formatBackupCode(c)}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BOUTON} onClick={() => telecharger(codes)}>
            Enregistrer dans un fichier
          </button>
          <button
            type="button"
            className={BOUTON}
            onClick={() =>
              void navigator.clipboard?.writeText(
                texteCodesDeSecours(codes, session?.user?.email ?? null),
              )
            }
          >
            Copier
          </button>
        </div>
        <Checkbox
          checked={conserve}
          onChange={setConserve}
          label="J’ai mis ces codes en lieu sûr."
        />
        <div>
          <button type="button" className={BOUTON} disabled={!conserve} onClick={onTermine}>
            Ouvrir la console
          </button>
        </div>
      </Cadre>
    );
  }

  return (
    <Cadre titre="Activez la double authentification">
      <p className="text-sm text-[var(--foreground-muted)]">
        La console Lalanda exige, en plus de votre mot de passe, un code à six chiffres produit par
        une application d’authentification (Google Authenticator, Microsoft Authenticator,
        1Password, Authy…). Cela ne concerne que la console : votre espace organisation ne change
        pas.
      </p>
      {!debut ? (
        <div>
          <button
            type="button"
            className={BOUTON}
            disabled={envoi}
            onClick={() => void commencer()}
          >
            {envoi ? 'Préparation…' : 'Commencer'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
            <li>
              Dans l’application, ajoutez un compte en scannant ce QR code.
              <div className="mt-2 flex flex-wrap items-start gap-4">
                {/* Image `data:` produite par l'API : aucune ressource externe. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={debut.qrCodeDataUrl}
                  alt="QR code d’enrôlement de la double authentification"
                  width={220}
                  height={220}
                  className="rounded-md bg-white p-1"
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <span className={ETIQUETTE}>Ou saisissez cette clé</span>
                  <code className="break-all rounded-md bg-[var(--surface-2)] px-2 py-1 text-sm tracking-wider">
                    {debut.manualKey}
                  </code>
                </div>
              </div>
            </li>
            <li>
              Confirmez avec votre mot de passe, puis le code à six chiffres affiché par
              l’application.
            </li>
          </ol>
          {/* ADR-0074 § 10 : mot de passe, puis code — envoyés ensemble, comme avant. */}
          <ConfirmationDeuxTemps
            libelleAction="Activer"
            motDePasseFacultatif
            codeDeSecoursPermis={false}
            aideMotDePasse="Compte créé avec Google, sans mot de passe : laissez le champ vide ; une connexion Google de moins de dix minutes est alors exigée."
            messageErreur={(err) => messageDeuxFacteurs(err, 'Code refusé.')}
            onConfirmer={confirmer}
          />
        </div>
      )}
      {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}
    </Cadre>
  );
}

export function VerificationDeuxFacteurs({
  onTermine,
}: {
  onTermine: () => void;
}): React.ReactElement {
  return (
    <Cadre titre="Confirmez votre identité">
      <p className="text-sm text-[var(--foreground-muted)]">
        Pour ouvrir la console sur cette session : votre mot de passe, puis le code de votre
        application d’authentification. Téléphone perdu : utilisez un de vos codes de secours, à la
        place du code.
      </p>
      {/* ADR-0074 § 10 : deux écrans, un seul envoi (POST /admin/reauth, inchangé). */}
      <ConfirmationDeuxTemps
        libelleAction="Ouvrir la console"
        messageErreur={(err) => messageDeuxFacteurs(err, 'Vérification refusée.')}
        onConfirmer={async (motDePasse, facteur) => {
          await api.confirmReauth(motDePasse, facteur);
          onTermine();
        }}
      />
      <p className="text-xs text-[var(--foreground-muted)]">
        Ni téléphone ni code de secours : demandez à un autre super-administrateur de réinitialiser
        votre double authentification.
      </p>
    </Cadre>
  );
}
