'use client';

// Fiche fournisseur 360° — ADR-0044 § 3.1.1 et § 8 : identité, contacts,
// conditions, coordonnées de paiement MASQUÉES (« Afficher » soumis à
// `payables.pay`, confirmé, journalisé par l'API), puis les sections rendues par
// l'API (commandes, réceptions, factures, solde dû et ancienneté, paiements,
// dépenses directes). Une section masquée se dit par une phrase, jamais un zéro.
//
// Tant que la fiche 360° n'est pas servie (404, lot P6), l'écran montre
// l'identité lue dans la liste — rendue par l'API — et le dit.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import {
  ClipboardList,
  CreditCard,
  FileText,
  Landmark,
  PackageCheck,
  Receipt,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';

import {
  purchasesApi,
  type SupplierOverview,
  type SupplierPaymentMethodRevealView,
  type SupplierPaymentMethodView,
  type SupplierView,
} from '@/lib/api-purchases';

import { Bandeau, Panneau, PhraseSection, Tuile } from '../../crm/_components/crm-ui';
import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';
import { formatMontant } from '../../ventes/_components/sales-model';

import { useAccesAchats } from './achats-access';
import {
  ACHATS_BASE,
  LIBELLES_STATUT,
  formatInstantJour,
  formatJour,
  lienCommande,
  messageAchats,
  peutDemanderAchat,
  statutDe,
  tonStatut,
} from './achats-model';
import {
  PHRASE_CONFIRMATION_REVELATION,
  PHRASE_MASQUEE_ACHATS,
  PHRASE_MASQUEE_TRESORERIE,
  boutonAfficher,
  fournisseurRetenu,
  libelleConditions,
  libelleNature,
  lignesCoordonnees,
  phraseSection,
  trancheAnciennete,
} from './fournisseurs-model';

type Sections = SupplierOverview['sections'];

