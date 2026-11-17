'use client';

// E-mails de l'espace externe — ADR-0079 § 9. Atteint par le lien de désinscription d'un
// e-mail (`?jeton=…`, sans connexion) ou depuis l'espace externe (session). Trois choix :
// tout, les livrables à valider seulement, rien. Le jeton ne règle que cela.

import {
  EXTERNAL_NOTIFICATION_PREFERENCES,
  EXTERNAL_NOTIFICATION_PREFERENCE_LABELS,
  type ExternalNotificationPreferenceValue,
} from '@lalanda/shared/work';
import { Alert, ChoiceCards, Field, Skeleton } from '@lalanda/ui';
import { useSearchParams } from 'next/navigation';
import { useEffect, useId, useState } from 'react';

import { detailPortail, portalApi } from '@/lib/portal-api';

export function PreferencesNotifications(): React.ReactElement {
  const id = useId();
  const params = useSearchParams();
  const jeton = params.get('jeton');
  const [valeur, setValeur] = useState<ExternalNotificationPreferenceValue | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistre, setEnregistre] = useState(false);

  useEffect(() => {
    const lire = jeton ? portalApi.preferenceByToken(jeton) : portalApi.myNotifications();
    lire
      .then((v) => setValeur(v.preference))
      .catch((err: unknown) =>
        setErreur(
          detailPortail(err).status === 401
            ? 'Connectez-vous à votre espace pour régler vos e-mails.'
            : (detailPortail(err).message ?? 'Ce lien n’est plus valable.'),
        ),
      );
  }, [jeton]);

  async function choisir(v: ExternalNotificationPreferenceValue): Promise<void> {
    setValeur(v);
    setErreur(null);
    setEnregistre(false);
    try {
      await (jeton ? portalApi.putPreferenceByToken(jeton, v) : portalApi.putMyNotifications(v));
      setEnregistre(true);
    } catch (err) {
      setErreur(detailPortail(err).message ?? 'Réglage non enregistré.');
    }
  }

  return (
    <section className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="font-display text-xl font-bold">Vos e-mails</h1>
      <p className="text-sm text-[var(--foreground-muted)]">
        Choisissez ce que vous recevez par e-mail au sujet de vos projets. Votre espace reste
        accessible dans tous les cas.
      </p>
      {valeur === null && !erreur ? <Skeleton className="h-40 w-full" /> : null}
      {valeur !== null ? (
        <Field id={`${id}-pref`} label="Je reçois" group>
          <ChoiceCards<ExternalNotificationPreferenceValue>
            columns={1}
            value={valeur}
            onChange={(v) => void choisir(v)}
            options={EXTERNAL_NOTIFICATION_PREFERENCES.map((p) => ({
              value: p,
              label: EXTERNAL_NOTIFICATION_PREFERENCE_LABELS[p],
            }))}
          />
        </Field>
      ) : null}
      <p aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
        {enregistre ? 'Enregistré.' : ' '}
      </p>
      {erreur ? (
        <Alert tone="danger">
          <p>{erreur}</p>
        </Alert>
      ) : null}
    </section>
  );
}
