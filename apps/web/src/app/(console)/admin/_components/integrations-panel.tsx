'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Intégrations chiffrées (S21b — ADR-0013)
//
// ── Le champ de secret est un REMPLACEMENT, jamais une modification ──────────
//
// Il est toujours vide au chargement, et il ne peut pas en être autrement : la
// valeur enregistrée n'existe nulle part côté client. Aucun endpoint ne la rend,
// aucun état React ne la détient, aucune requête réseau ne la transporte en
// lecture. Ce que l'écran montre d'un secret tient en cinq champs — enregistré
// ou non, les quatre derniers caractères, la date, l'auteur, la source.
//
// La conséquence pratique est assumée : on ne peut pas « corriger un caractère »
// d'une clé. On la re-saisit entière. C'est le prix d'une interface qui ne peut
// pas fuiter ce qu'elle n'a jamais reçu.
//
// ── Ce que l'écran affiche par intégration ───────────────────────────────────
//
// Statut, empreinte `•••• 1234`, date de dernière modification, résultat du
// dernier test, champ de remplacement, bouton « Tester ». Le résultat du dernier
// test est distinct du statut de configuration : une intégration peut être
// complète et cassée, et confondre les deux ferait apparaître comme
// opérationnelle une clé révoquée la veille.
//
// ── La dérogation n'est proposée qu'après un échec ───────────────────────────
//
// `?force=true` n'apparaît QUE si le serveur a répondu `INTEGRATION_TEST_FAILED`.
// Une case « forcer » offerte d'emblée ferait du contournement le geste normal,
// et le test avant enregistrement ne protégerait plus de rien.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';

import { api, type IntegrationView, type UpdateIntegrationBody } from '@/lib/api';

import { Bandeau, Pastille, Vide } from './admin-chrome';
import {
  aideChamp,
  avertissementSource,
  empreinteSecret,
  exigeReauth,
  formaterDateHeure,
  libelleChamp,
  libelleSource,
  messageErreur,
  offreDerogation,
  resumeDernierTest,
  statutIntegration,
} from './admin-model';
import { ReauthGate, useReauth } from './reauth-gate';