function MoyenPaiement({
  supplierId,
  moyen,
}: {
  supplierId: string;
  moyen: SupplierPaymentMethodView;
}): React.ReactElement {
  const id = useId();
  const { actions } = useAccesAchats();
  const bouton = boutonAfficher(actions);
  const [confirmation, setConfirmation] = useState(false);
  const [clair, setClair] = useState<SupplierPaymentMethodRevealView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function reveler(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      setClair(await purchasesApi.revealPaymentMethod(supplierId, moyen.id));
      setConfirmation(false);
    } catch (err) {
      setErreur(messageAchats(err, 'Affichage impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-[var(--radius-md)] bg-[var(--surface-muted)] p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span className="font-medium break-words">
            {moyen.label}
            {moyen.isDefault ? ' · par défaut' : ''}
          </span>
          <span className="font-mono text-xs tabular-nums">{moyen.masked}</span>
        </span>
        {clair ? (
          <button type="button" className={BOUTON_PETIT} onClick={() => setClair(null)}>
            Masquer
          </button>
        ) : (
          <button
            type="button"
            className={BOUTON_PETIT}
            disabled={!bouton.actif}
            aria-describedby={bouton.actif ? undefined : `${id}-raison`}
            aria-haspopup="dialog"
            onClick={() => setConfirmation(true)}
          >
            Afficher
          </button>
        )}
      </div>
      {bouton.raison ? (
        <p id={`${id}-raison`} className="text-xs text-[var(--foreground-muted)]">
          {bouton.raison}
        </p>
      ) : null}
      {clair ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {lignesCoordonnees(clair).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-[var(--foreground-muted)]">{k}</dt>
              <dd className="font-mono break-all">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <Modal
        open={confirmation}
        onClose={() => setConfirmation(false)}
        title="Afficher les coordonnées de paiement ?"
        size="sm"
        busy={envoi}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={BOUTON_PETIT} onClick={() => setConfirmation(false)}>
              Annuler
            </button>
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              disabled={envoi}
              onClick={() => void reveler()}
            >
              {envoi ? 'Affichage…' : 'Afficher'}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>{PHRASE_CONFIRMATION_REVELATION}</p>
          <p className="text-[var(--foreground-muted)]">
            {moyen.label} — {moyen.masked}
          </p>
          {erreur ? (
            <Alerte>
              <p>{erreur}</p>
            </Alerte>
          ) : null}
        </div>
      </Modal>
    </li>
  );
}

function Identite({ s }: { s: SupplierView }): React.ReactElement {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panneau titre="Contacts" icone={Users} id="fo-contacts">
        {s.contacts.length === 0 ? (
          <PhraseSection>Aucun contact enregistré.</PhraseSection>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {s.contacts.map((c) => (
              <li key={c.id} className="flex flex-col">
                <span className="font-medium break-words">
                  {c.name}
                  {c.isPrimary ? ' · principal' : ''}
                  {c.role ? ` — ${c.role}` : ''}
                </span>
                <span className="text-xs break-all text-[var(--foreground-muted)]">
                  {[c.email, c.phone].filter(Boolean).join(' · ') || 'Sans coordonnées'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {s.notes ? <p className="text-sm whitespace-pre-line">{s.notes}</p> : null}
      </Panneau>
      <Panneau titre="Coordonnées de paiement" icone={CreditCard} id="fo-paiement">
        {s.paymentDetailsChangedAlert ? (
          <Alerte>
            <p>
              Coordonnées de paiement modifiées le{' '}
              {formatInstantJour(s.paymentDetailsChangedAlert.at)}. Vérifiez-les auprès du
              fournisseur avant de payer.
            </p>
          </Alerte>
        ) : null}
        {s.paymentMethods.length === 0 ? (
          <PhraseSection>Aucun moyen de paiement enregistré.</PhraseSection>
        ) : (
          <ul className="flex flex-col gap-2">
            {s.paymentMethods.map((m) => (
              <MoyenPaiement key={m.id} supplierId={s.id} moyen={m} />
            ))}
          </ul>
        )}
        <p className="text-xs text-[var(--foreground-muted)]">
          Toujours masquées. Chaque affichage en clair est inscrit au journal d’audit.
        </p>
      </Panneau>
    </div>
  );
}

function SectionsFiche({ sections }: { sections: Sections }): React.ReactElement {
  const commandes = sections.orders;
  const solde = sections.balance;
  const factures = sections.invoices;
  const receptions = sections.receptions;
  const paiements = sections.payments;
  const depenses = sections.directExpenses;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panneau titre="Demandes et commandes" icone={ClipboardList} id="fo-commandes">
        {phraseSection(commandes, PHRASE_MASQUEE_ACHATS, 'Aucune demande ni commande.') ?? (
          <>
            <dl className="grid grid-cols-2 gap-2">
              {commandes.data!.totalsByCurrency.map((t) => (
                <Tuile
                  key={t.currency}
                  libelle={`${t.count} document${t.count > 1 ? 's' : ''} en ${t.currency}`}
                  valeur={formatMontant(t.total, t.currency)}
                />
              ))}
            </dl>
            <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
              {commandes.data!.recent.map((o) => (
                <li key={o.id} className="relative flex flex-wrap items-center gap-2 py-2">
                  <Link
                    href={lienCommande(o.id)}
                    className="min-w-0 flex-1 break-words after:absolute after:inset-0"
                  >
                    {o.number ?? 'Brouillon'} — {o.title}
                  </Link>
                  <span className="tabular-nums whitespace-nowrap">
                    {formatMontant(o.total, o.currency)}
                  </span>
                  <Badge tone={tonStatut(o.status)}>{LIBELLES_STATUT[o.status]}</Badge>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panneau>

      <Panneau titre="Solde dû et ancienneté" icone={Wallet} id="fo-solde">
        {phraseSection(solde, PHRASE_MASQUEE_ACHATS, 'Rien à payer à ce fournisseur.') ?? (
          <div className="flex flex-col gap-3">
            {solde.data!.byCurrency.map((row) => (
              <div key={row.currency} className="flex flex-col gap-2">
                <p className="text-sm">
                  Reste à payer :{' '}
                  <strong className="tabular-nums">
                    {formatMontant(row.remaining, row.currency)}
                  </strong>
                </p>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {trancheAnciennete(row).map((t) => (
                    <Tuile key={t.libelle} libelle={t.libelle} valeur={t.montant} />
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </Panneau>

      <Panneau titre="Réceptions" icone={PackageCheck} id="fo-receptions">
        {phraseSection(receptions, PHRASE_MASQUEE_ACHATS, 'Rien n’attend de réception.') ?? (
          <ul className="flex flex-col gap-1 text-sm">
            {receptions.data!.toReceive.map((r) => (
              <li key={r.orderId}>
                <Link href={lienCommande(r.orderId)} className="underline-offset-2 hover:underline">
                  {r.orderNumber ?? 'Commande'} — {r.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panneau>

      <Panneau titre="Factures et avoirs" icone={FileText} id="fo-factures">
        {phraseSection(factures, PHRASE_MASQUEE_ACHATS, 'Aucune facture reçue.') ?? (
          <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
            {factures.data!.recent.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 break-words">
                  {f.internalNumber} · réf. {f.supplierReference}
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  Échéance {formatJour(f.dueDate)}
                </span>
                <span className="tabular-nums whitespace-nowrap">
                  Reste {formatMontant(f.remaining, f.currency)}
                </span>
                {f.disputed ? <Badge tone="danger">En litige</Badge> : null}
                {f.matchingStatus === 'variance' ? <Badge tone="warning">Écart</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </Panneau>

      <Panneau titre="Paiements" icone={Landmark} id="fo-paiements">
        {phraseSection(paiements, PHRASE_MASQUEE_TRESORERIE, 'Aucun paiement enregistré.') ?? (
          <ul className="flex flex-col gap-1 text-sm">
            {paiements.data!.recent.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {p.number} · {formatJour(p.paidOn)}
                  {p.status === 'cancelled' ? ' · annulé' : ''}
                </span>
                <span className="tabular-nums">{formatMontant(p.amount, p.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panneau>

      <Panneau titre="Dépenses directes" icone={Receipt} id="fo-depenses">
        {phraseSection(depenses, PHRASE_MASQUEE_TRESORERIE, 'Aucune dépense directe.') ?? (
          <ul className="flex flex-col gap-1 text-sm">
            {depenses.data!.recent.map((d) => (
              <li key={d.id} className="flex flex-wrap justify-between gap-2">
                <span className="min-w-0 break-words">
                  {formatJour(d.spentOn)} · {d.label}
                  {d.possibleDuplicate ? ' · doublon probable' : ''}
                </span>
                <span className="tabular-nums">{formatMontant(d.amount, d.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panneau>
    </div>
  );
}

export function FournisseurFiche({ supplierId }: { supplierId: string }): React.ReactElement {
  const { actions } = useAccesAchats();
  const [o, setO] = useState<SupplierOverview | null>(null);
  const [repli, setRepli] = useState<SupplierView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(() => {
    purchasesApi
      .getSupplierOverview(supplierId)
      .then((v) => {
        setO(v);
        setErreur(null);
      })
      .catch((err: unknown) => {
        setErreur(messageAchats(err, 'Fiche illisible.'));
        if (statutDe(err) === 404) setRepli(fournisseurRetenu(supplierId));
      });
  }, [supplierId]);

  useEffect(() => charger(), [charger]);

  const s = o?.supplier ?? repli;
  const retour = (
    <Link href={`${ACHATS_BASE}/fournisseurs`} className="text-sm underline underline-offset-2">
      ← Fournisseurs
    </Link>
  );

  if (s === null) {
    return (
      <section className="flex min-w-0 flex-col gap-5">
        {retour}
        {erreur ? (
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        ) : (
          <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
            Chargement du fournisseur…
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      {retour}
      <Bandeau
        icone={Truck}
        titre={s.name}
        sousTitre={[libelleNature(s.kind), s.active ? null : 'Archivé'].filter(Boolean).join(' · ')}
        actions={
          peutDemanderAchat(actions) && s.active ? (
            <Link
              href={`${ACHATS_BASE}/commandes?nouvelle=1&fournisseur=${encodeURIComponent(s.id)}`}
              className={buttonClasses('primary', 'sm')}
            >
              Demander un achat
            </Link>
          ) : null
        }
      >
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tuile libelle="NIF" valeur={s.nif ?? 'Non renseigné'} />
          <Tuile libelle="Conditions" valeur={libelleConditions(s.paymentTerms)} />
          <Tuile libelle="Téléphone" valeur={s.phone ?? '—'} />
          <Tuile libelle="E-mail" valeur={<span className="break-all">{s.email ?? '—'}</span>} />
        </dl>
        {s.address ? <p className="text-sm text-[var(--foreground-muted)]">{s.address}</p> : null}
      </Bandeau>

      <Identite s={s} />

      {o ? (
        <SectionsFiche sections={o.sections} />
      ) : erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </section>
  );
}
