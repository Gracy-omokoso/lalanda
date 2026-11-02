'use client';

// Fiche d'un contrat — ADR-0050 § 9, lot V7 : statut dérivé, conditions en vigueur et
// dates (moteur), historique (versions, approbations, signature, reconductions),
// échéancier, acomptes, avenants, copies, projet lié. Bandeau constant : les clauses sont
// celles saisies ; Lalanda calcule des dates sans juger leur validité juridique.
//
// Les brouillons préparés renvoient vers la facture brouillon : aucune émission ici.

import { SALES_CONTRACT_SETTINGS_DEFAULTS } from '@lalanda/shared/sales-contracts';
import { Modal, buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useState } from 'react';

import { salesContractsApi, type SalesContractView } from '@/lib/api-sales-contracts';

import { useProfil } from '../../../_components/profile-context';
import {
  Alerte,
  BOUTON,
  BOUTON_DANGER,
  BOUTON_PETIT,
  CHAMP,
  Champ,
  Pastille,
  aria,
} from '../../_components/form-ui';
import { formatMontant } from '../../_components/sales-model';
import { useAccesVentes } from '../../_components/sales-access';
import { formatJour } from '../../devis/_components/quote-model';
import { formatQuantite } from '../../factures/_components/invoice-model';

import { SectionAvenants } from './amendments-section';
import { FenetreContrat } from './contract-form';
import {
  CONTRATS_BASE,
  FACTURATION_LABELS,
  FREQUENCE_LABELS,
  MOMENT_LABELS,
  ORIGINE_TERME_LABELS,
  PARTIE_LABELS,
  approbation,
  aujourdhuiKinshasa,
  libelleDuree,
  libelleReconduction,
  libelleStatutContrat,
  messageEngagement,
  peutApprouverContrat,
  peutPreparerBrouillon,
  peutPreparerEngagement,
  phrasesAvertissements,
  preparerResiliation,
  tonContrat,
} from './contract-model';
import { FenetreConfirmation, FenetreMotif, ListePieces, SectionAcomptes } from './engagement-ui';
import { SectionEcheancier } from './schedule-section';
import { FenetreSignature } from './signature-form';

type Fenetre =
  | null
  | 'modifier'
  | 'soumettre'
  | 'version'
  | 'annuler'
  | 'supprimer'
  | 'approuver'
  | 'rejeter'
  | 'signer'
  | 'resilier'
  | 'reconduire';

function Section({
  titre,
  children,
  className = '',
}: {
  titre: string;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <section
      className={`flex flex-col gap-3 rounded-xl border border-[var(--border)] p-4 ${className}`}
    >
      <h3 className="text-sm font-semibold">{titre}</h3>
      {children}
    </section>
  );
}

function jour(d: string | null | undefined): string {
  return d ? formatJour(d.slice(0, 10)) : '—';
}

