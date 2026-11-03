'use client';

// Assistant d'activation (ADR-0049 § 3.1, § 13) : cinq étapes, puis le choix du mode.
// `active` reste grisé, avec sa raison, tant que le pack n'est pas approuvé ; la
// simulation est possible avec le pack brouillon. Le serveur reste juge : un refus
// `409 ACCOUNTING_ACTIVATION_PRECONDITION` affiche la liste des conditions manquantes.

import {
  ACCOUNTING_BOOK_CURRENCIES,
  ACCOUNTING_TO_CONFIRM_LABEL,
  type AccountingBookCurrency,
  type AccountingMode,
} from '@lalanda/shared/accounting';
import { Badge, Button, Modal } from '@lalanda/ui';
import { ListChecks, Power } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  accountingApi,
  type AccountingChartPackSummary,
  type AccountingFiscalYearView,
  type AccountingRuleSetView,
  type AccountingSettingsView,
} from '@/lib/api-accounting';

import { CHAMP } from '../../ventes/_components/form-ui';

import {
  LIBELLES_CONDITION,
  LIBELLES_ETAT_ETAPE,
  conditionsDuRefus,
  etapesActivation,
  optionsMode,
  type EtapeActivation,
} from './activation-model';
import { useAccesCompta } from './comptabilite-access';
import {
  LIBELLES_STATUT_PACK,
  lire,
  messageCompta,
  packActivable,
  peutParametrer,
  type Lecture,
} from './comptabilite-model';
import { AConfirmer, Chargement, EchecLecture, Panneau, Terme } from './comptabilite-ui';
import { GestesRegles, OuvrirExercice, usePackChoisi } from './regles';
import { exerciceAProposer, jourDe } from './regles-model';

type EtapeOuverte = EtapeActivation['id'] | null;

