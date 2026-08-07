'use client';

// Onglets « Bilan », « BFR », « CAF » et « Seuil » — S18a (FIN-001).
//
// Ces tableaux sont matriciels : postes en lignes × exercices en colonnes, la
// forme qu'attend un lecteur de dossier bancaire. Ils consomment la structure
// `etatsFinanciers` renvoyée par l'API — aucun total n'est recalculé ici
// (docs/26 : « aucune règle financière dans un composant UI »).

import type {
  BfrExercice,
  BilanExercice,
  CafExercice,
  EtatsFinanciersView,
  SeuilExercice,
} from '@/lib/api';

// ─── Formatage ────────────────────────────────────────────────

function formatMoney(n: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatPercent(n: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 }).format(n);
}

function formatNumber(n: number, digits = 1): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(n);
}

/** Tolérance d'arrondi de l'invariant d'équilibre (docs/07), en unités monétaires. */
const TOLERANCE_EQUILIBRE = 0.01;

// ─── Briques de tableau ───────────────────────────────────────

interface Colonne {
  key: string;
  label: string;
}

interface Rangee {
  label: string;
  valeurs: string[];
  /** Ligne de total : mise en avant typographique. */
  total?: boolean;
  /** Sous-poste : légèrement en retrait. */
  detail?: boolean;
}

