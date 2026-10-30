'use client';

// Fiche d'une opportunité — ADR-0035 § 5, ADR-0040 § 6 : étape (déplacement,
// perte avec motif obligatoire), responsable, lignes d'articles et montant tiré
// des lignes (calculé par l'API), devis liés et « Créer un devis » prérempli
// (`POST /sales/quotes/from-opportunity`, `sales.quote`), activités (assigné,
// faite / rouvrir), historique des étapes.
//
// « Créer le projet » d'une opportunité gagnée : encadré du lot C7
// (`opportunites/[opportunityId]/_components/creer-projet.tsx`).

import { Badge, buttonClasses } from '@lalanda/ui';
import { CalendarClock, FileText, History, ListOrdered, Target } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  crmApi,
  type ActivityView,
  type CrmSettingsView,
  type OpportunityView,
} from '@/lib/api-crm';

import { Alerte, BOUTON, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';
import { formatMontant } from '../../ventes/_components/sales-model';
import { DEVIS_BASE, QUOTE_STATUS_LABELS } from '../../ventes/devis/_components/quote-model';

import { libelleEcheance, jourKinshasa, tonActivite } from './activites-model';
import { useAccesCrm } from './crm-access';
import {
  ACTIVITY_KINDS,
  ACTIVITY_LABELS,
  CRM_BASE,
  formulaireOpportunite,
  interlocuteur,
  lienCompte,
  messageCrm,
  montantEstime,
  peutGererCrm,
  peutPreparerDevis,
  preparerActivite,
  preparerOpportunite,
  type FormulaireActivite,
  type FormulaireOpportunite,
} from './crm-model';
import { Bandeau, ChoixCompte, ChoixMembre, Panneau, Tuile } from './crm-ui';
import {
  formulaireLignes,
  ligneVide,
  messagesAvertissements,
  preparerLignes,
  type FormulaireLigne,
} from './lignes-model';
import { BoiteMotifPerte, type DemandeMotif } from './motif-perte';
import { MENTION_ESTIME, libelleMotif, nomMembre, suiteDepot } from './pipeline-model';
// ADR-0040 — C7
import { CreerProjet } from '../opportunites/[opportunityId]/_components/creer-projet';

function EditeurLignes({
  lignes,
  setLignes,
  erreurs,
  desactive,
}: {
  lignes: FormulaireLigne[];
  setLignes: (l: FormulaireLigne[]) => void;
  erreurs: Record<number, string>;
  desactive: boolean;
}): React.ReactElement {
  const maj = (i: number, champ: keyof FormulaireLigne, v: string) =>
    setLignes(lignes.map((l, n) => (n === i ? { ...l, [champ]: v } : l)));
  return (
    <div className="flex flex-col gap-3">
      {lignes.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          Aucune ligne. Ajoutez les articles ou prestations envisagés : le devis les reprendra.
        </p>
      ) : null}
      <ol className="flex flex-col gap-3">
        {lignes.map((l, i) => (
          <li
            key={i}
            className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]"
          >
            <input
              aria-label={`Libellé de la ligne ${i + 1}`}
              placeholder="Libellé"
              className={CHAMP}
              value={l.label}
              maxLength={200}
              disabled={desactive}
              onChange={(e) => maj(i, 'label', e.target.value)}
            />
            <input
              aria-label={`Quantité de la ligne ${i + 1}`}
              placeholder="Quantité"
              inputMode="decimal"
              className={CHAMP}
              value={l.quantite}
              disabled={desactive}
              onChange={(e) => maj(i, 'quantite', e.target.value)}
            />
            <input
              aria-label={`Unité de la ligne ${i + 1}`}
              placeholder="Unité"
              className={CHAMP}
              value={l.unite}
              maxLength={20}
              disabled={desactive}
              onChange={(e) => maj(i, 'unite', e.target.value)}
            />
            <input
              aria-label={`Prix unitaire hors taxes de la ligne ${i + 1}`}
              placeholder="Prix HT"
              inputMode="decimal"
              className={CHAMP}
              value={l.prix}
              disabled={desactive}
              onChange={(e) => maj(i, 'prix', e.target.value)}
            />
            <input
              aria-label={`Remise en pour cent de la ligne ${i + 1}`}
              placeholder="Remise %"
              inputMode="decimal"
              className={CHAMP}
              value={l.remise}
              disabled={desactive}
              onChange={(e) => maj(i, 'remise', e.target.value)}
            />
            {!desactive ? (
              <button
                type="button"
                className={BOUTON_PETIT}
                aria-label={`Retirer la ligne ${i + 1}`}
                onClick={() => setLignes(lignes.filter((_, n) => n !== i))}
              >
                Retirer
              </button>
            ) : null}
            {erreurs[i] ? (
              <p className="text-xs text-[var(--danger)] sm:col-span-6">{erreurs[i]}</p>
            ) : null}
          </li>
        ))}
      </ol>
      {!desactive ? (
        <button
          type="button"
          className={`${BOUTON_PETIT} self-start`}
          onClick={() => setLignes([...lignes, ligneVide()])}
        >
          Ajouter une ligne
        </button>
      ) : null}
    </div>
  );
}

