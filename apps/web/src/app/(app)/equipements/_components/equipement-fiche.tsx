'use client';

// Fiche d'un équipement — ADR-0046 § 3, § 5.2, § 9 : identité et statut, affectation
// et retour (fenêtres modales, chevauchement refusé en clair), historique,
// maintenance, garanties et assurances, cession avec confirmation, amortissement
// indicatif TOUJOURS étiqueté « estimation de gestion », coût total de possession si
// les droits l'autorisent, documents liés. Introuvable ou d'une autre organisation :
// l'API répond 404, l'écran le dit.

import { Badge, Modal } from '@lalanda/ui';
import { ArrowLeft, Calculator, History, Laptop, TriangleAlert, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EntityDocumentsPanel } from '@/components/entity-documents-panel';
import { assetsApi, type AssetAssignmentsView, type AssetDetailView } from '@/lib/api-assets';

import { useShell } from '../../_components/shell-context';
import { BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { EquipementFormulaire } from './equipement-formulaire';
import {
  EQUIPEMENTS_BASE,
  LIBELLES_CESSION,
  LIBELLES_CONSTAT,
  LIBELLES_STATUT,
  formatJour,
  formatMontant,
  libelleBeneficiaire,
  lire,
  statutDe,
  tonStatut,
  valeursAffichees,
  type Lecture,
} from './equipements-model';
import { Bandeau, Chargement, EchecLecture, Panneau, PhraseSection, Tuile } from './equipements-ui';
import {
  DialogueAffectation,
  DialogueCession,
  DialogueReintegration,
  DialogueRetour,
} from './fiche-dialogues';
import {
  gestesEquipement,
  motifNonEstimable,
  phraseEstimation,
  texteCoutAcquisition,
  type IdGeste,
} from './fiche-model';
import { PanneauCouvertures, PanneauMaintenance } from './fiche-suivi';

export function EquipementFiche({ assetId }: { assetId: string }): React.ReactElement {
  const { actions } = useShell();
  const [lecture, setLecture] = useState<Lecture<AssetDetailView> | null>(null);
  const [historique, setHistorique] = useState<Lecture<AssetAssignmentsView> | null>(null);
  const [version, setVersion] = useState(0);
  const [geste, setGeste] = useState<IdGeste | null>(null);
  const [sale, setSale] = useState(false);

  useEffect(() => {
    let annule = false;
    void lire(assetsApi.get(assetId)).then((l) => {
      if (!annule) setLecture(l);
    });
    void lire(assetsApi.assignments(assetId)).then((l) => {
      if (!annule) setHistorique(l);
    });
    return () => {
      annule = true;
    };
  }, [assetId, version]);

  const recharger = (): void => setVersion((v) => v + 1);
  const fait = (a: AssetDetailView): void => {
    setGeste(null);
    setLecture({ ok: true, valeur: a });
    recharger();
  };

  const retour = (
    <Link
      href={EQUIPEMENTS_BASE}
      className="inline-flex items-center gap-1 self-start text-sm underline underline-offset-2"
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      Tout le registre
    </Link>
  );

  if (lecture === null) return <Chargement texte="Chargement de l’équipement…" />;
  if (!lecture.ok) {
    return (
      <section className="flex flex-col gap-4">
        {retour}
        {statutDe(lecture.erreur) === 404 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center sm:p-8">
            <p className="text-sm font-medium">Équipement introuvable</p>
            <p className="mx-auto mt-1 max-w-xl text-sm text-[var(--foreground-muted)]">
              Cet équipement n’existe pas ou appartient à une autre organisation.
            </p>
          </div>
        ) : (
          <EchecLecture
            erreur={lecture.erreur}
            repli="L’équipement est illisible."
            onReessayer={recharger}
          />
        )}
      </section>
    );
  }

  const a = lecture.valeur;
  const valeurs = valeursAffichees(actions, a.valuesHidden);
  const estimation = phraseEstimation(a, valeurs);
  const gestes = gestesEquipement(a, actions);
  const actif = a.status !== 'disposed';

  return (
    <section className="flex min-w-0 flex-col gap-5">
      {retour}
      <Bandeau
        icone={Laptop}
        titre={a.name}
        sousTitre={[
          a.number,
          a.categoryName,
          a.brand && `${a.brand}${a.model ? ` ${a.model}` : ''}`,
          a.serialNumber && `série ${a.serialNumber}`,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            <Badge tone={tonStatut(a.status)}>{LIBELLES_STATUT[a.status]}</Badge>
            {gestes.map((g) => (
              <button
                key={g.id}
                type="button"
                className={BOUTON_PETIT}
                aria-haspopup="dialog"
                onClick={() => {
                  setSale(false);
                  setGeste(g.id);
                }}
              >
                {g.libelle}
              </button>
            ))}
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tuile
            libelle="Chez"
            valeur={
              <span className="text-base">
                {libelleBeneficiaire(a.currentAssignment?.assignee)}
              </span>
            }
            detail={
              a.currentAssignment ? `depuis le ${formatJour(a.currentAssignment.from)}` : undefined
            }
            attention={a.findings.includes('ASSET_HELD_BY_FORMER_EMPLOYEE')}
          />
          <Tuile
            libelle="Acquis le"
            valeur={<span className="text-base">{formatJour(a.acquisition.on)}</span>}
          />
          {valeurs ? (
            <Tuile
              libelle="Coût d’acquisition"
              valeur={texteCoutAcquisition(a.acquisition.cost, (v) =>
                formatMontant(v, a.acquisition.currency),
              )}
            />
          ) : null}
          {a.tag ? (
            <Tuile libelle="Étiquette" valeur={<span className="text-base">{a.tag}</span>} />
          ) : null}
        </div>
        {a.findings.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {a.findings.map((c) => (
              <li key={c}>
                <Badge tone="warning">
                  <TriangleAlert aria-hidden="true" className="mr-1 inline h-3 w-3" />
                  {LIBELLES_CONSTAT[c] ?? c}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
        {a.disposal ? (
          <p className="text-sm">
            {LIBELLES_CESSION[a.disposal.kind]} le {formatJour(a.disposal.on)} — {a.disposal.reason}
            {a.disposal.buyer ? ` · acheteur : ${a.disposal.buyer}` : ''}
            {valeurs && a.disposal.proceeds !== null
              ? ` · ${formatMontant(a.disposal.proceeds, a.disposal.currency)} (déclaré, sans facture)`
              : ''}
          </p>
        ) : null}
        {a.notes ? <p className="text-sm whitespace-pre-line break-words">{a.notes}</p> : null}
      </Bandeau>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panneau titre="Amortissement indicatif" icone={Calculator} id="eq-estimation">
          <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border-strong)] px-2 py-1 text-xs font-medium">
            {estimation.etiquette}
          </p>
          {estimation.etat === 'estimee' ? (
            <>
              <p className="font-display text-2xl font-bold tabular-nums">
                {estimation.valeur}
                <span className="ml-2 align-middle text-xs font-normal text-[var(--foreground-muted)]">
                  valeur estimée
                </span>
              </p>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                {estimation.lignes.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 sm:flex-col sm:justify-start">
                    <dt className="text-xs text-[var(--foreground-muted)]">{k}</dt>
                    <dd className="tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="text-sm">{estimation.texte}</p>
          )}
        </Panneau>

        {a.totalCostOfOwnership ? (
          <Panneau titre="Coût total de possession" icone={Wallet} id="eq-tco">
            {!a.totalCostOfOwnership.estimable ? (
              <PhraseSection>
                Non estimable : {motifNonEstimable(a.totalCostOfOwnership.reason)}. Saisissez-le
                pour obtenir le coût total.
              </PhraseSection>
            ) : a.totalCostOfOwnership.byCurrency.length === 0 ? (
              <PhraseSection>Aucun coût enregistré.</PhraseSection>
            ) : (
              <ul className="flex flex-col gap-3 text-sm">
                {a.totalCostOfOwnership.byCurrency.map((c) => (
                  <li key={c.currency} className="flex flex-col gap-1">
                    <span className="font-display text-xl font-bold tabular-nums">
                      {formatMontant(c.total, c.currency)}
                    </span>
                    <span className="text-xs text-[var(--foreground-muted)]">
                      acquisition {formatMontant(c.acquisition, c.currency)} · maintenance{' '}
                      {formatMontant(c.maintenance, c.currency)} · couvertures{' '}
                      {formatMontant(c.coverages, c.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-[var(--foreground-muted)]">
              Une ligne par devise, jamais convertie.
              {a.totalCostOfOwnership.unpricedMaintenanceCount > 0
                ? ` ${a.totalCostOfOwnership.unpricedMaintenanceCount} intervention(s) sans coût saisi.`
                : ''}
            </p>
          </Panneau>
        ) : null}

        <PanneauMaintenance assetId={a.id} actif={actif} onChange={recharger} />
        <PanneauCouvertures assetId={a.id} actif={actif} onChange={recharger} />

        <Panneau titre="Historique des affectations" icone={History} id="eq-historique">
          {historique === null ? (
            <Chargement />
          ) : !historique.ok ? (
            <EchecLecture erreur={historique.erreur} repli="L’historique est illisible." />
          ) : historique.valeur.items.length === 0 ? (
            <PhraseSection>Jamais affecté.</PhraseSection>
          ) : (
            <ol className="flex flex-col divide-y divide-[var(--border)] text-sm">
              {historique.valeur.items.map((h) => (
                <li key={h.id} className="flex flex-col gap-0.5 py-2">
                  <span className="font-medium break-words">{libelleBeneficiaire(h.assignee)}</span>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    Du {formatJour(h.from)} {h.to ? `au ${formatJour(h.to)}` : '— en cours'}
                    {h.conditionOut ? ` · remis : ${h.conditionOut}` : ''}
                    {h.conditionIn ? ` · rendu : ${h.conditionIn}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panneau>

        <EntityDocumentsPanel entityType="asset" entityId={a.id} />
      </div>

      <Modal
        open={geste === 'modifier'}
        onClose={() => setGeste(null)}
        dirty={sale}
        title="Modifier l’équipement"
        size="lg"
      >
        <EquipementFormulaire equipement={a} onSale={setSale} onEnregistre={fait} />
      </Modal>
      {geste === 'affecter' ? (
        <DialogueAffectation equipement={a} onFermer={() => setGeste(null)} onFait={fait} />
      ) : null}
      {geste === 'retourner' ? (
        <DialogueRetour equipement={a} onFermer={() => setGeste(null)} onFait={fait} />
      ) : null}
      {geste === 'ceder' ? (
        <DialogueCession equipement={a} onFermer={() => setGeste(null)} onFait={fait} />
      ) : null}
      {geste === 'reintegrer' ? (
        <DialogueReintegration equipement={a} onFermer={() => setGeste(null)} onFait={fait} />
      ) : null}
    </section>
  );
}