export function IntegrationsPanel(): React.ReactElement {
  const reauth = useReauth();
  const [integrations, setIntegrations] = useState<IntegrationView[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    let annule = false;
    void api
      .listIntegrations()
      .then(({ integrations: liste }) => {
        if (!annule) setIntegrations(liste);
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(messageErreur(err, 'Impossible de charger les intégrations.'));
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  const remplacer = useCallback((maj: IntegrationView): void => {
    setIntegrations((liste) =>
      liste ? liste.map((i) => (i.provider === maj.provider ? maj : i)) : liste,
    );
  }, []);

  if (chargement) return <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>;
  if (erreur) return <Bandeau ton="echec">{erreur}</Bandeau>;
  if (!integrations || integrations.length === 0) {
    return <Vide>Aucune intégration déclarée.</Vide>;
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-3xl text-sm text-[var(--foreground-muted)]">
        Les secrets sont chiffrés au repos et ne ressortent jamais : aucun endpoint de cette API ne
        peut rendre une valeur en clair, y compris à un super-administrateur. Un champ de secret est
        donc toujours vide — le remplir REMPLACE la valeur, le laisser vide la laisse intacte.
      </p>

      <ReauthGate reauth={reauth}>
        <ul className="flex flex-col gap-4">
          {integrations.map((view) => (
            <CarteIntegration
              key={view.provider}
              view={view}
              onMaj={remplacer}
              onReauthRequise={reauth.redemander}
            />
          ))}
        </ul>
      </ReauthGate>
    </div>
  );
}

function CarteIntegration({
  view,
  onMaj,
  onReauthRequise,
}: {
  view: IntegrationView;
  onMaj: (maj: IntegrationView) => void;
  onReauthRequise: () => void;
}): React.ReactElement {
  const statut = statutIntegration(view);
  const dernierTest = resumeDernierTest(view);

  // Brouillons. `secrets` ne contient QUE ce que l'opératrice vient de taper —
  // il part dans la requête puis est effacé, et n'est jamais réhydraté depuis
  // une réponse : la réponse n'en contient pas.
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{
    ton: 'succes' | 'echec' | 'attention';
    texte: string;
  } | null>(null);
  const [derogationOfferte, setDerogationOfferte] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  /** Vide TOUT brouillon de secret — appelé après chaque envoi, réussi ou non. */
  function oublierLesSecretsSaisis(): void {
    setSecrets({});
  }

  async function enregistrer(force: boolean): Promise<void> {
    setEnvoi(true);
    setMessage(null);
    const corps: UpdateIntegrationBody = {};
    const secretsAEnvoyer = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v !== ''));
    if (Object.keys(secretsAEnvoyer).length > 0) corps.secrets = secretsAEnvoyer;
    if (Object.keys(config).length > 0) corps.config = config;

    try {
      onMaj(await api.updateIntegration(view.provider, corps, force));
      oublierLesSecretsSaisis();
      setConfig({});
      setDerogationOfferte(false);
      setMessage({
        ton: force ? 'attention' : 'succes',
        texte: force
          ? 'Enregistré par dérogation, sans test concluant. La dérogation figure au journal et l’état reste « dernier test en échec ».'
          : 'Enregistré après un test de connexion réussi.',
      });
    } catch (err) {
      if (exigeReauth(err)) {
        // La valeur saisie est perdue — c'est voulu : la conserver en mémoire
        // derrière un formulaire de mot de passe rallongerait sa durée de vie
        // côté client sans rien garantir sur ce qui l'observe.
        oublierLesSecretsSaisis();
        onReauthRequise();
      }
      setDerogationOfferte(offreDerogation(err));
      setMessage({ ton: 'echec', texte: messageErreur(err, 'L’enregistrement a échoué.') });
    } finally {
      setEnvoi(false);
    }
  }

  async function tester(): Promise<void> {
    setEnvoi(true);
    setMessage(null);
    try {
      const res = await api.testIntegration(view.provider);
      setMessage({
        ton: res.ok ? 'succes' : 'echec',
        texte: `${res.ok ? 'Test réussi' : 'Test échoué'} en ${res.latencyMs} ms — ${res.detail}`,
      });
      onMaj(await api.getIntegration(view.provider));
    } catch (err) {
      setMessage({ ton: 'echec', texte: messageErreur(err, 'Le test n’a pas pu s’exécuter.') });
    } finally {
      setEnvoi(false);
    }
  }

  async function basculerActivation(): Promise<void> {
    setEnvoi(true);
    setMessage(null);
    try {
      onMaj(await api.updateIntegration(view.provider, { enabled: !view.enabled }));
    } catch (err) {
      if (exigeReauth(err)) onReauthRequise();
      setMessage({ ton: 'echec', texte: messageErreur(err, 'L’action a échoué.') });
    } finally {
      setEnvoi(false);
    }
  }

  async function supprimerSecret(nom: string): Promise<void> {
    setEnvoi(true);
    setMessage(null);
    try {
      onMaj(await api.deleteIntegrationSecret(view.provider, nom));
      setMessage({ ton: 'succes', texte: `Secret « ${libelleChamp(nom)} » supprimé.` });
    } catch (err) {
      if (exigeReauth(err)) onReauthRequise();
      setMessage({ ton: 'echec', texte: messageErreur(err, 'La suppression a échoué.') });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <li className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-bold tracking-tight">{view.label}</h2>
          <p className="text-xs text-[var(--foreground-muted)]">{statut.explication}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pastille ton={statut.ton}>{statut.label}</Pastille>
          <Pastille ton={dernierTest.ton}>{dernierTest.libelle}</Pastille>
        </div>
      </header>

      {dernierTest.detail ? (
        <p className="font-mono text-xs text-[var(--foreground-muted)]">{dernierTest.detail}</p>
      ) : null}

      {/* ── Secrets ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <h3 className="font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]">
          Secrets
        </h3>
        {Object.entries(view.secrets).map(([nom, secret]) => {
          const avertissement = avertissementSource(secret);
          const aide = aideChamp(view.provider, nom);
          const requis = view.requiredSecrets.includes(nom);
          return (
            <div key={nom} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <label htmlFor={`${view.provider}-${nom}`} className="text-sm font-medium">
                  {libelleChamp(nom)}
                  {requis ? (
                    <span className="ml-1 text-xs text-[var(--foreground-muted)]">(requis)</span>
                  ) : null}
                </label>
                <span className="font-mono text-xs text-[var(--foreground-muted)]">
                  {empreinteSecret(secret)} · {libelleSource(secret.source)} · modifié le{' '}
                  {formaterDateHeure(secret.updatedAt)}
                  {secret.updatedBy ? ` par ${secret.updatedBy}` : ''}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id={`${view.provider}-${nom}`}
                  type="password"
                  autoComplete="off"
                  value={secrets[nom] ?? ''}
                  onChange={(e) => setSecrets((s) => ({ ...s, [nom]: e.target.value }))}
                  placeholder={
                    secret.configured
                      ? 'Laisser vide pour conserver la valeur actuelle'
                      : 'Aucune valeur enregistrée'
                  }
                  className="w-full max-w-md rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 font-mono text-sm"
                />
                {secret.configured && secret.source === 'db' ? (
                  <button
                    type="button"
                    disabled={envoi}
                    onClick={() => void supprimerSecret(nom)}
                    className="text-xs text-[var(--danger)] underline underline-offset-2 disabled:opacity-40"
                  >
                    supprimer
                  </button>
                ) : null}
              </div>
              {aide ? (
                <p className="max-w-2xl text-xs text-[var(--foreground-muted)]">{aide}</p>
              ) : null}
              {avertissement ? <Bandeau ton="attention">{avertissement}</Bandeau> : null}
            </div>
          );
        })}
      </div>

      {/* ── Configuration en clair ───────────────────────────────────── */}
      {view.configFields.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]">
            Configuration — stockée en clair
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {view.configFields.map((cle) => {
              const actuelle = view.config[cle];
              const aide = aideChamp(view.provider, cle);
              return (
                <label key={cle} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">
                    {libelleChamp(cle)}
                    {view.requiredConfig.includes(cle) ? (
                      <span className="ml-1 text-xs text-[var(--foreground-muted)]">(requis)</span>
                    ) : null}
                  </span>
                  <input
                    type="text"
                    value={config[cle] ?? (actuelle === undefined ? '' : String(actuelle))}
                    onChange={(e) => setConfig((c) => ({ ...c, [cle]: e.target.value }))}
                    className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 font-mono text-sm"
                  />
                  {aide ? (
                    <span className="text-xs text-[var(--foreground-muted)]">{aide}</span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ── Commandes ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-4">
        <p className="text-xs text-[var(--foreground-muted)]">
          Test de connexion : {view.testDescription} Il s’exécute AVANT tout enregistrement — si les
          identifiants sont refusés, rien n’est écrit.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={envoi}
            onClick={() => void enregistrer(false)}
            className="rounded-md border border-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/10 disabled:opacity-40"
          >
            {envoi ? 'En cours…' : 'Tester puis enregistrer'}
          </button>
          <button
            type="button"
            disabled={envoi}
            onClick={() => void tester()}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-40"
          >
            Tester
          </button>
          <button
            type="button"
            disabled={envoi}
            onClick={() => void basculerActivation()}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-40"
          >
            {view.enabled ? 'Désactiver' : 'Activer'}
          </button>
          <span className="font-mono text-xs text-[var(--foreground-muted)]">
            dernière modification : {formaterDateHeure(view.updatedAt)}
          </span>
        </div>

        {message ? <Bandeau ton={message.ton}>{message.texte}</Bandeau> : null}

        {derogationOfferte ? (
          <div className="flex flex-col gap-2 rounded-md border border-[var(--warning)]/30 bg-[var(--warning-bg)] p-3">
            <p className="text-xs text-[var(--warning)]">
              Le test n’a pas abouti. Vous pouvez enregistrer quand même — par exemple si ce serveur
              n’a pas d’accès sortant vers le fournisseur. La dérogation est inscrite au journal
              avec votre identité, et l’intégration restera marquée « dernier test en échec »
              jusqu’à un test concluant.
            </p>
            <div>
              <button
                type="button"
                disabled={envoi}
                onClick={() => void enregistrer(true)}
                className="rounded-md border border-[var(--warning)]/40 px-3 py-2 text-sm font-medium text-[var(--warning)] transition disabled:opacity-40"
              >
                Enregistrer sans test concluant
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
}