export function OpportunityDetail({
  opportunityId,
}: {
  opportunityId: string;
}): React.ReactElement {
  const router = useRouter();
  const { actions, membres } = useAccesCrm();
  const gerer = peutGererCrm(actions);
  const devis = peutPreparerDevis(actions);
  const [vue, setVue] = useState<OpportunityView | null>(null);
  const [activites, setActivites] = useState<ActivityView[]>([]);
  const [settings, setSettings] = useState<CrmSettingsView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string[]>([]);
  const [form, setForm] = useState<FormulaireOpportunite>(formulaireOpportunite());
  const [lignes, setLignes] = useState<FormulaireLigne[]>([]);
  const [source, setSource] = useState<'manual' | 'lines'>('manual');
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreursLignes, setErreursLignes] = useState<Record<number, string>>({});
  const [f, setF] = useState<FormulaireActivite>({
    kind: 'call',
    subject: '',
    notes: '',
    echeance: '',
    assigneeUserId: '',
  });
  const [champsAct, setChampsAct] = useState<Record<string, string>>({});
  const [motif, setMotif] = useState<DemandeMotif | null>(null);
  const [sansLignes, setSansLignes] = useState(false);
  const aujourdhui = jourKinshasa(new Date());

  const appliquer = useCallback((o: OpportunityView) => {
    setVue(o);
    // Responsable vide = inchangé : un ancien membre (orpheline) ne serait pas réécrit.
    setForm({ ...formulaireOpportunite(o), ownerId: '' });
    setLignes(formulaireLignes(o.lines));
    setSource(o.amountSource);
  }, []);

  const charger = useCallback(() => {
    Promise.all([
      crmApi.getOpportunity(opportunityId),
      crmApi.listActivities({ opportunityId, limit: 100 }),
      crmApi.getSettings(),
    ])
      .then(([o, a, s]) => {
        appliquer(o);
        setActivites(a.items);
        setSettings(s);
        setErreur(null);
      })
      .catch((err) => setErreur(messageCrm(err, 'Opportunité illisible.')));
  }, [opportunityId, appliquer]);

  useEffect(() => charger(), [charger]);

  async function agir(fn: () => Promise<unknown>): Promise<void> {
    setErreur(null);
    setInfo([]);
    try {
      await fn();
      charger();
    } catch (err) {
      setErreur(messageCrm(err, 'Action impossible.'));
    }
  }

  if (vue === null || settings === null) {
    return erreur ? (
      <Alerte>
        <p>{erreur}</p>
      </Alerte>
    ) : (
      <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
    );
  }
  const v = vue;

  function enregistrer(): void {
    const p = preparerOpportunite(form, source);
    const l = preparerLignes(lignes);
    setChamps(p.ok ? {} : p.champs);
    setErreursLignes(l.ok ? {} : l.erreurs);
    if (!p.ok || !l.ok) return;
    void agir(async () => {
      const r = await crmApi.updateOpportunity(v.id, {
        ...p.corps,
        lines: l.corps,
        expectedRevision: v.revision,
      });
      setInfo(['Opportunité enregistrée.', ...messagesAvertissements(r.warnings)]);
    }).then(() => undefined);
  }

  function deplacer(stageKey: string): void {
    if (!settings || stageKey === v.stageKey) return;
    const envoyer = (
      corps: { lostReasonKey: string | null; lostReasonDetail: string | null } | null,
    ) =>
      void agir(() =>
        crmApi.moveOpportunity(v.id, { expectedRevision: v.revision, stageKey, ...(corps ?? {}) }),
      );
    if (suiteDepot(settings.stages, stageKey) === 'motif') {
      setMotif({
        titre: v.title,
        valider: (corps) => {
          setMotif(null);
          envoyer(corps);
        },
        annuler: () => setMotif(null),
      });
    } else envoyer(null);
  }

  async function creerDevis(): Promise<void> {
    setErreur(null);
    setSansLignes(false);
    try {
      const q = await crmApi.createQuoteFromOpportunity(v.id);
      router.push(`${DEVIS_BASE}/${encodeURIComponent(q.id)}`);
    } catch (err) {
      const code = (err as { detail?: { code?: unknown } } | null)?.detail?.code;
      if (code === 'CRM_OPPORTUNITY_HAS_NO_LINES') setSansLignes(true);
      else setErreur(messageCrm(err, 'Création du devis impossible.'));
    }
  }

  const devisVierge = `${DEVIS_BASE}/nouveau?${new URLSearchParams({
    opportunite: v.id,
    ...(v.customerId ? { client: v.customerId, nom: v.customerName ?? '' } : {}),
  }).toString()}`;
  const motifPerte = libelleMotif(settings.lostReasons, v.lostReasonKey);
  const tonStatut = v.status === 'won' ? 'success' : v.status === 'lost' ? 'danger' : 'info';

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Link href={CRM_BASE} className="text-sm underline underline-offset-2">
        ← Pipeline
      </Link>
      <Bandeau
        icone={Target}
        titre={v.title}
        sousTitre={
          <>
            {v.accountId ? (
              <Link href={lienCompte(v.accountId)} className="underline underline-offset-2">
                {interlocuteur(v)}
              </Link>
            ) : (
              interlocuteur(v)
            )}
            {v.contactName ? ` · contact : ${v.contactName}` : ''}
          </>
        }
        actions={
          <>
            <Badge tone={tonStatut}>{v.stageLabel}</Badge>
            {v.orphaned ? <Badge tone="danger">Sans responsable</Badge> : null}
          </>
        }
      >
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tuile
            libelle="Montant estimé"
            valeur={v.amount === null ? 'Non estimé' : formatMontant(v.amount, v.currency)}
            detail={v.amountSource === 'lines' ? 'Tiré des lignes (HT)' : 'Saisi'}
          />
          <Tuile
            libelle="Responsable"
            valeur={v.orphaned ? 'À réassigner' : nomMembre(membres, v.ownerId)}
          />
          <Tuile libelle="Clôture prévue" valeur={v.expectedCloseDate ?? 'Non fixée'} />
          <Tuile
            libelle="Dernière activité"
            valeur={`${v.daysSinceActivity} j`}
            attention={v.stale}
            detail={v.stale ? 'Inactive' : undefined}
          />
        </dl>
        {v.status === 'lost' ? (
          <p className="text-sm">
            Motif de la perte : <strong>{motifPerte ?? 'non renseigné'}</strong>
            {v.lostReason ? ` — ${v.lostReason}` : ''}
          </p>
        ) : null}
      </Bandeau>

      {/* ADR-0040 — C7 : opportunité gagnée → « Créer le projet » (jamais automatique). */}
      <CreerProjet opportunityId={v.id} status={v.status} actions={actions} />

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {info.length > 0 ? (
        <div role="status" className="flex flex-col gap-1 text-sm">
          {info.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      ) : null}

      {gerer ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Déplacer vers
            <select className={CHAMP} value={v.stageKey} onChange={(e) => deplacer(e.target.value)}>
              {settings.stages.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={BOUTON_PETIT}
            onClick={() =>
              void agir(async () => {
                if (!window.confirm('Supprimer cette opportunité et ses activités ?')) return;
                await crmApi.deleteOpportunity(v.id);
                router.push(CRM_BASE);
              })
            }
          >
            Supprimer
          </button>
        </div>
      ) : null}

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Panneau titre="Informations" icone={Target} id="op-infos" className="lg:col-span-2">
          <fieldset disabled={!gerer} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <legend className="sr-only">Informations de l’opportunité</legend>
            <Champ id="ed-titre" label="Titre" requis erreur={champs['title']}>
              <input
                id="ed-titre"
                className={CHAMP}
                value={form.title}
                maxLength={200}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                {...aria('ed-titre', champs['title'])}
              />
            </Champ>
            <Champ id="ed-compte" label="Compte" requis erreur={champs['accountId']}>
              <ChoixCompte
                id="ed-compte"
                valeur={form.accountId}
                nomInitial={v.accountName}
                onChange={(accountId) => setForm({ ...form, accountId })}
              />
            </Champ>
            <Champ id="ed-responsable" label="Responsable">
              <ChoixMembre
                id="ed-responsable"
                valeur={form.ownerId}
                membres={membres}
                vide={v.ownerId ? nomMembre(membres, v.ownerId) : 'Choisir…'}
                onChange={(ownerId) => setForm({ ...form, ownerId })}
              />
            </Champ>
            <Champ id="ed-source" label="Montant estimé">
              <select
                id="ed-source"
                className={CHAMP}
                value={source}
                onChange={(e) => setSource(e.target.value as 'manual' | 'lines')}
              >
                <option value="manual">Saisi à la main</option>
                <option value="lines">Tiré des lignes (hors taxes, calculé par Lalanda)</option>
              </select>
            </Champ>
            {source === 'manual' ? (
              <Champ id="ed-montant" label="Montant" erreur={champs['amount']}>
                <input
                  id="ed-montant"
                  inputMode="decimal"
                  className={CHAMP}
                  value={form.montant}
                  onChange={(e) => setForm({ ...form, montant: e.target.value })}
                  {...aria('ed-montant', champs['amount'])}
                />
              </Champ>
            ) : (
              <div className="flex flex-col justify-end text-sm">
                <span className="font-medium">Montant calculé</span>
                <span className="font-mono">{montantEstime(v)}</span>
              </div>
            )}
            <Champ id="ed-devise" label="Devise">
              <select
                id="ed-devise"
                className={CHAMP}
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value as 'CDF' | 'USD' })}
              >
                <option value="CDF">CDF</option>
                <option value="USD">USD</option>
              </select>
            </Champ>
            <Champ id="ed-cloture" label="Clôture prévue">
              <input
                id="ed-cloture"
                type="date"
                className={CHAMP}
                value={form.expectedCloseDate}
                onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })}
              />
            </Champ>
          </fieldset>
        </Panneau>

        <Panneau
          titre={`Lignes d’articles (${lignes.length})`}
          icone={ListOrdered}
          id="op-lignes"
          className="lg:col-span-2"
        >
          <EditeurLignes
            lignes={lignes}
            setLignes={setLignes}
            erreurs={erreursLignes}
            desactive={!gerer}
          />
          <p className="text-xs text-[var(--foreground-muted)]">
            Prix unitaires hors taxes, dans la devise de l’opportunité. {MENTION_ESTIME}
          </p>
          {gerer ? (
            <button
              type="button"
              className={buttonClasses('primary', 'md', 'self-start')}
              onClick={enregistrer}
            >
              Enregistrer l’opportunité
            </button>
          ) : null}
        </Panneau>

        <Panneau
          titre="Devis"
          icone={FileText}
          id="op-devis"
          action={
            devis ? (
              <button
                type="button"
                className={buttonClasses('primary', 'sm')}
                onClick={() => void creerDevis()}
              >
                Créer un devis
              </button>
            ) : null
          }
        >
          {sansLignes ? (
            <Alerte
              action={
                <Link href={devisVierge} className={BOUTON_PETIT}>
                  Devis vierge
                </Link>
              }
            >
              <p>
                Cette opportunité n’a pas de ligne d’articles : ajoutez-en pour préremplir le devis,
                ou partez d’un devis vierge.
              </p>
            </Alerte>
          ) : null}
          <ul className="flex flex-col gap-1 text-sm">
            {v.quotes.map((q) => (
              <li key={q.id} className="break-words">
                <Link
                  href={`${DEVIS_BASE}/${encodeURIComponent(q.id)}`}
                  className="font-mono underline"
                >
                  {q.number}
                </Link>{' '}
                v{q.version} — {QUOTE_STATUS_LABELS[q.status]}
                {q.total ? ` — ${formatMontant(q.total, q.currency)}` : ''}
              </li>
            ))}
            {v.quotes.length === 0 ? <li>Aucun devis.</li> : null}
          </ul>
          {!devis ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Préparer un devis est réservé aux rôles qui préparent les devis.
            </p>
          ) : null}
        </Panneau>

        <Panneau titre="Activités" icone={CalendarClock} id="op-activites">
          <ul className="flex flex-col gap-2 text-sm">
            {activites.map((a) => {
              const ton = tonActivite(a, aujourdhui);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  {gerer && a.kind !== 'note' ? (
                    <input
                      type="checkbox"
                      checked={a.done}
                      aria-label={`${a.done ? 'Rouvrir' : 'Marquer faite'} : ${a.subject}`}
                      onChange={() =>
                        void agir(() =>
                          a.done
                            ? crmApi.reopenActivity(a.id, a.revision)
                            : crmApi.completeActivity(a.id, a.revision),
                        )
                      }
                    />
                  ) : null}
                  <span
                    className={`min-w-0 break-words ${ton === 'retard' ? 'font-medium text-[var(--danger)]' : ''} ${a.done ? 'line-through opacity-70' : ''}`}
                  >
                    {a.kindLabel} — {a.subject} · {libelleEcheance(a, aujourdhui)}
                  </span>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {a.assigneeUserId ? `Assignée à ${nomMembre(membres, a.assigneeUserId)}` : ''}
                  </span>
                </li>
              );
            })}
            {activites.length === 0 ? <li>Aucune activité.</li> : null}
          </ul>
          {gerer ? (
            <form
              className="grid gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] p-3 sm:grid-cols-2"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                const p = preparerActivite(f, v.id);
                if (!p.ok) {
                  setChampsAct(p.champs);
                  return;
                }
                setChampsAct({});
                void agir(async () => {
                  await crmApi.createActivity(p.corps);
                  setF({ ...f, subject: '', notes: '', echeance: '' });
                });
              }}
            >
              <Champ id="act-kind" label="Nature">
                <select
                  id="act-kind"
                  className={CHAMP}
                  value={f.kind}
                  onChange={(e) =>
                    setF({ ...f, kind: e.target.value as FormulaireActivite['kind'] })
                  }
                >
                  {ACTIVITY_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {ACTIVITY_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Champ>
              <Champ id="act-objet" label="Objet" requis erreur={champsAct['subject']}>
                <input
                  id="act-objet"
                  className={CHAMP}
                  value={f.subject}
                  maxLength={200}
                  onChange={(e) => setF({ ...f, subject: e.target.value })}
                />
              </Champ>
              {f.kind !== 'note' ? (
                <>
                  <Champ id="act-echeance" label="Échéance" erreur={champsAct['dueAt']}>
                    <input
                      id="act-echeance"
                      type="date"
                      className={CHAMP}
                      value={f.echeance}
                      onChange={(e) => setF({ ...f, echeance: e.target.value })}
                    />
                  </Champ>
                  <Champ id="act-assigne" label="Assignée à">
                    <ChoixMembre
                      id="act-assigne"
                      valeur={f.assigneeUserId ?? ''}
                      membres={membres}
                      onChange={(assigneeUserId) => setF({ ...f, assigneeUserId })}
                    />
                  </Champ>
                </>
              ) : null}
              <button type="submit" className={`${BOUTON} sm:col-span-2 sm:justify-self-start`}>
                Ajouter l’activité
              </button>
            </form>
          ) : null}
        </Panneau>

        <Panneau
          titre="Historique des étapes"
          icone={History}
          id="op-historique"
          className="lg:col-span-2"
        >
          <ol className="flex flex-col gap-1 text-sm">
            {v.stageHistory.map((e, i) => (
              <li key={`${e.stageKey}-${i}`}>
                {new Date(e.at).toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa' })} —{' '}
                {e.stageLabel}
                {e.source === 'quote'
                  ? ' (devis accepté)'
                  : e.source === 'import'
                    ? ' (import)'
                    : ''}
              </li>
            ))}
          </ol>
        </Panneau>
      </div>
      <BoiteMotifPerte demande={motif} settings={settings} />
    </section>
  );
}
