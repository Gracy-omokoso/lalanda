// Rendu des blocs de contenu du centre d'aide (S22d).
//
// Un composant par type de bloc, aucun état : le contenu est de la donnée
// statique (`lib/aide/articles`). Direction visuelle « dossier bancaire » —
// titres en `font-display`, chiffres et libellés d'appui en `font-mono`,
// exemples chiffrés sur `doc-card` (le papier du dossier).

import type { Bloc, EntreeGlossaire, TonNote } from '@/lib/aide/types';

import { TexteRiche } from './texte-riche';

/** Habillage des encadrés. `limite` est volontairement sobre et non alarmiste :
 *  elle informe d'une absence, elle ne signale pas une panne. */
const NOTE_STYLE: Record<TonNote, { bord: string; fond: string; etiquette: string }> = {
  info: {
    bord: 'border-[var(--accent)]/35',
    fond: 'bg-[var(--accent)]/5',
    etiquette: 'À SAVOIR',
  },
  limite: {
    bord: 'border-[var(--border-strong)]',
    fond: 'bg-[var(--surface-muted)]',
    etiquette: 'CE QUE LALANDA NE FAIT PAS',
  },
  attention: {
    bord: 'border-[var(--warn)]/45',
    fond: 'bg-[var(--warn)]/8',
    etiquette: 'À VÉRIFIER',
  },
};

function Note({
  ton,
  titre,
  texte,
}: {
  ton: TonNote;
  titre: string;
  texte: string;
}): React.ReactElement {
  const style = NOTE_STYLE[ton];
  return (
    <aside className={`rounded-lg border ${style.bord} ${style.fond} px-4 py-3.5 sm:px-5`}>
      <p className="font-mono text-[0.62rem] font-semibold tracking-[0.14em] text-[var(--foreground-muted)]">
        {style.etiquette}
      </p>
      <p className="font-display mt-1.5 text-[0.98rem] font-bold leading-snug text-[var(--foreground)]">
        {titre}
      </p>
      <p className="mt-1.5 text-[0.92rem] leading-relaxed text-[var(--foreground-muted)]">
        <TexteRiche texte={texte} />
      </p>
    </aside>
  );
}

/** Statut d'une entrée de glossaire vis-à-vis du produit réel.
 *  `non_calcule` est affiché explicitement : c'est tout l'intérêt du champ. */
const STATUT_GLOSSAIRE: Record<EntreeGlossaire['statut'], { libelle: string; classe: string }> = {
  calcule: {
    libelle: 'Calculé par Lalanda',
    classe: 'border-[var(--ok)]/40 text-[var(--ok)]',
  },
  concept: {
    libelle: 'Notion — non affichée telle quelle',
    classe: 'border-[var(--border-strong)] text-[var(--foreground-muted)]',
  },
  non_calcule: {
    libelle: 'Non calculé aujourd’hui',
    classe: 'border-[var(--warn)]/50 text-[var(--warn)]',
  },
};

