'use client';

// Formulaire public de prospects — ADR-0048 § 4, § 6 et § 9.
//
// Sobre, une colonne lisible sur téléphone : libellés visibles, erreurs reliées
// à leur champ (`aria-describedby`), état annoncé (`role="status"`), bouton
// désactivé pendant l'envoi. Le champ piège est hors de la vue ET du parcours
// clavier (`aria-hidden`, `tabIndex={-1}`). Logo et couleur de l'organisation
// seulement si l'API les rend ; sinon la charte Lalanda sobre.

import { buttonClasses } from '@lalanda/ui';
import { useCallback, useEffect, useId, useState } from 'react';

import { PublicFormError, publicLeadFormApi, type PublicLeadFormView } from '@/lib/api-lead-forms';
import { applyFavicon } from '@/lib/favicon';

import {
  SAISIE,
  corpsSoumission,
  couleurSure,
  erreursLocales,
  erreursParChamp,
  messageRefus,
  valeursInitiales,
  type Valeurs,
} from './formulaire-public-model';

const CHAMP =
  'w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-base outline-none transition focus:border-[var(--accent)] aria-[invalid=true]:border-[var(--danger)]';

type Phase = 'chargement' | 'introuvable' | 'pret' | 'envoye';

export function FormulairePublic({ token }: { token: string }): React.ReactElement {
  const id = useId();
  const [phase, setPhase] = useState<Phase>('chargement');
  const [vue, setVue] = useState<PublicLeadFormView | null>(null);
  const [valeurs, setValeurs] = useState<Valeurs>({});
  const [accord, setAccord] = useState(false);
  const [piege, setPiege] = useState('');
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [alerte, setAlerte] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [merci, setMerci] = useState('');

  const charger = useCallback(
    async (garderSaisie: boolean) => {
      try {
        const v = await publicLeadFormApi.config(token);
        setVue(v);
        // ADR-0073 § 3 : favicon de l'organisation, sinon celui de Lalanda.
        applyFavicon(v.faviconUrl ?? null);
        if (!garderSaisie) {
          const source =
            typeof window === 'undefined'
              ? null
              : new URLSearchParams(window.location.search).get('source');
          setValeurs(valeursInitiales(v.fields, source));
        }
        setPhase('pret');
      } catch (err) {
        if (err instanceof PublicFormError && err.status === 404) setPhase('introuvable');
        else {
          setAlerte(
            err instanceof PublicFormError
              ? messageRefus(err.code, err.status, err.message)
              : 'Formulaire indisponible.',
          );
          setPhase('introuvable');
        }
      }
    },
    [token],
  );

  useEffect(() => {
    void charger(false);
  }, [charger]);

  async function envoyer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!vue || envoi) return;
    setAlerte(null);
    const locales = erreursLocales(vue.fields, valeurs, accord);
    setErreurs(locales);
    if (Object.keys(locales).length > 0) {
      setAlerte('Certains champs sont à corriger.');
      return;
    }
    setEnvoi(true);
    try {
      const r = await publicLeadFormApi.submit(
        token,
        corpsSoumission(vue.fields, valeurs, vue.ticket, accord, piege),
      );
      setMerci(r.message);
      setPhase('envoye');
    } catch (err) {
      if (err instanceof PublicFormError) {
        setErreurs(erreursParChamp(err.issues));
        setAlerte(messageRefus(err.code, err.status, err.message));
        if (err.status === 404) setPhase('introuvable');
        // Ticket expiré : on recharge la configuration sans perdre la saisie.
        if (err.code === 'LEAD_FORM_TICKET_INVALID') await charger(true);
      } else {
        setAlerte('Envoi impossible : réessayez.');
      }
    } finally {
      setEnvoi(false);
    }
  }

  const couleur = couleurSure(vue?.branding?.color);

  return (
    <div className="surface-marque min-h-screen">
      <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col px-4 py-8 sm:py-12">
        <div
          className="flex flex-col gap-6 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm sm:p-8"
          style={couleur ? { borderTop: `4px solid ${couleur}` } : undefined}
        >
          {phase === 'chargement' ? (
            <p role="status" className="text-sm text-[var(--foreground-muted)]">
              Chargement du formulaire…
            </p>
          ) : null}

          {phase === 'introuvable' ? (
            <div className="flex flex-col gap-2">
              <h1 className="font-display text-xl font-bold">Formulaire indisponible</h1>
              <p className="text-sm text-[var(--foreground-muted)]">
                {alerte ??
                  'Ce lien n’est pas ou plus actif. Contactez directement l’organisation qui vous l’a donné.'}
              </p>
            </div>
          ) : null}

          {vue && (phase === 'pret' || phase === 'envoye') ? (
            <header className="flex flex-col gap-3">
              {vue.branding?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- logo servi par l'API (jeton signé), comme ailleurs
                <img
                  src={vue.branding.logoUrl}
                  alt=""
                  className="h-12 w-auto max-w-[12rem] self-start object-contain"
                />
              ) : null}
              <h1 className="font-display text-2xl font-bold leading-tight tracking-tight">
                {vue.title}
              </h1>
              {vue.intro && phase === 'pret' ? (
                <p className="whitespace-pre-line text-sm text-[var(--foreground-muted)]">
                  {vue.intro}
                </p>
              ) : null}
            </header>
          ) : null}

          {phase === 'envoye' ? (
            <p role="status" className="text-base">
              {merci}
            </p>
          ) : null}

          {vue && phase === 'pret' ? (
            <form noValidate onSubmit={(e) => void envoyer(e)} className="flex flex-col gap-4">
              {alerte ? (
                <p
                  role="alert"
                  className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
                >
                  {alerte}
                </p>
              ) : null}
              {vue.fields.map((c) => {
                const champId = `${id}-${c.key}`;
                const erreur = erreurs[c.key];
                const saisie = SAISIE[c.key];
                const commun = {
                  id: champId,
                  name: c.key,
                  value: valeurs[c.key] ?? '',
                  maxLength: c.maxLength,
                  required: c.required,
                  autoComplete: saisie.autoComplete,
                  'aria-invalid': erreur ? true : undefined,
                  'aria-describedby': erreur ? `${champId}-erreur` : undefined,
                  className: CHAMP,
                };
                const changer = (v: string) => setValeurs((p) => ({ ...p, [c.key]: v }));
                return (
                  <div key={c.key} className="flex flex-col gap-1.5">
                    <label htmlFor={champId} className="text-sm font-medium">
                      {c.label}
                      {c.required ? (
                        <>
                          <span aria-hidden="true"> *</span>
                          <span className="sr-only"> (obligatoire)</span>
                        </>
                      ) : null}
                    </label>
                    {saisie.multiligne ? (
                      <textarea {...commun} rows={5} onChange={(e) => changer(e.target.value)} />
                    ) : (
                      <input
                        {...commun}
                        type={saisie.type}
                        inputMode={saisie.type === 'tel' ? 'tel' : undefined}
                        onChange={(e) => changer(e.target.value)}
                      />
                    )}
                    {erreur ? (
                      <p id={`${champId}-erreur`} className="text-xs text-[var(--danger)]">
                        {erreur}
                      </p>
                    ) : null}
                  </div>
                );
              })}

              {/* Champ piège (ADR-0048 O4) : invisible, hors du parcours clavier. */}
              <div
                aria-hidden="true"
                className="absolute -left-[10000px] h-px w-px overflow-hidden"
              >
                <label htmlFor={`${id}-website`}>Ne pas remplir</label>
                <input
                  id={`${id}-website`}
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={piege}
                  onChange={(e) => setPiege(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-start gap-2.5">
                  <input
                    id={`${id}-accord`}
                    type="checkbox"
                    checked={accord}
                    onChange={(e) => setAccord(e.target.checked)}
                    aria-invalid={erreurs['consent'] ? true : undefined}
                    aria-describedby={erreurs['consent'] ? `${id}-accord-erreur` : undefined}
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <label htmlFor={`${id}-accord`} className="text-sm">
                    {vue.consent.text}
                  </label>
                </div>
                {vue.consent.policyUrl ? (
                  <a
                    href={vue.consent.policyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-7 self-start text-sm underline underline-offset-2"
                  >
                    Politique de confidentialité (nouvel onglet)
                  </a>
                ) : null}
                {erreurs['consent'] ? (
                  <p id={`${id}-accord-erreur`} className="text-xs text-[var(--danger)]">
                    {erreurs['consent']}
                  </p>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={envoi}
                className={buttonClasses('primary', 'lg', 'w-full sm:w-auto sm:self-start')}
              >
                {envoi ? 'Envoi…' : 'Envoyer ma demande'}
              </button>
            </form>
          ) : null}

          <p className="text-xs text-[var(--foreground-muted)]">
            Formulaire hébergé par Lalanda pour le compte de l’organisation destinataire.
          </p>
        </div>
      </main>
    </div>
  );
}