export function ContractDetail({ contractId }: { contractId: string }): React.ReactElement {
  const router = useRouter();
  const { actions } = useAccesVentes();
  const { profil } = useProfil();
  const moi = profil?.id ?? null;
  const preparer = peutPreparerEngagement(actions);
  const brouillon = peutPreparerBrouillon(actions);
  const [vue, setVue] = useState<SalesContractView | null>(null);
  const [uniqueAdmis, setUniqueAdmis] = useState(
    SALES_CONTRACT_SETTINGS_DEFAULTS.allowSoleApprover,
  );
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string[]>([]);
  const [fenetre, setFenetre] = useState<Fenetre>(null);

  const charger = useCallback(() => {
    salesContractsApi
      .getContract(contractId)
      .then((v) => {
        setVue(v);
        setErreur(null);
      })
      .catch((err) => setErreur(messageEngagement(err, 'Contrat illisible.')));
  }, [contractId]);

  useEffect(() => charger(), [charger]);
  useEffect(() => {
    salesContractsApi
      .getSettings()
      .then((s) => setUniqueAdmis(s.allowSoleApprover))
      .catch(() => undefined);
  }, []);

  if (vue === null) {
    return erreur ? (
      <Alerte>
        <p>{erreur}</p>
      </Alerte>
    ) : (
      <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
        Chargement du contrat…
      </p>
    );
  }

  const a = vue.actions;
  const t = vue.terms;
  const appro = approbation({
    actions,
    etatPermet: a.approve,
    moi,
    soumisPar: vue.submittedBy,
    approbateurUniqueAdmis: uniqueAdmis,
  });
  const totaux = vue.documentAmounts.calculation.totals;
  const signeOuResilie = vue.status === 'signed' || vue.status === 'terminated';
  const lignesEnVigueur = t?.inForce.lines ?? vue.lines;

  return (
    <section className="flex w-full flex-col gap-5">
      <header className="flex flex-col gap-2">
        <Link href={CONTRATS_BASE} className="text-sm underline underline-offset-2">
          ← Tous les contrats
        </Link>
        <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
          <span className="font-mono">{vue.number}</span>
          <span className="text-sm text-[var(--foreground-muted)]">version {vue.version}</span>
          <Pastille ton={tonContrat(vue.status, vue.derivedStatus)}>
            {libelleStatutContrat(vue)}
          </Pastille>
          <Pastille ton="neutre">{FACTURATION_LABELS[vue.billingKind]}</Pastille>
        </h2>
        <p className="text-base font-medium">{vue.title}</p>
        <p className="text-sm">
          {vue.customerName ?? 'Client'} · début le {formatJour(vue.startDate)} ·{' '}
          {libelleDuree(vue.initialTermMonths)} · préavis {vue.noticeDays} jours
        </p>
        <p className="flex flex-wrap gap-x-4 text-sm">
          {vue.source ? (
            <Link
              href={`/ventes/devis/${encodeURIComponent(vue.source.quoteId)}`}
              className="underline underline-offset-2"
            >
              Devis d’origine (version {vue.source.quoteVersion})
            </Link>
          ) : null}
          {vue.projectId ? (
            <Link
              href={`/projets/${encodeURIComponent(vue.projectId)}`}
              className="underline underline-offset-2"
            >
              Projet lié
            </Link>
          ) : null}
        </p>
      </header>

      <p role="note" className="rounded-md border border-[var(--warn)]/50 p-3 text-sm">
        {vue.banner}
      </p>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {info.length > 0 ? (
        <ul role="status" className="list-disc pl-5 text-sm">
          {info.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      {vue.warnings.length > 0 ? (
        <ul className="list-disc rounded-md border border-[var(--warn)]/50 p-3 pl-8 text-sm">
          {phrasesAvertissements(vue.warnings).map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {preparer && a.edit ? (
          <button type="button" className={BOUTON_PETIT} onClick={() => setFenetre('modifier')}>
            Modifier le brouillon
          </button>
        ) : null}
        {preparer && a.submit ? (
          <button
            type="button"
            className={buttonClasses('primary', 'md')}
            disabled={vue.blockers.length > 0}
            onClick={() => setFenetre('soumettre')}
          >
            Soumettre à approbation
          </button>
        ) : null}
        {appro.visible ? (
          <>
            <button
              type="button"
              className={buttonClasses('primary', 'md')}
              onClick={() => setFenetre('approuver')}
            >
              Approuver
            </button>
            <button type="button" className={BOUTON_PETIT} onClick={() => setFenetre('rejeter')}>
              Rejeter
            </button>
          </>
        ) : null}
        {preparer && a.declareSignature ? (
          <button
            type="button"
            className={buttonClasses('primary', 'md')}
            onClick={() => setFenetre('signer')}
          >
            Déclarer la signature
          </button>
        ) : null}
        {peutApprouverContrat(actions) && a.recordRenewal && t?.proposedNextTerm ? (
          <button
            type="button"
            className={buttonClasses('primary', 'md')}
            onClick={() => setFenetre('reconduire')}
          >
            Constater la reconduction
          </button>
        ) : null}
        {preparer && a.newVersion ? (
          <button type="button" className={BOUTON_PETIT} onClick={() => setFenetre('version')}>
            Nouvelle version
          </button>
        ) : null}
        {peutApprouverContrat(actions) && a.terminate ? (
          <button type="button" className={BOUTON_DANGER} onClick={() => setFenetre('resilier')}>
            Résilier
          </button>
        ) : null}
        {preparer && a.cancel ? (
          <button type="button" className={BOUTON_DANGER} onClick={() => setFenetre('annuler')}>
            Annuler le contrat
          </button>
        ) : null}
        {preparer && a.delete ? (
          <button type="button" className={BOUTON_DANGER} onClick={() => setFenetre('supprimer')}>
            Supprimer le brouillon
          </button>
        ) : null}
      </div>
      {appro.note ? (
        <p className="rounded-md border border-[var(--border)] p-3 text-sm">{appro.note}</p>
      ) : null}

      {vue.blockers.length > 0 ? (
        <div className="rounded-md border border-[var(--border)] p-3 text-sm">
          <p className="font-medium">Avant de le soumettre :</p>
          <ul className="mt-1 list-disc pl-5">
            {vue.blockers.map((b, i) => (
              <li key={`${b.code}-${i}`}>{b.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <Section titre={t ? `Conditions en vigueur au ${formatJour(t.on)}` : 'Clauses saisies'}>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[14rem_1fr]">
            <dt className="text-[var(--foreground-muted)]">Durée du premier terme</dt>
            <dd>{libelleDuree(t?.inForce.initialTermMonths ?? vue.initialTermMonths)}</dd>
            <dt className="text-[var(--foreground-muted)]">Reconduction</dt>
            <dd>{libelleReconduction(t?.inForce.renewal ?? vue.renewal)}</dd>
            <dt className="text-[var(--foreground-muted)]">Préavis</dt>
            <dd>{t?.inForce.noticeDays ?? vue.noticeDays} jours</dd>
            <dt className="text-[var(--foreground-muted)]">Facturation</dt>
            <dd>
              {vue.billing.kind === 'recurring'
                ? `${FREQUENCE_LABELS[vue.billing.frequency]}, à partir du ${formatJour(vue.billing.anchorDate)} (${MOMENT_LABELS[vue.billing.timing].toLowerCase()})${vue.billing.autoPrepare ? '' : ', préparation à la main'}`
                : vue.billing.kind === 'schedule'
                  ? `${vue.billing.items.length} échéance(s) à dates fixes`
                  : 'Factures préparées à la main'}
            </dd>
            {t ? (
              <>
                <dt className="text-[var(--foreground-muted)]">Terme en cours</dt>
                <dd>
                  du {jour(t.currentTerm.from)} au{' '}
                  {t.currentTerm.to ? jour(t.currentTerm.to) : 'durée indéterminée'}
                  {t.termElapsed ? ' (échu)' : ''}
                </dd>
                <dt className="text-[var(--foreground-muted)]">Date limite de préavis</dt>
                <dd>{t.noticeDeadline ? jour(t.noticeDeadline) : '—'}</dd>
                <dt className="text-[var(--foreground-muted)]">Dernier jour facturable</dt>
                <dd>{t.billableUntil ? jour(t.billableUntil) : 'sans borne'}</dd>
                {t.proposedNextTerm ? (
                  <>
                    <dt className="text-[var(--foreground-muted)]">Reconduction à constater</dt>
                    <dd>
                      terme suivant du {jour(t.proposedNextTerm.from)} au{' '}
                      {t.proposedNextTerm.to ? jour(t.proposedNextTerm.to) : 'durée indéterminée'}
                    </dd>
                  </>
                ) : null}
                {t.inForce.pendingAmendments.length > 0 ? (
                  <>
                    <dt className="text-[var(--foreground-muted)]">Avenants sans effet</dt>
                    <dd>
                      n° {t.inForce.pendingAmendments.join(', ')} (non signés ou effet à venir)
                    </dd>
                  </>
                ) : null}
              </>
            ) : null}
          </dl>
          {t && t.conventions.length > 0 ? (
            <ul className="list-disc pl-5 text-xs text-[var(--foreground-muted)]">
              {t.conventions.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : null}
          {vue.clauses ? (
            <p className="whitespace-pre-line text-sm">{t?.inForce.clauses ?? vue.clauses}</p>
          ) : null}
          {vue.termination ? (
            <div className="rounded-md border border-[var(--border)] p-3 text-sm">
              <p className="font-medium">Résiliation enregistrée</p>
              <p>
                {PARTIE_LABELS[vue.termination.by]} a notifié le{' '}
                {jour(vue.termination.noticeGivenOn)}, effet le {jour(vue.termination.effectiveOn)}.{' '}
                {vue.termination.reason}
              </p>
              <p>
                {vue.termination.noticeCheckLabel} (comparaison à la clause que vous avez saisie).
              </p>
            </div>
          ) : null}
        </Section>

        <Section titre="Historique">
          <ul className="flex flex-col gap-1 text-sm">
            {vue.previousVersions.map((p) => (
              <li key={`v${p.version}`}>
                Version {p.version} archivée le {jour(p.archivedAt)}
                {p.total ? ` — ${formatMontant(p.total, vue.currency)}` : ''}
              </li>
            ))}
            {vue.submittedAt ? <li>Soumis le {jour(vue.submittedAt)}</li> : null}
            {vue.approvals.map((p, i) => (
              <li key={`a${i}`}>
                {p.decision === 'approved' ? 'Approuvé' : 'Rejeté'} le {jour(p.at)}
                {p.soleApprover ? ' (approbateur unique)' : ''}
                {p.comment ? ` — ${p.comment}` : ''}
              </li>
            ))}
            {vue.signature ? (
              <li>
                Signature déclarée le {jour(vue.signature.signedOn)} :{' '}
                {vue.signature.signatories
                  .map((s) => `${s.name}${s.title ? ` (${s.title})` : ''}`)
                  .join(', ')}
              </li>
            ) : null}
            {(t?.terms ?? []).map((term) => (
              <li key={`t${term.index}`}>
                {ORIGINE_TERME_LABELS[term.origin] ?? term.origin} : du {jour(term.from)} au{' '}
                {term.to ? jour(term.to) : 'durée indéterminée'}
              </li>
            ))}
            {vue.cancellation ? <li>Annulé : {vue.cancellation.reason}</li> : null}
          </ul>
        </Section>
      </div>

      <Section titre={t ? 'Lignes en vigueur' : 'Lignes'}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <caption className="sr-only">Lignes du contrat</caption>
            <thead>
              <tr className="text-left text-[var(--foreground-muted)]">
                <th scope="col">Désignation</th>
                <th scope="col">Groupe</th>
                <th scope="col" className="text-right">
                  Quantité
                </th>
                <th scope="col" className="text-right">
                  Prix unitaire
                </th>
              </tr>
            </thead>
            <tbody>
              {lignesEnVigueur.map((l) => (
                <tr key={l.lineRef} className="border-t border-[var(--border)]">
                  <td>{l.name}</td>
                  <td>[{l.taxGroup}]</td>
                  <td className="text-right font-mono">{formatQuantite(l.quantity)}</td>
                  <td className="text-right font-mono">
                    {formatMontant(l.unitPrice, vue.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totaux ? (
          <p className="self-end text-sm">
            Total indicatif du contrat{vue.billingKind === 'recurring' ? ' (par échéance)' : ''} :{' '}
            <span className="font-mono font-semibold">
              {formatMontant(totaux.total, vue.currency)}
            </span>
          </p>
        ) : null}
      </Section>

      {signeOuResilie && vue.billingKind !== 'none' ? (
        <Section titre="Échéancier">
          <SectionEcheancier contractId={vue.id} peutPreparer={brouillon} />
        </Section>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        {signeOuResilie ? (
          <Section titre="Acomptes et factures finales">
            <SectionAcomptes
              proprietaire="contracts"
              id={vue.id}
              peutPreparer={brouillon}
              ouvert={vue.status === 'signed'}
              devise={vue.currency}
              onChange={charger}
            />
          </Section>
        ) : null}
        {signeOuResilie ? (
          <Section titre="Avenants">
            <SectionAvenants
              contrat={vue}
              actions={actions}
              moi={moi}
              approbateurUniqueAdmis={uniqueAdmis}
              onChange={charger}
            />
          </Section>
        ) : null}
        <Section titre="Copies du contrat">
          <ListePieces
            pieces={vue.files.filter((f) => f.amendmentId === null)}
            lire={(p) => () => salesContractsApi.readContractFile(vue.id, p.id, p.fileName)}
            televerser={
              preparer && a.addFile
                ? (f) => salesContractsApi.addContractFile(vue.id, f, 'draft_copy')
                : null
            }
            libelleAjout="Copie de travail"
            onAjoutee={charger}
          />
        </Section>
      </div>

      {fenetre === 'modifier' ? (
        <FenetreContrat
          vue={vue}
          onFermer={() => setFenetre(null)}
          onEnregistre={(v) => {
            setVue(v);
            setFenetre(null);
          }}
        />
      ) : null}
      {fenetre === 'soumettre' ? (
        <FenetreConfirmation
          titre="Soumettre le contrat à approbation"
          bouton="Soumettre"
          onFermer={() => setFenetre(null)}
          onConfirmer={async () => {
            setVue(await salesContractsApi.contractAction(vue.id, 'submit', vue.revision));
            setFenetre(null);
          }}
        >
          <p>
            Une personne habilitée à approuver les contrats le validera. Le contenu ne se modifie
            plus ensuite, sauf par une nouvelle version.
          </p>
        </FenetreConfirmation>
      ) : null}
      {fenetre === 'version' ? (
        <FenetreConfirmation
          titre="Créer une nouvelle version"
          bouton="Nouvelle version"
          onFermer={() => setFenetre(null)}
          onConfirmer={async () => {
            setVue(await salesContractsApi.contractAction(vue.id, 'new-version', vue.revision));
            setFenetre(null);
          }}
        >
          <p>La version {vue.version} est archivée ; la nouvelle repart en brouillon.</p>
        </FenetreConfirmation>
      ) : null}
      {fenetre === 'reconduire' && t?.proposedNextTerm ? (
        <FenetreConfirmation
          titre="Constater la reconduction tacite"
          bouton="Constater la reconduction"
          onFermer={() => setFenetre(null)}
          onConfirmer={async () => {
            setVue(await salesContractsApi.contractAction(vue.id, 'renewals', vue.revision));
            setFenetre(null);
            setInfo([
              'Reconduction constatée : les échéances du nouveau terme peuvent être préparées.',
            ]);
          }}
        >
          <p>
            Vous constatez que le contrat se poursuit pour le terme du{' '}
            {jour(t.proposedNextTerm.from)} au{' '}
            {t.proposedNextTerm.to ? jour(t.proposedNextTerm.to) : 'durée indéterminée'}, selon la
            clause de reconduction que vous avez saisie.
          </p>
          <p className="text-[var(--foreground-muted)]">
            Lalanda ne prolonge jamais un contrat seul : sans ce geste, aucun brouillon n’est
            préparé au-delà du terme. La validité d’une reconduction tacite relève de votre conseil
            juridique.
          </p>
        </FenetreConfirmation>
      ) : null}
      {fenetre === 'annuler' ? (
        <FenetreMotif
          titre="Annuler le contrat"
          bouton="Annuler le contrat"
          danger
          onFermer={() => setFenetre(null)}
          onConfirmer={async (motif) => {
            setVue(await salesContractsApi.cancelContract(vue.id, vue.revision, motif));
            setFenetre(null);
          }}
        />
      ) : null}
      {fenetre === 'supprimer' ? (
        <FenetreConfirmation
          titre="Supprimer le brouillon de contrat"
          bouton="Supprimer"
          onFermer={() => setFenetre(null)}
          onConfirmer={async () => {
            await salesContractsApi.deleteContract(vue.id);
            router.push(CONTRATS_BASE);
          }}
        >
          <p>Le brouillon {vue.number} sera supprimé. Son numéro ne sera pas réattribué.</p>
        </FenetreConfirmation>
      ) : null}
      {fenetre === 'approuver' ? (
        <FenetreMotif
          titre={`Approuver le contrat ${vue.number}`}
          description="Validation interne avant la signature (ce n’est pas la signature)."
          libelle="Commentaire (facultatif)"
          bouton="Approuver"
          facultatif
          onFermer={() => setFenetre(null)}
          onConfirmer={async (commentaire) => {
            setVue(
              await salesContractsApi.approveContract(vue.id, vue.revision, commentaire || null),
            );
            setFenetre(null);
          }}
        />
      ) : null}
      {fenetre === 'rejeter' ? (
        <FenetreMotif
          titre={`Rejeter le contrat ${vue.number}`}
          description="Le contrat repart en brouillon, avec votre commentaire."
          libelle="Commentaire"
          bouton="Rejeter"
          danger
          onFermer={() => setFenetre(null)}
          onConfirmer={async (commentaire) => {
            setVue(await salesContractsApi.rejectContract(vue.id, vue.revision, commentaire));
            setFenetre(null);
          }}
        />
      ) : null}
      {fenetre === 'signer' ? (
        <FenetreSignature
          titre={`Déclarer la signature — ${vue.number}`}
          contractId={vue.id}
          amendmentId={null}
          expectedRevision={vue.revision}
          copiesExistantes={vue.files.filter(
            (f) => f.kind === 'signed_copy' && f.amendmentId === null,
          )}
          declarer={async (corps) => {
            setVue(await salesContractsApi.declareContractSignature(vue.id, corps));
          }}
          onFermer={() => setFenetre(null)}
          onFait={() => setFenetre(null)}
        />
      ) : null}
      {fenetre === 'resilier' ? (
        <FenetreResiliation
          vue={vue}
          onFermer={() => setFenetre(null)}
          onFait={(v, messages) => {
            setVue(v);
            setInfo(messages);
            setFenetre(null);
          }}
        />
      ) : null}
    </section>
  );
}

function FenetreResiliation({
  vue,
  onFermer,
  onFait,
}: {
  vue: SalesContractView;
  onFermer: () => void;
  onFait: (v: SalesContractView, messages: string[]) => void;
}): React.ReactElement {
  const id = useId();
  const [notifieeLe, setNotifieeLe] = useState(aujourdhuiKinshasa());
  const [par, setPar] = useState<'customer' | 'organization'>('customer');
  const [effetLe, setEffetLe] = useState(vue.terms?.lastTermEnd ?? '');
  const [motif, setMotif] = useState('');
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function confirmer(): Promise<void> {
    const prep = preparerResiliation({
      expectedRevision: vue.revision,
      notifieeLe,
      par,
      effetLe,
      motif,
    });
    if (!prep.ok) {
      setChamps(prep.champs);
      return;
    }
    setChamps({});
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await salesContractsApi.terminateContract(vue.id, prep.corps);
      const messages = phrasesAvertissements(r.warnings);
      if (r.contract.termination) {
        messages.unshift(
          `Résiliation enregistrée. ${r.contract.termination.noticeCheckLabel} : Lalanda compare seulement à la clause saisie, il ne juge pas la résiliation.`,
        );
      }
      onFait(r.contract, messages);
    } catch (err) {
      setErreur(messageEngagement(err, 'La résiliation n’a pas pu être enregistrée.'));
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFermer}
      title={`Résilier le contrat ${vue.number}`}
      description={`Préavis saisi au contrat : ${vue.terms?.inForce.noticeDays ?? vue.noticeDays} jours. Lalanda affiche la comparaison avec cette clause, sans jamais refuser la résiliation. Aucune échéance n’est préparée après la date d’effet.`}
      busy={envoi}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={BOUTON} onClick={onFermer} disabled={envoi}>
            Retour
          </button>
          <button
            type="button"
            className={buttonClasses('danger', 'md')}
            disabled={envoi}
            onClick={() => void confirmer()}
          >
            Enregistrer la résiliation
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <Champ id={`${id}-par`} label="Qui résilie ?">
          <select
            id={`${id}-par`}
            value={par}
            onChange={(e) => setPar(e.target.value as 'customer' | 'organization')}
            className={CHAMP}
          >
            <option value="customer">{PARTIE_LABELS.customer}</option>
            <option value="organization">{PARTIE_LABELS.organization}</option>
          </select>
        </Champ>
        <Champ id={`${id}-notif`} label="Notifiée le" requis erreur={champs['noticeGivenOn']}>
          <input
            id={`${id}-notif`}
            type="date"
            value={notifieeLe}
            onChange={(e) => setNotifieeLe(e.target.value)}
            className={CHAMP}
            {...aria(`${id}-notif`, champs['noticeGivenOn'])}
          />
        </Champ>
        <Champ id={`${id}-effet`} label="Prend effet le" requis erreur={champs['effectiveOn']}>
          <input
            id={`${id}-effet`}
            type="date"
            value={effetLe}
            onChange={(e) => setEffetLe(e.target.value)}
            className={CHAMP}
            {...aria(`${id}-effet`, champs['effectiveOn'])}
          />
        </Champ>
        <Champ id={`${id}-motif`} label="Motif" requis erreur={champs['reason']}>
          <textarea
            id={`${id}-motif`}
            value={motif}
            rows={3}
            maxLength={500}
            onChange={(e) => setMotif(e.target.value)}
            className={CHAMP}
            {...aria(`${id}-motif`, champs['reason'])}
          />
        </Champ>
      </div>
    </Modal>
  );
}
