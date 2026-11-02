'use client';

// Module « Abonnements et paiements » de la console (ADR-0053 § 6.2 — lot P3).
//
// Trois volets, chacun affiché selon l'action plateforme détenue (l'API impose de toute
// façon) : la FILE des dépôts manuels (confirmer, refuser), les OCTROIS sans paiement
// (préparer, approuver en seconde personne, retirer), le TABLEAU des abonnements
// (métadonnées seulement). Toute décision passe par la fenêtre de ré-authentification et
// porte un motif ; ce que voit le client paraît sous « Équipe Lalanda ».
//
// Ce module n'encaisse rien. Depuis ADR-0047 (3 nov. 2026), chaque paiement confirmé
// produit une facture émise par l'organisation vendeuse : volet « Factures des
// abonnements » (`factures-abonnements-panel.tsx`).

import { useCallback, useEffect, useState } from 'react';

import {
  api,
  type AdminManualPaymentStatus,
  type AdminManualPaymentView,
  type AdminPlanGrantView,
  type AdminSubscriptionStatus,
  type AdminSubscriptionView,
  type Plan,
} from '@/lib/api';

import {
  echeanceDepuisSaisie,
  formaterMontant,
  identifiantOrganisationValide,
  libelleMoyen,
  libelleStatutAbonnement,
  libelleStatutPaiement,
  messageErreurAbonnements,
  octroiDemandeSecondePersonne,
  offresOctroyables,
  phaseOctroi,
  resultatOctroi,
  STATUTS_ABONNEMENT,
  STATUTS_PAIEMENT,
  tonStatutAbonnement,
  tonStatutPaiement,
} from './abonnements-model';
import { useAccesPlateforme } from './admin-access';
import { Bandeau, Pastille, Vide } from './admin-chrome';
import { exigeReauth, formaterDate, formaterDateHeure, LIBELLES_PLAN } from './admin-model';
import { ChampsMotif } from './champs-motif';
import { FacturesAbonnements } from './factures-abonnements-panel';
import { MOTIF_VIDE, motifComplet, noteInterneValide, type MotifSaisi } from './motif-model';
import { ReauthGate, useReauth } from './reauth-gate';

const REAUTH_ABONNEMENTS =
  'Confirmer ou refuser un dépôt, accorder ou retirer une offre exige une ré-authentification, valable dix minutes. Chaque geste est motivé, inscrit au journal plateforme avec votre rôle réel, et paraît au journal du client sous « Équipe Lalanda ».';

const ETIQUETTE =
  'font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]';
const CHAMP = 'rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';
const BOUTON =
  'rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-40';

type Retour = { ton: 'succes' | 'echec'; texte: string } | null;

export function AbonnementsPanel(): React.ReactElement {
  const acces = useAccesPlateforme();
  const peutDecider = acces.actions.includes('platform.billing.confirm');
  const peutOctroyer = acces.actions.includes('platform.billing.grant');
  const reauth = useReauth();

  return (
    <div className="flex flex-col gap-8">
      {peutDecider || peutOctroyer ? (
        <ReauthGate reauth={reauth} description={REAUTH_ABONNEMENTS}>
          {null}
        </ReauthGate>
      ) : null}
      <FilePaiements
        peutDecider={peutDecider}
        fenetreOuverte={reauth.ouverte}
        onReauth={reauth.redemander}
      />
      <Octrois
        peutOctroyer={peutOctroyer}
        fenetreOuverte={reauth.ouverte}
        onReauth={reauth.redemander}
      />
      <TableauAbonnements />
      {/* ADR-0047 : factures des abonnements (vendeur, paiements sans facture, avoirs). */}
      <FacturesAbonnements
        peutEmettre={peutDecider}
        peutDesigner={peutOctroyer}
        onReauth={reauth.redemander}
      />
    </div>
  );
}

function Titre({ children, aide }: { children: string; aide: string }): React.ReactElement {
  return (
    <header className="flex flex-col gap-1">
      <h2 className="font-display text-lg font-bold tracking-tight">{children}</h2>
      <p className="max-w-3xl text-sm text-[var(--foreground-muted)]">{aide}</p>
    </header>
  );
}

// ── File des paiements manuels ───────────────────────────────────────────────