function FenetreEtape({
  etape,
  reglages,
  onClose,
  onSaved,
}: {
  etape: EtapeOuverte;
  reglages: AccountingSettingsView;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const [packs, setPacks] = useState<Lecture<AccountingChartPackSummary[]> | null>(null);
  const [pack, setPack] = useState(
    reglages.chartPack ? `${reglages.chartPack.slug}@${reglages.chartPack.version}` : '',
  );
  const [devise, setDevise] = useState<AccountingBookCurrency | ''>(reglages.bookCurrency ?? '');
  const [bascule, setBascule] = useState(reglages.cutoverDate ?? '');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (etape !== 'pack') return;
    let annule = false;
    void lire(accountingApi.listChartPacks().then((r) => r.items)).then((l) => {
      if (!annule) setPacks(l);
    });
    return () => {
      annule = true;
    };
  }, [etape]);

  async function enregistrer(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      if (etape === 'pack') {
        const [slug, version] = pack.split('@');
        if (!slug || !version) throw new Error('Choisissez un plan comptable.');
        const { revision } = await accountingApi.getSettings();
        await accountingApi.updateSettings({
          expectedRevision: revision,
          chartPack: { slug, version: Number(version) },
        });
      } else if (etape === 'monnaie') {
        if (devise === '') throw new Error('Choisissez la monnaie de tenue.');
        const { revision } = await accountingApi.getSettings();
        await accountingApi.updateSettings({ expectedRevision: revision, bookCurrency: devise });
      } else if (etape === 'bascule') {
        if (bascule === '') throw new Error('Choisissez la date de bascule.');
        const { revision } = await accountingApi.getSettings();
        await accountingApi.updateSettings({ expectedRevision: revision, cutoverDate: bascule });
      }
      onSaved();
    } catch (err) {
      setErreur(
        messageCompta(err, err instanceof Error ? err.message : 'Enregistrement impossible.'),
      );
    } finally {
      setEnvoi(false);
    }
  }

  const titres: Record<Exclude<EtapeOuverte, null>, string> = {
    pack: 'Choisir le plan comptable',
    monnaie: 'Choisir la monnaie de tenue',
    bascule: 'Choisir la date de bascule',
    regles: 'Règles de correspondance',
    exercice: 'Premier exercice',
  };

  return (
    <Modal
      open={etape !== null && etape !== 'regles' && etape !== 'exercice'}
      onClose={onClose}
      title={etape ? titres[etape] : ''}
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
        {etape === 'pack' ? (
          packs === null ? (
            <Chargement />
          ) : !packs.ok ? (
            <EchecLecture erreur={packs.erreur} repli="Les plans comptables sont illisibles." />
          ) : packs.valeur.length === 0 ? (
            <p>Aucun plan comptable n’est encore publié.</p>
          ) : (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 font-medium">Plans comptables publiés</legend>
              {packs.valeur.map((p) => {
                const cle = `${p.slug}@${p.version}`;
                return (
                  <label
                    key={cle}
                    className="flex cursor-pointer flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--border)] p-3 has-[:checked]:border-[var(--module-run)]"
                  >
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      <input
                        type="radio"
                        name="pack"
                        value={cle}
                        checked={pack === cle}
                        onChange={() => setPack(cle)}
                      />
                      {p.slug}, version {p.version}
                      <Badge tone={packActivable(p.status) ? 'success' : 'warning'}>
                        {LIBELLES_STATUT_PACK[p.status]}
                      </Badge>
                    </span>
                    {p.warnings.length > 0 ? (
                      <ul className="ml-6 list-disc text-[var(--foreground-muted)]">
                        {p.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    ) : null}
                  </label>
                );
              })}
            </fieldset>
          )
        ) : null}
        {etape === 'monnaie' ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2">
              La balance et les états sont tenus dans cette monnaie. Chaque ligne garde aussi le
              montant de la pièce dans sa devise. Elle ne change plus après la première écriture
              validée.
            </legend>
            {ACCOUNTING_BOOK_CURRENCIES.map((c) => (
              <label key={c} className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="devise"
                  value={c}
                  checked={devise === c}
                  onChange={() => setDevise(c)}
                />
                {c === 'CDF' ? 'Franc congolais (CDF)' : 'Dollar américain (USD)'}
              </label>
            ))}
            <p className="text-[var(--foreground-muted)]">
              Quelle monnaie retenir ? C’est une question pour votre expert-comptable.
            </p>
          </fieldset>
        ) : null}
        {etape === 'bascule' ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="compta-bascule" className="font-medium">
              Date de bascule
            </label>
            <input
              id="compta-bascule"
              type="date"
              className={`${CHAMP} sm:w-56`}
              value={bascule}
              onChange={(e) => setBascule(e.target.value)}
            />
            <p className="text-[var(--foreground-muted)]">
              Les pièces antérieures ne sont jamais passées en écritures. La situation à cette date
              entre par des à-nouveaux de reprise, que vous saisissez et validez : Lalanda propose
              les soldes de trésorerie et les factures ouvertes, sans rien valider à votre place.
            </p>
          </div>
        ) : null}
        {erreur ? (
          <p role="alert" className="font-medium text-[var(--danger)]">
            {erreur}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export function Activation(): React.ReactElement {
  const { actions, reglages, recharger } = useAccesCompta();
  const [jeux, setJeux] = useState<Lecture<AccountingRuleSetView[]> | null>(null);
  const [exercices, setExercices] = useState<Lecture<AccountingFiscalYearView[]> | null>(null);
  const pack = usePackChoisi(reglages?.ok ? reglages.valeur : null);
  const [ouverte, setOuverte] = useState<EtapeOuverte>(null);
  const [envoi, setEnvoi] = useState<AccountingMode | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [manquantes, setManquantes] = useState<string[] | null>(null);

  useEffect(() => {
    let annule = false;
    void lire(accountingApi.listRuleSets().then((r) => r.items)).then((l) => {
      if (!annule) setJeux(l);
    });
    void lire(accountingApi.listFiscalYears().then((r) => r.items)).then((l) => {
      if (!annule) setExercices(l);
    });
    return () => {
      annule = true;
    };
  }, [reglages]);

  if (reglages === null) return <Chargement />;
  if (!reglages.ok) {
    return (
      <Panneau titre="Activation" icone={Power} id="compta-activation">
        <EchecLecture
          erreur={reglages.erreur}
          repli="Les réglages sont illisibles."
          onReessayer={recharger}
        />
      </Panneau>
    );
  }

  const r = reglages.valeur;
  const etapes = etapesActivation(
    r,
    jeux?.ok ? jeux.valeur : null,
    exercices?.ok ? exercices.valeur : null,
  );
  const anneeAOuvrir = exercices?.ok
    ? exerciceAProposer(r, exercices.valeur, jourDe(new Date()))
    : null;
  const options = optionsMode(r, actions);
  const modifiable = peutParametrer(actions);

  async function changerMode(mode: AccountingMode): Promise<void> {
    setEnvoi(mode);
    setErreur(null);
    setManquantes(null);
    try {
      if (mode === 'active') await accountingApi.activate(r.revision);
      else if (r.mode === 'active') {
        const off = await accountingApi.deactivate(r.revision);
        if (mode === 'simulation') {
          await accountingApi.updateSettings({ expectedRevision: off.revision, mode });
        }
      } else await accountingApi.updateSettings({ expectedRevision: r.revision, mode });
      recharger();
    } catch (err) {
      const conditions = conditionsDuRefus(err);
      if (conditions !== null) setManquantes(conditions.map((c) => LIBELLES_CONDITION[c]));
      setErreur(messageCompta(err, 'Le changement de mode a échoué.'));
    } finally {
      setEnvoi(null);
    }
  }

  return (
    <>
      <Panneau titre="Assistant d’activation" icone={ListChecks} id="compta-assistant">
        <ol className="grid gap-3 md:grid-cols-2">
          {etapes.map((e) => (
            <li
              key={e.id}
              className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {e.numero}. {e.titre}
                </span>
                <Badge
                  tone={
                    e.etat === 'fait'
                      ? 'success'
                      : e.etat === 'attente-expert'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {LIBELLES_ETAT_ETAPE[e.etat]}
                </Badge>
              </div>
              <p className="text-sm text-[var(--foreground-muted)]">{e.resume}</p>
              {e.id === 'pack' && r.chartPack && !packActivable(r.chartPack.status) ? (
                <p className="text-sm">
                  <AConfirmer texte={ACCOUNTING_TO_CONFIRM_LABEL} /> Les comptes de ce plan sont des
                  candidats : ils ne servent qu’à la simulation. Pour la tenue active, choisissez un
                  plan au statut « {LIBELLES_STATUT_PACK.approved} » : hors tenue active, le plan se
                  change, et un brouillon de règles se reprend depuis le nouveau plan.
                </p>
              ) : null}
              {e.id === 'regles' ? (
                <GestesRegles jeux={jeux?.ok ? jeux.valeur : null} pack={pack} lienVersRegles />
              ) : e.id === 'exercice' ? (
                anneeAOuvrir !== null ? (
                  <OuvrirExercice annee={anneeAOuvrir} onOuvert={recharger} />
                ) : null
              ) : modifiable ? (
                <div>
                  <Button variant="secondary" size="sm" onClick={() => setOuverte(e.id)}>
                    {e.etat === 'a-faire' ? 'Choisir' : 'Modifier'}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </Panneau>

      <Panneau titre="Mode de la comptabilité" icone={Power} id="compta-mode">
        <p className="text-sm text-[var(--foreground-muted)]">
          Commencez par la <Terme terme="ecriture">simulation</Terme> : elle montre ce que
          deviendraient vos pièces, sans rien enregistrer. Ne passez en tenue active qu’après la
          relecture de votre expert-comptable.
        </p>
        <ul className="grid gap-3 md:grid-cols-3">
          {options.map((o) => (
            <li
              key={o.mode}
              className={`flex flex-col gap-2 rounded-[var(--radius-md)] border p-4 ${o.courant ? 'border-[var(--module-run)]' : 'border-[var(--border)]'} ${o.raison && !o.courant ? 'opacity-70' : ''}`}
            >
              <span className="flex flex-wrap items-center gap-2 font-semibold">
                {o.libelle}
                {o.courant ? <Badge tone="info">Mode actuel</Badge> : null}
                {o.mode === 'simulation' ? (
                  <Badge tone="warning">Rien n’est enregistré</Badge>
                ) : null}
              </span>
              <p className="text-sm text-[var(--foreground-muted)]">{o.explication}</p>
              {o.raison && !o.courant ? (
                <p className="text-sm" id={`raison-${o.mode}`}>
                  {o.raison}
                </p>
              ) : null}
              {!o.courant ? (
                <div className="mt-auto">
                  <Button
                    variant={o.mode === 'simulation' ? 'primary' : 'secondary'}
                    size="sm"
                    disabled={o.desactive || envoi !== null}
                    aria-describedby={o.raison ? `raison-${o.mode}` : undefined}
                    onClick={() => void changerMode(o.mode)}
                  >
                    {o.mode === 'off'
                      ? 'Éteindre'
                      : o.mode === 'simulation'
                        ? 'Passer en simulation'
                        : 'Passer en tenue active'}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {erreur ? (
          <div role="alert" className="flex flex-col gap-1 text-sm text-[var(--danger)]">
            <p className="font-medium">{erreur}</p>
            {manquantes && manquantes.length > 0 ? (
              <ul className="ml-5 list-disc">
                {manquantes.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {r.mode === 'active' ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            Revenir à « Éteinte » n’efface rien : la synchronisation s’arrête, les livres restent
            lisibles et exportables.
          </p>
        ) : null}
      </Panneau>

      {ouverte !== null ? (
        <FenetreEtape
          etape={ouverte}
          reglages={r}
          onClose={() => setOuverte(null)}
          onSaved={() => {
            setOuverte(null);
            recharger();
          }}
        />
      ) : null}
    </>
  );
}