function Glossaire({ entrees }: { entrees: readonly EntreeGlossaire[] }): React.ReactElement {
  return (
    <dl className="flex flex-col gap-3">
      {entrees.map((entree) => {
        const statut = STATUT_GLOSSAIRE[entree.statut];
        return (
          <div
            key={entree.terme}
            id={`terme-${entree.terme.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`}
            className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5"
          >
            <dt className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
              <span className="font-display text-[1rem] font-bold text-[var(--foreground)]">
                {entree.terme}
              </span>
              <span
                className={`font-mono rounded border px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-[0.08em] ${statut.classe}`}
              >
                {statut.libelle}
              </span>
            </dt>
            <dd className="mt-1.5 text-[0.92rem] leading-relaxed text-[var(--foreground-muted)]">
              <TexteRiche texte={entree.definition} />
              {entree.ou ? (
                <span className="mt-1.5 block text-[0.86rem] text-[var(--foreground-muted)]">
                  <TexteRiche texte={entree.ou} />
                </span>
              ) : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function BlocRendu({ bloc }: { bloc: Bloc }): React.ReactElement {
  switch (bloc.type) {
    case 'paragraphe':
      return (
        <p className="text-[1rem] leading-[1.75] text-[var(--foreground-muted)]">
          <TexteRiche texte={bloc.texte} />
        </p>
      );

    case 'liste': {
      const Balise = bloc.ordonnee ? 'ol' : 'ul';
      return (
        <Balise
          className={`flex flex-col gap-2.5 pl-5 text-[1rem] leading-[1.7] text-[var(--foreground-muted)] ${
            bloc.ordonnee ? 'list-decimal' : 'list-disc'
          } marker:text-[var(--border-strong)]`}
        >
          {bloc.items.map((item, i) => (
            <li key={i} className="pl-1">
              <TexteRiche texte={item} />
            </li>
          ))}
        </Balise>
      );
    }

    case 'etapes':
      return (
        <ol className="flex flex-col gap-4">
          {bloc.items.map((item, i) => (
            <li key={item.titre} className="flex gap-4">
              <span
                aria-hidden="true"
                className="font-mono mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-full border border-[var(--border-strong)] text-[0.72rem] font-semibold text-[var(--foreground-muted)]"
              >
                {i + 1}
              </span>
              <div>
                <p className="font-display text-[1rem] font-bold text-[var(--foreground)]">
                  {item.titre}
                </p>
                <p className="mt-1 text-[0.95rem] leading-relaxed text-[var(--foreground-muted)]">
                  <TexteRiche texte={item.texte} />
                </p>
              </div>
            </li>
          ))}
        </ol>
      );

    case 'note':
      return <Note ton={bloc.ton} titre={bloc.titre} texte={bloc.texte} />;

    case 'tableau':
      return (
        <figure className="flex flex-col gap-2">
          {/* Le tableau défile seul : la page, elle, ne défile jamais horizontalement. */}
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full min-w-[34rem] border-collapse text-left text-[0.9rem]">
              <thead>
                <tr className="bg-[var(--surface-muted)]">
                  {bloc.entetes.map((entete) => (
                    <th
                      key={entete}
                      scope="col"
                      className="font-mono border-b border-[var(--border)] px-3.5 py-2.5 text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-[var(--foreground-muted)]"
                    >
                      {entete}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bloc.lignes.map((ligne, i) => (
                  <tr key={i} className="border-b border-[var(--border)] last:border-0">
                    {ligne.map((cellule, j) => (
                      <td
                        key={j}
                        className={`px-3.5 py-2.5 align-top leading-relaxed ${
                          j === 0
                            ? 'font-medium text-[var(--foreground)]'
                            : 'text-[var(--foreground-muted)]'
                        }`}
                      >
                        <TexteRiche texte={cellule} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bloc.legende ? (
            <figcaption className="text-[0.85rem] leading-relaxed text-[var(--foreground-muted)]">
              <TexteRiche texte={bloc.legende} />
            </figcaption>
          ) : null}
        </figure>
      );

    case 'exemple':
      return (
        <div className="doc-card px-5 py-4 sm:px-6 sm:py-5">
          <p className="font-mono border-b border-[#d6cdb9] pb-2.5 text-[0.64rem] font-semibold tracking-[0.14em] text-[#6c685a]">
            {bloc.titre.toUpperCase()}
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {bloc.lignes.map((ligne) => (
              <div key={ligne.libelle} className="ledger-row text-[0.88rem]">
                <span className="text-[#33424a]">{ligne.libelle}</span>
                <span className="leader" />
                <span className="fig font-semibold text-[#14191b]">{ligne.valeur}</span>
              </div>
            ))}
          </div>
          {bloc.conclusion ? (
            <p className="mt-4 border-t border-[#d6cdb9] pt-3 text-[0.88rem] leading-relaxed text-[#33424a]">
              <TexteRiche texte={bloc.conclusion} />
            </p>
          ) : null}
        </div>
      );

    case 'glossaire':
      return <Glossaire entrees={bloc.entrees} />;
  }
}