function FilePaiements({
  peutDecider,
  fenetreOuverte,
  onReauth,
}: {
  peutDecider: boolean;
  fenetreOuverte: boolean;
  onReauth: () => void;
}): React.ReactElement {
  const [statut, setStatut] = useState<AdminManualPaymentStatus | ''>('pending');
  const [lignes, setLignes] = useState<AdminManualPaymentView[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState<string | null>(null);

  const charger = useCallback(async (s: AdminManualPaymentStatus | ''): Promise<void> => {
    try {
      const { requests } = await api.listAdminManualPayments(s || undefined);
      setLignes(requests);
      setErreur(null);
    } catch (err) {
      setErreur(messageErreurAbonnements(err, 'Impossible de charger la file des paiements.'));
    }
  }, []);

  useEffect(() => {
    void charger(statut);
  }, [charger, statut]);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="file-paiements">
      <Titre aide="Demandes de dépôt mobile money ou de virement ouvertes par les clients. Confirmez un dépôt après l’avoir constaté sur le relevé ; refusez-le s’il n’est jamais arrivé. Aucun encaissement n’est fait ici.">
        File des paiements manuels
      </Titre>
      <label className="flex flex-col gap-1 text-sm">
        <span className={ETIQUETTE}>État</span>
        <select
          value={statut}
          onChange={(e) => setStatut(e.target.value as AdminManualPaymentStatus | '')}
          className={`${CHAMP} w-56`}
        >
          <option value="">Tous</option>
          {STATUTS_PAIEMENT.map((s) => (
            <option key={s.valeur} value={s.valeur}>
              {s.libelle}
            </option>
          ))}
        </select>
      </label>
      {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}
      {lignes === null ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : lignes.length === 0 ? (
        <Vide>Aucune demande dans cet état.</Vide>
      ) : (
        <ul className="flex flex-col gap-2">
          {lignes.map((l) => (
            <li
              key={l.reference}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)]"
            >
              <button
                type="button"
                onClick={() => setOuverte((r) => (r === l.reference ? null : l.reference))}
                aria-expanded={ouverte === l.reference}
                className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="flex flex-col">
                  <span className="font-mono text-sm font-medium">{l.reference}</span>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {l.organizationName ?? l.organizationId} ·{' '}
                    {LIBELLES_PLAN[l.plan as Plan] ?? l.plan} (
                    {l.interval === 'year' ? 'annuel' : 'mensuel'}) · {libelleMoyen(l.method)}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">
                    {formaterMontant(l.amountDueCents, l.currency)}
                  </span>
                  <Pastille ton={tonStatutPaiement(l.status)}>
                    {libelleStatutPaiement(l.status)}
                  </Pastille>
                  <span className="font-mono text-xs text-[var(--foreground-muted)]">
                    expire le {formaterDate(l.expiresAt)}
                  </span>
                </span>
              </button>
              {ouverte === l.reference ? (
                <div className="border-t border-[var(--border)] px-4 py-4">
                  {l.status !== 'pending' ? (
                    <p className="text-sm text-[var(--foreground-muted)]">
                      Décidée le {formaterDateHeure(l.decidedAt)}.
                    </p>
                  ) : peutDecider && !fenetreOuverte ? (
                    <Bandeau ton="neutre">
                      Confirmez votre mot de passe en haut de page pour décider de ce dépôt.
                    </Bandeau>
                  ) : peutDecider ? (
                    <DecisionPaiement
                      ligne={l}
                      onReauth={onReauth}
                      onFait={() => {
                        setOuverte(null);
                        void charger(statut);
                      }}
                    />
                  ) : (
                    <Bandeau ton="neutre">
                      Confirmer ou refuser un dépôt demande l’action « Confirmer ou refuser un
                      paiement manuel » (finance, super-administrateur) et une fenêtre de
                      ré-authentification ouverte.
                    </Bandeau>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DecisionPaiement({
  ligne,
  onFait,
  onReauth,
}: {
  ligne: AdminManualPaymentView;
  onFait: () => void;
  onReauth: () => void;
}): React.ReactElement {
  const [note, setNote] = useState('');
  const [messageClient, setMessageClient] = useState('');
  const [retour, setRetour] = useState<Retour>(null);
  const [envoi, setEnvoi] = useState(false);

  async function decider(sens: 'confirmer' | 'refuser'): Promise<void> {
    setEnvoi(true);
    setRetour(null);
    const clientMessage = messageClient.trim() || undefined;
    try {
      if (sens === 'confirmer') {
        await api.confirmAdminManualPayment(ligne.reference, { note: note.trim(), clientMessage });
      } else {
        await api.rejectAdminManualPayment(ligne.reference, { reason: note.trim(), clientMessage });
      }
      onFait();
    } catch (err) {
      setRetour({ ton: 'echec', texte: messageErreurAbonnements(err, 'La décision a échoué.') });
      if (exigeReauth(err)) onReauth();
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className={ETIQUETTE}>
          Note interne — référence de l’opération reçue, ou motif du refus (10 caractères minimum)
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
          className={`${CHAMP} max-w-xl`}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className={ETIQUETTE}>Message destiné au client (facultatif)</span>
        <textarea
          value={messageClient}
          onChange={(e) => setMessageClient(e.target.value)}
          rows={2}
          maxLength={500}
          className={`${CHAMP} max-w-xl`}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={envoi || !noteInterneValide(note)}
          onClick={() => void decider('confirmer')}
          className={BOUTON}
        >
          Confirmer le dépôt
        </button>
        <button
          type="button"
          disabled={envoi || !noteInterneValide(note)}
          onClick={() => void decider('refuser')}
          className={BOUTON}
        >
          Refuser
        </button>
      </div>
      {retour ? <Bandeau ton={retour.ton}>{retour.texte}</Bandeau> : null}
    </div>
  );
}

// ── Octrois manuels ──────────────────────────────────────────────────────────

function Octrois({
  peutOctroyer: aLeDroit,
  fenetreOuverte,
  onReauth,
}: {
  peutOctroyer: boolean;
  fenetreOuverte: boolean;
  onReauth: () => void;
}): React.ReactElement {
  const peutOctroyer = aLeDroit && fenetreOuverte;
  const [octrois, setOctrois] = useState<AdminPlanGrantView[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [retour, setRetour] = useState<Retour>(null);

  const charger = useCallback(async (): Promise<void> => {
    try {
      setOctrois((await api.listAdminPlanGrants()).grants);
      setErreur(null);
    } catch (err) {
      setErreur(messageErreurAbonnements(err, 'Impossible de charger les octrois.'));
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  const echec = (err: unknown, repli: string): void => {
    setRetour({ ton: 'echec', texte: messageErreurAbonnements(err, repli) });
    if (exigeReauth(err)) onReauth();
  };

  return (
    <section className="flex flex-col gap-4">
      <Titre aide="Une offre accordée sans paiement (offre Expert, geste commercial, correction). Elle se superpose à l’abonnement du client le temps de sa validité, sans simuler aucun paiement. L’offre Expert, un octroi sans échéance ou de plus de 90 jours attend l’approbation d’une seconde personne.">
        Octrois sans paiement
      </Titre>
      {aLeDroit && !fenetreOuverte ? (
        <Bandeau ton="neutre">
          Confirmez votre mot de passe en haut de page pour préparer, approuver ou retirer un
          octroi.
        </Bandeau>
      ) : null}
      {peutOctroyer ? (
        <NouvelOctroi
          onCree={(o) => {
            setRetour({ ton: 'succes', texte: resultatOctroi(o.phase, o.soleApprover) });
            void charger();
          }}
          onEchec={(err) => echec(err, 'L’octroi n’a pas pu être préparé.')}
        />
      ) : null}
      {retour ? <Bandeau ton={retour.ton}>{retour.texte}</Bandeau> : null}
      {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}
      {octrois === null ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : octrois.length === 0 ? (
        <Vide>Aucun octroi.</Vide>
      ) : (
        <ul className="flex flex-col gap-2">
          {octrois.map((o) => (
            <LigneOctroi
              key={o.id}
              octroi={o}
              peutOctroyer={peutOctroyer}
              onMaj={(texte) => {
                setRetour({ ton: 'succes', texte });
                void charger();
              }}
              onEchec={(err) => echec(err, 'Le geste a échoué.')}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function NouvelOctroi({
  onCree,
  onEchec,
}: {
  onCree: (o: AdminPlanGrantView) => void;
  onEchec: (err: unknown) => void;
}): React.ReactElement {
  const offres = offresOctroyables(Object.keys(LIBELLES_PLAN) as Plan[]);
  const [organisation, setOrganisation] = useState('');
  const [plan, setPlan] = useState<Plan>(offres[0] ?? 'pro');
  const [echeance, setEcheance] = useState('');
  const [motif, setMotif] = useState<MotifSaisi>(MOTIF_VIDE);
  const [envoi, setEnvoi] = useState(false);

  const fin = echeanceDepuisSaisie(echeance);
  const secondePersonne = octroiDemandeSecondePersonne(plan, fin, new Date());
  const pret =
    identifiantOrganisationValide(organisation) &&
    (echeance === '' || fin !== null) &&
    motifComplet(motif, { avecCategorie: true, avecMessageClient: true });

  async function soumettre(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (motif.reasonCategory === '') return;
    setEnvoi(true);
    try {
      const cree = await api.createAdminPlanGrant({
        targetOrganizationId: organisation.trim(),
        plan,
        reasonCategory: motif.reasonCategory,
        clientMessage: motif.clientMessage.trim(),
        internalNote: motif.internalNote.trim(),
        ...(fin ? { endsAt: fin } : {}),
      });
      setOrganisation('');
      setEcheance('');
      setMotif(MOTIF_VIDE);
      onCree(cree);
    } catch (err) {
      onEchec(err);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
      onSubmit={(e) => void soumettre(e)}
    >
      <h3 className={ETIQUETTE}>Préparer un octroi</h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className={ETIQUETTE}>Identifiant de l’organisation</span>
          <input
            value={organisation}
            onChange={(e) => setOrganisation(e.target.value)}
            placeholder="24 caractères, depuis le module Organisations"
            className={`${CHAMP} w-80 font-mono`}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className={ETIQUETTE}>Offre accordée</span>
          <select value={plan} onChange={(e) => setPlan(e.target.value as Plan)} className={CHAMP}>
            {offres.map((p) => (
              <option key={p} value={p}>
                {LIBELLES_PLAN[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className={ETIQUETTE}>Échéance (facultative)</span>
          <input
            type="date"
            value={echeance}
            onChange={(e) => setEcheance(e.target.value)}
            className={CHAMP}
          />
        </label>
      </div>
      <ChampsMotif motif={motif} onChange={setMotif} avecCategorie avecMessageClient />
      <Bandeau ton={secondePersonne ? 'attention' : 'neutre'}>
        {secondePersonne
          ? 'Cet octroi attendra l’approbation d’une seconde personne (offre Expert, sans échéance ou au-delà de 90 jours).'
          : 'Cet octroi prendra effet dès sa préparation.'}
      </Bandeau>
      <div>
        <button type="submit" disabled={envoi || !pret} className={BOUTON}>
          {envoi ? 'Enregistrement…' : 'Préparer l’octroi'}
        </button>
      </div>
    </form>
  );
}

function LigneOctroi({
  octroi,
  peutOctroyer,
  onMaj,
  onEchec,
}: {
  octroi: AdminPlanGrantView;
  peutOctroyer: boolean;
  onMaj: (texte: string) => void;
  onEchec: (err: unknown) => void;
}): React.ReactElement {
  const [retrait, setRetrait] = useState<MotifSaisi>(MOTIF_VIDE);
  const [ouvert, setOuvert] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const phase = phaseOctroi(octroi.phase);
  const retirable = octroi.status !== 'revoked';

  async function approuver(): Promise<void> {
    setEnvoi(true);
    try {
      await api.approveAdminPlanGrant(octroi.id);
      onMaj('Octroi approuvé : il est en vigueur.');
    } catch (err) {
      onEchec(err);
    } finally {
      setEnvoi(false);
    }
  }

  async function retirer(): Promise<void> {
    setEnvoi(true);
    try {
      await api.revokeAdminPlanGrant(octroi.id, {
        internalNote: retrait.internalNote.trim(),
        clientMessage: retrait.clientMessage.trim(),
      });
      setRetrait(MOTIF_VIDE);
      onMaj(
        octroi.status === 'pending_approval'
          ? 'Demande d’octroi annulée.'
          : 'Octroi retiré : l’offre souscrite par le client s’applique de nouveau.',
      );
    } catch (err) {
      onEchec(err);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="font-medium">
            {LIBELLES_PLAN[octroi.plan] ?? octroi.plan} —{' '}
            {octroi.organizationName ?? octroi.targetOrganizationId}
          </span>
          <span className="text-xs text-[var(--foreground-muted)]">
            du {formaterDate(octroi.startsAt)}{' '}
            {octroi.endsAt ? `au ${formaterDate(octroi.endsAt)}` : 'sans échéance'} · préparé le{' '}
            {formaterDate(octroi.createdAt)}
            {octroi.soleApprover || octroi.soleOperator ? ' · seul détenteur (marqué)' : ''}
          </span>
        </span>
        <Pastille ton={phase.ton}>{phase.libelle}</Pastille>
      </div>
      <p className="text-sm">
        <span className={ETIQUETTE}>Message au client </span>
        {octroi.clientMessage}
      </p>
      <p className="text-sm text-[var(--foreground-muted)]">
        <span className={ETIQUETTE}>Note interne </span>
        {octroi.internalNote}
      </p>
      {peutOctroyer && retirable ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {octroi.status === 'pending_approval' ? (
              <button
                type="button"
                disabled={envoi}
                onClick={() => void approuver()}
                className={BOUTON}
              >
                Approuver (seconde personne)
              </button>
            ) : null}
            <button
              type="button"
              aria-expanded={ouvert}
              onClick={() => setOuvert((v) => !v)}
              className={BOUTON}
            >
              {octroi.status === 'pending_approval' ? 'Annuler la demande…' : 'Retirer…'}
            </button>
          </div>
          {ouvert ? (
            <div className="flex flex-col gap-2">
              <ChampsMotif
                motif={retrait}
                onChange={setRetrait}
                avecCategorie={false}
                avecMessageClient
              />
              <div>
                <button
                  type="button"
                  disabled={
                    envoi ||
                    !motifComplet(retrait, { avecCategorie: false, avecMessageClient: true })
                  }
                  onClick={() => void retirer()}
                  className={BOUTON}
                >
                  Confirmer
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

// ── Tableau des abonnements ──────────────────────────────────────────────────

function TableauAbonnements(): React.ReactElement {
  const [statut, setStatut] = useState<AdminSubscriptionStatus | ''>('');
  const [lignes, setLignes] = useState<AdminSubscriptionView[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    api
      .listAdminSubscriptions(statut || undefined)
      .then(({ subscriptions }) => {
        if (!actif) return;
        setLignes(subscriptions);
        setErreur(null);
      })
      .catch((err: unknown) => {
        if (actif)
          setErreur(messageErreurAbonnements(err, 'Impossible de charger les abonnements.'));
      });
    return () => {
      actif = false;
    };
  }, [statut]);

  return (
    <section className="flex flex-col gap-4">
      <Titre aide="Offre souscrite, offre applicable (octroi compris), état et échéances. Métadonnées seulement : aucun contenu d’organisation.">
        Abonnements
      </Titre>
      <label className="flex flex-col gap-1 text-sm">
        <span className={ETIQUETTE}>État</span>
        <select
          value={statut}
          onChange={(e) => setStatut(e.target.value as AdminSubscriptionStatus | '')}
          className={`${CHAMP} w-56`}
        >
          <option value="">Tous</option>
          {STATUTS_ABONNEMENT.map((s) => (
            <option key={s.valeur} value={s.valeur}>
              {s.libelle}
            </option>
          ))}
        </select>
      </label>
      {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}
      {lignes === null ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : lignes.length === 0 ? (
        <Vide>Aucun abonnement dans cet état.</Vide>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <caption className="sr-only">
              Abonnements, du plus récemment modifié au plus ancien
            </caption>
            <thead>
              <tr className="border-b border-[var(--border)] text-left">
                {['Organisation', 'Offre', 'Applicable', 'État', 'Échéance', 'Moyen'].map((t) => (
                  <th key={t} scope="col" className={`px-2 py-2 ${ETIQUETTE}`}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.organizationId} className="border-b border-[var(--border)] align-top">
                  <td className="px-2 py-2">{l.organizationName ?? l.organizationId}</td>
                  <td className="px-2 py-2">{LIBELLES_PLAN[l.plan] ?? l.plan}</td>
                  <td className="px-2 py-2">
                    {LIBELLES_PLAN[l.effectivePlan] ?? l.effectivePlan}
                    {l.grant ? (
                      <span className="block text-xs text-[var(--foreground-muted)]">
                        octroi{' '}
                        {l.grant.endsAt
                          ? `jusqu’au ${formaterDate(l.grant.endsAt)}`
                          : 'sans échéance'}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    <Pastille ton={tonStatutAbonnement(l.status)}>
                      {libelleStatutAbonnement(l.status)}
                    </Pastille>
                  </td>
                  <td className="fig px-2 py-2 text-xs">
                    {formaterDate(
                      l.status === 'trialing'
                        ? l.trialEndsAt
                        : l.status === 'grace'
                          ? l.graceEndsAt
                          : l.currentPeriodEnd,
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs">{libelleMoyen(l.provider)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