function Matrice({
  titre,
  intitule,
  colonnes,
  rangees,
}: {
  titre?: string;
  intitule: string;
  colonnes: Colonne[];
  rangees: Rangee[];
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-2">
      {titre ? (
        <h4 className="text-xs font-medium text-[var(--foreground-muted)]">{titre}</h4>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left">
              <th className="py-2 pr-2 font-medium text-[var(--foreground-muted)]">{intitule}</th>
              {colonnes.map((c) => (
                <th
                  key={c.key}
                  className="py-2 pl-2 text-right font-medium text-[var(--foreground-muted)]"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rangees.map((r) => (
              <tr
                key={r.label}
                className={`border-b border-[var(--border)] ${
                  r.total ? 'font-semibold text-[var(--accent)]' : ''
                }`}
              >
                <td
                  className={`py-2 pr-2 ${r.detail ? 'pl-3 text-[var(--foreground-muted)]' : ''}`}
                >
                  {r.label}
                </td>
                {r.valeurs.map((v, i) => (
                  <td key={colonnes[i]?.key ?? i} className="fig py-2 pl-2 text-right">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p className="text-[11px] leading-relaxed text-[var(--foreground-muted)]">{children}</p>;
}

function Titre({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
      {children}
    </h3>
  );
}

function colonnesExercices(annees: number[]): Colonne[] {
  return annees.map((a) => ({ key: `ex-${a}`, label: `Exercice ${a}` }));
}

// ─── Bilan ────────────────────────────────────────────────────

interface BilanProps {
  etats: EtatsFinanciersView;
  currency: string;
}

export function BilanTable({ etats, currency }: BilanProps): React.ReactElement {
  const { bilan, ouverture } = etats;
  const m = (n: number): string => formatMoney(n, currency);

  // Colonne « Ouverture » puis un exercice par colonne.
  const colonnes: Colonne[] = [
    { key: 'ouverture', label: 'Ouverture' },
    ...colonnesExercices(bilan.map((b) => b.annee)),
  ];

  const ligne = (
    label: string,
    ouv: number | undefined,
    get: (b: BilanExercice) => number,
    opts: { total?: boolean; detail?: boolean; fmt?: (n: number) => string } = {},
  ): Rangee => ({
    label,
    total: opts.total,
    detail: opts.detail,
    valeurs: [
      ouv === undefined ? '—' : (opts.fmt ?? m)(ouv),
      ...bilan.map((b) => (opts.fmt ?? m)(get(b))),
    ],
  });

  const actif: Rangee[] = [
    ligne('Immobilisations brutes', ouverture.actifImmobilise, (b) => b.immobilisationsBrutes, {
      detail: true,
    }),
    ligne('Amortissements cumulés', 0, (b) => -b.amortissementsCumules, { detail: true }),
    ligne('Actif immobilisé net', ouverture.actifImmobilise, (b) => b.actifImmobilise),
    ligne('Stocks', undefined, (b) => b.stocks, { detail: true }),
    ligne('Créances clients', undefined, (b) => b.creancesClients, { detail: true }),
    ligne('Actif circulant', ouverture.actifCirculant, (b) => b.actifCirculant),
    ligne('Trésorerie', ouverture.tresorerieActif, (b) => b.tresorerieActif),
    ligne('TOTAL ACTIF', ouverture.totalActif, (b) => b.totalActif, { total: true }),
  ];

  const passif: Rangee[] = [
    ligne('Capital apporté', ouverture.capitauxPropres, (b) => b.capitalApporte, { detail: true }),
    ligne('Résultats cumulés', 0, (b) => b.resultatsCumules, { detail: true }),
    ligne('Capitaux propres', ouverture.capitauxPropres, (b) => b.capitauxPropres),
    ligne('Dettes financières', ouverture.dettesFinancieres, (b) => b.dettesFinancieres),
    ligne('Dettes fournisseurs', undefined, (b) => b.fournisseurs, { detail: true }),
    ligne('Dettes fiscales et sociales', undefined, (b) => b.dettesFiscalesSociales, {
      detail: true,
    }),
    ligne('TOTAL PASSIF', ouverture.totalPassif, (b) => b.totalPassif, { total: true }),
  ];

  const controle: Rangee[] = [
    ligne('Écart actif − passif', ouverture.ecartEquilibre, (b) => b.ecartEquilibre),
    ligne('Autonomie financière', undefined, (b) => b.autonomieFinanciere, {
      fmt: formatPercent,
    }),
  ];

  const desequilibre = [ouverture.ecartEquilibre, ...bilan.map((b) => b.ecartEquilibre)].some(
    (e) => Math.abs(e) >= TOLERANCE_EQUILIBRE,
  );

  return (
    <div className="flex flex-col gap-4">
      <Titre>Bilan prévisionnel</Titre>
      <Matrice titre="Actif" intitule="Poste" colonnes={colonnes} rangees={actif} />
      <Matrice titre="Passif" intitule="Poste" colonnes={colonnes} rangees={passif} />
      <Matrice titre="Contrôles" intitule="Indicateur" colonnes={colonnes} rangees={controle} />
      {desequilibre ? (
        <p className="text-[11px] font-semibold text-[var(--ko)]">
          Bilan déséquilibré : l’écart dépasse la tolérance d’arrondi. Signalez cette anomalie — le
          dossier ne doit pas être déposé en l’état.
        </p>
      ) : (
        <Note>
          Bilan équilibré sur tous les exercices : l’actif égale le passif à la tolérance d’arrondi
          près, sans poste d’ajustement.
        </Note>
      )}
      <Note>
        Les immobilisations brutes reprennent les investissements initiaux ; les dotations
        proviennent de l’onglet Amortissements. L’économie d’impôt liée aux dotations et aux
        intérêts n’est pas modélisée (hypothèse prudente) et les dettes fiscales et sociales ne sont
        pas encore décalées d’un exercice — à revalider par un expert-comptable.
      </Note>
    </div>
  );
}

// ─── BFR ──────────────────────────────────────────────────────

export function BfrTable({
  etats,
  currency,
}: {
  etats: EtatsFinanciersView;
  currency: string;
}): React.ReactElement {
  const { bfr } = etats;
  const m = (n: number): string => formatMoney(n, currency);
  const colonnes = colonnesExercices(bfr.map((b) => b.annee));

  const ligne = (
    label: string,
    get: (b: BfrExercice) => number,
    opts: { total?: boolean; detail?: boolean; fmt?: (n: number) => string } = {},
  ): Rangee => ({
    label,
    total: opts.total,
    detail: opts.detail,
    valeurs: bfr.map((b) => (opts.fmt ?? m)(get(b))),
  });

  const rangees: Rangee[] = [
    ligne('Stocks', (b) => b.stocks, { detail: true }),
    ligne('Créances clients', (b) => b.creancesClients, { detail: true }),
    ligne('− Dettes fournisseurs', (b) => -b.dettesFournisseurs, { detail: true }),
    ligne('− Dettes fiscales et sociales', (b) => -b.dettesFiscalesSociales, { detail: true }),
    ligne('BESOIN EN FONDS DE ROULEMENT', (b) => b.bfr, { total: true }),
    ligne('Variation du BFR', (b) => b.variation),
    ligne('BFR en jours de CA', (b) => b.bfrJoursCa, { fmt: (n) => `${formatNumber(n)} j` }),
  ];

  return (
    <div className="flex flex-col gap-4">
      <Titre>Besoin en fonds de roulement</Titre>
      <Matrice intitule="Poste" colonnes={colonnes} rangees={rangees} />
      <Note>
        Postes calculés sur une année commerciale de 360 jours : stocks = achats × rotation,
        créances = CA × délai clients, fournisseurs = achats × délai fournisseurs. Une variation
        positive consomme de la trésorerie sur l’exercice ; une variation négative en libère. Les
        charges fixes sont supposées réglées comptant — hypothèse prudente qui majore le BFR.
      </Note>
    </div>
  );
}

// ─── CAF ──────────────────────────────────────────────────────

export function CafTable({
  etats,
  currency,
}: {
  etats: EtatsFinanciersView;
  currency: string;
}): React.ReactElement {
  const { caf } = etats;
  const m = (n: number): string => formatMoney(n, currency);
  const colonnes = colonnesExercices(caf.map((c) => c.annee));

  const ligne = (
    label: string,
    get: (c: CafExercice) => number,
    opts: { total?: boolean; detail?: boolean } = {},
  ): Rangee => ({ label, ...opts, valeurs: caf.map((c) => m(get(c))) });

  const rangees: Rangee[] = [
    ligne('Résultat net', (c) => c.resultatNet, { detail: true }),
    ligne('+ Dotations aux amortissements', (c) => c.dotationsAmortissements, { detail: true }),
    ligne("CAPACITÉ D'AUTOFINANCEMENT", (c) => c.caf, { total: true }),
  ];

  const cumul = caf.reduce((s, c) => s + c.caf, 0);

  return (
    <div className="flex flex-col gap-4">
      <Titre>Capacité d’autofinancement</Titre>
      <Matrice intitule="Poste" colonnes={colonnes} rangees={rangees} />
      <p className="text-sm">
        CAF cumulée sur {caf.length} exercices :{' '}
        <span className="fig font-semibold text-[var(--accent)]">{m(cumul)}</span>
      </p>
      <Note>
        La CAF mesure les ressources dégagées par l’exploitation avant financement des
        investissements et du BFR. Les dotations aux amortissements y sont réintégrées : ce sont des
        charges comptables, pas des sorties de trésorerie. Le résultat net retenu est celui du
        compte d’exploitation, diminué des dotations et des intérêts d’emprunt.
      </Note>
    </div>
  );
}

// ─── Seuil de rentabilité ─────────────────────────────────────

export function SeuilTable({
  etats,
  currency,
}: {
  etats: EtatsFinanciersView;
  currency: string;
}): React.ReactElement {
  const seuils = etats.seuilRentabilite;
  const m = (n: number): string => formatMoney(n, currency);
  const colonnes = colonnesExercices(seuils.map((s) => s.annee));

  const ligne = (
    label: string,
    get: (s: SeuilExercice) => number,
    opts: { total?: boolean; detail?: boolean; fmt?: (n: number) => string } = {},
  ): Rangee => ({
    label,
    total: opts.total,
    detail: opts.detail,
    valeurs: seuils.map((s) => (opts.fmt ?? m)(get(s))),
  });

  const rangees: Rangee[] = [
    ligne("Chiffre d'affaires", (s) => s.ca, { detail: true }),
    ligne('− Charges variables', (s) => -s.chargesVariables, { detail: true }),
    ligne('Marge sur coûts variables', (s) => s.margeSurCoutsVariables),
    ligne('Taux de marge sur coûts variables', (s) => s.tauxMargeVariable, { fmt: formatPercent }),
    ligne('Charges fixes', (s) => s.chargesFixes),
    ligne('SEUIL DE RENTABILITÉ', (s) => s.caSeuil, { total: true }),
    ligne('Point mort', (s) => s.pointMortMois, {
      fmt: (n) => `${formatNumber(n)} mois`,
    }),
    ligne('Marge de sécurité', (s) => s.margeSecurite, { fmt: formatPercent }),
  ];

  const premier = seuils[0];

  return (
    <div className="flex flex-col gap-4">
      <Titre>Seuil de rentabilité et point mort</Titre>
      <Matrice intitule="Poste" colonnes={colonnes} rangees={rangees} />
      {premier ? (
        <p className="text-sm">
          Sur l’exercice 1, l’activité devient rentable à partir de{' '}
          <span className="fig font-semibold text-[var(--accent)]">{m(premier.caSeuil)}</span> de
          chiffre d’affaires, atteints au bout de{' '}
          <span className="fig font-semibold">{formatNumber(premier.pointMortMois)} mois</span>.
        </p>
      ) : null}
      <Note>
        Les charges fixes retenues comprennent les charges d’exploitation fixes, les dotations aux
        amortissements et les intérêts d’emprunt. La marge de sécurité indique de combien le chiffre
        d’affaires peut reculer avant de repasser sous le seuil. La ventilation fixe / variable suit
        la convention documentée du modèle sectoriel.
      </Note>
    </div>
  );
}
