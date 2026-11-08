'use client';

// Tableau de bord d'un écran refait (ADR-0071) : quatre cartes, une courbe sur
// 12 mois, une répartition, une note sur les devises — sur le dessin des écrans
// Factures, Devis et Encaissements (ADR-0056, ADR-0067). Aucun calcul : chaque
// écran fournit des valeurs déjà écrites (son fichier de mise en forme).

import { BarList, LineChart, type BarItem, type ChartColor } from '@lalanda/ui';

import {
  BlocGraphique,
  CartesChiffres,
  EtatVide,
  ErreurTableau,
  SqueletteTableau,
  type CarteTableau,
  type EtatTableau,
} from './briques';
import { compact, moisCourt, moisLong } from './format';

const GRILLE = 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]';

export interface CourbeTableau {
  titre: string;
  /** Nom accessible complet (période, devise). */
  nom: string;
  mois: readonly string[];
  valeurs: readonly number[];
  serie: string;
  unite: string;
  couleur?: ChartColor;
}

export interface RepartitionTableau {
  titre: string;
  nom: string;
  barres: readonly BarItem[];
  vide: string;
  couleur?: ChartColor;
}

export function TableauChiffres({
  etat,
  libelle,
  texteErreur,
  onReessayer,
  outils,
  cartes,
  vide,
  courbe,
  repartition,
  note,
}: {
  etat: EtatTableau;
  libelle: string;
  texteErreur: string;
  onReessayer: () => void;
  /** Au-dessus des cartes (choix de la devise). */
  outils?: React.ReactNode;
  cartes: readonly CarteTableau[] | null;
  /** Rien encore : invitation à la place des graphiques. */
  vide: { titre: string; texte: string; action?: { href: string; label: string } | null } | null;
  courbe: CourbeTableau | null;
  repartition: RepartitionTableau | null;
  note: string | null;
}): React.ReactElement {
  if (etat === 'erreur') return <ErreurTableau texte={texteErreur} onReessayer={onReessayer} />;
  if (etat === 'chargement' || cartes === null) {
    return <SqueletteTableau label={`Chargement : ${libelle}`} graphiques={GRILLE} />;
  }
  return (
    <section aria-label={libelle} className="flex flex-col gap-3">
      {outils ?? null}
      <CartesChiffres cartes={cartes} />
      {vide ? (
        <EtatVide titre={vide.titre} texte={vide.texte} action={vide.action ?? null} />
      ) : (
        <div className={`grid gap-3 ${GRILLE}`}>
          {courbe ? (
            <BlocGraphique titre={courbe.titre}>
              <LineChart
                title={courbe.nom}
                labels={courbe.mois.map(moisCourt)}
                fullLabels={courbe.mois.map(moisLong)}
                series={[
                  {
                    id: 'serie',
                    label: courbe.serie,
                    values: courbe.valeurs,
                    color: courbe.couleur ?? 1,
                    variant: 'area',
                  },
                ]}
                formatValue={(v) => `${compact(v)} ${courbe.unite}`}
                formatTick={compact}
                endLabelSeriesId="serie"
                height={164}
              />
            </BlocGraphique>
          ) : null}
          {repartition ? (
            <BlocGraphique titre={repartition.titre}>
              <BarList
                title={repartition.nom}
                items={repartition.barres}
                color={repartition.couleur ?? 1}
                emptyText={repartition.vide}
              />
            </BlocGraphique>
          ) : null}
        </div>
      )}
      {note ? <p className="text-xs text-[var(--foreground-muted)]">{note}</p> : null}
    </section>
  );
}
