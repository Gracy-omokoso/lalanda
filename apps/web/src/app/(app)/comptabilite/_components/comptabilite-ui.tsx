'use client';

// Briques visuelles de la comptabilité (ADR-0049 § 13), lot K8 : reprennent celles du
// CRM et des stocks (bandeaux teintés, panneaux, tuiles), plus les bandeaux « Projet »
// et « Simulation », la liste des réserves (toujours en tête), la phrase d'une route pas
// encore livrée (404 : « bientôt disponible », jamais de donnée inventée) et les termes
// comptables avec leur infobulle (glossaire).

import { Badge } from '@lalanda/ui';
import { FlaskConical, ShieldAlert } from 'lucide-react';
import { useId } from 'react';

import { Infobulle } from '@/components/infobulle';
import type { AccountingReserveView } from '@/lib/api-accounting';

import { CarteVide } from '../../stocks/_components/stocks-ui';
import { Alerte, BOUTON_PETIT, CHAMP } from '../../ventes/_components/form-ui';

import {
  GLOSSAIRE,
  PHRASE_BIENTOT,
  estBientot,
  messageCompta,
  type BandeauCompta,
} from './comptabilite-model';

export { Bandeau, Panneau, PhraseSection, Tuile } from '../../crm/_components/crm-ui';
export { CARTE, CarteVide, Chargement } from '../../stocks/_components/stocks-ui';

/** Bandeaux de l'application : « Simulation » d'abord quand il y a lieu, « Projet » toujours. */
export function BandeauxCompta({
  bandeaux,
}: {
  bandeaux: readonly BandeauCompta[];
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      {bandeaux.map((b) =>
        b.id === 'simulation' ? (
          <div
            key={b.id}
            role="status"
            data-bandeau="simulation"
            className="flex items-start gap-3 rounded-[var(--radius-md)] border-2 border-[var(--warn)] bg-[color-mix(in_srgb,var(--warn)_12%,var(--surface))] px-4 py-3 text-sm"
          >
            <FlaskConical aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="flex flex-wrap items-center gap-2 font-semibold">
              <Badge tone="warning">Mode simulation</Badge>
              <span>{b.texte}</span>
            </p>
          </div>
        ) : (
          <div
            key={b.id}
            role="note"
            data-bandeau="projet"
            className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-3 text-sm"
          >
            <ShieldAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="font-medium">{b.texte}</p>
          </div>
        ),
      )}
    </div>
  );
}

/** Réserves d'une balance ou d'un projet d'état (§ 6.10) : jamais masquées, toujours en tête. */
export function Reserves({
  reserves,
}: {
  reserves: readonly AccountingReserveView[];
}): React.ReactElement {
  if (reserves.length === 0) {
    return (
      <p className="text-sm text-[var(--foreground-muted)]">
        Aucune réserve signalée par Lalanda pour cette période.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Réserves">
      {reserves.map((r) => (
        <li
          key={r.code}
          className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--warn)]/50 px-3 py-2 text-sm"
        >
          <Badge tone="warning">Réserve</Badge>
          <span>{r.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** Échec d'une lecture : « bientôt disponible » (404), sinon le message. */
export function EchecLecture({
  erreur,
  repli,
  onReessayer,
}: {
  erreur: unknown;
  repli: string;
  onReessayer?: () => void;
}): React.ReactElement {
  if (estBientot(erreur)) return <CarteVide>{PHRASE_BIENTOT}</CarteVide>;
  return (
    <Alerte
      action={
        onReessayer ? (
          <button type="button" className={BOUTON_PETIT} onClick={onReessayer}>
            Réessayer
          </button>
        ) : undefined
      }
    >
      <p>{messageCompta(erreur, repli)}</p>
    </Alerte>
  );
}

/** Terme comptable suivi de son infobulle (glossaire, § 13). */
export function Terme({
  terme,
  children,
}: {
  terme: keyof typeof GLOSSAIRE;
  children: React.ReactNode;
}): React.ReactElement {
  const id = useId();
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <Infobulle
        id={`terme-${id}`}
        texte={GLOSSAIRE[terme]}
        libelle={typeof children === 'string' ? children : 'ce terme'}
      />
    </span>
  );
}

/** Mention d'un élément à confirmer par l'expert-comptable (pack, règle, rubrique). */
export function AConfirmer({ texte }: { texte: string }): React.ReactElement {
  return <Badge tone="warning">{texte}</Badge>;
}

/** Choix d'un mois civil (`AAAA-MM`). */
export function ChoixMois({
  id,
  libelle,
  valeur,
  onChange,
}: {
  id: string;
  libelle: string;
  valeur: string;
  onChange: (mois: string) => void;
}): React.ReactElement {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm font-medium">
      {libelle}
      <input
        id={id}
        type="month"
        className={`${CHAMP} sm:w-48`}
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
