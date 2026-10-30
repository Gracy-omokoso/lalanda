'use client';

// « Mes autorisations » — ADR-0041 décision n° 10, lot A5.
//
// La notification « Vos autorisations ont changé » renvoie vers `/compte` : ce
// panneau y montre, en lecture seule, le titre de la personne dans son
// organisation active, l'écart en une phrase et la grille par domaine. Tout vient
// de l'API (`GET /me/permissions` lu par la coquille, `GET /authz/catalog`).
//
// L'espace compte reste accessible sans organisation : sans permissions lues, le
// panneau le dit et ne charge rien d'autre.

import { useEffect, useState } from 'react';

import type { OrgAction } from '@/lib/api';
import { apiAutorisations, type CatalogueAutorisations } from '@/lib/api-permissions';

import { useShell } from '../../_components/shell-context';
import { GrilleAutorisations } from '../../organisation/membres/_components/member-permissions-panel';
import {
  construireGrille,
  ecartAffiche,
  ligneDuTitre,
  phraseEcart,
} from '../../organisation/membres/_components/permissions-model';

export function MyPermissionsPanel(): React.ReactElement {
  const { permissions, chargees } = useShell();
  const [catalogue, setCatalogue] = useState<CatalogueAutorisations | null>(null);
  const [echec, setEchec] = useState(false);

  useEffect(() => {
    if (!permissions) return;
    let annule = false;
    void apiAutorisations
      .getCatalogue()
      .then((c) => {
        if (!annule) setCatalogue(c);
      })
      .catch(() => {
        if (!annule) setEchec(true);
      });
    return () => {
      annule = true;
    };
  }, [permissions]);

  let contenu: React.ReactNode;
  if (!chargees) {
    contenu = <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>;
  } else if (!permissions) {
    contenu = (
      <p className="text-sm text-[var(--foreground-muted)]">
        Aucune organisation active : vos autorisations s’affichent ici dès que vous en rejoignez
        une.
      </p>
    );
  } else if (echec) {
    contenu = (
      <p className="text-sm text-[var(--foreground-muted)]">
        Votre titre : {permissions.roleLabel}. Le détail des autorisations n’a pas pu être chargé.
      </p>
    );
  } else if (!catalogue) {
    contenu = <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>;
  } else {
    // La ligne du titre est celle servie par l'API pour CE membre (case ⚙ comprise).
    const base = permissions.roleActions;
    const selection = new Set<OrgAction>(permissions.actions);
    const ligne = ligneDuTitre(catalogue, permissions.role);
    const grille = construireGrille({
      catalogue,
      base,
      conditionnelles: ligne.conditionnelles,
      selection,
      contexte: 'membre',
      ajoutables: [],
      verrou: 'Lecture seule.',
    });
    contenu = (
      <>
        <p className="text-sm font-medium">
          {phraseEcart(
            catalogue,
            permissions.roleLabel,
            base,
            ecartAffiche(catalogue, base, selection),
          )}
        </p>
        <GrilleAutorisations idPrefixe="mes-autorisations" grille={grille} lectureSeule />
        <p className="text-xs text-[var(--foreground-muted)]">
          Vous ne pouvez pas modifier vos propres autorisations. Un Propriétaire ou un
          Administrateur de votre organisation peut les ajuster depuis l’espace Membres.
        </p>
      </>
    );
  }

  return (
    <section aria-labelledby="mes-autorisations-titre" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2
          id="mes-autorisations-titre"
          className="font-display text-lg font-semibold tracking-tight"
        >
          Mes autorisations
        </h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          Ce que votre titre vous permet dans l’organisation active, et ce qui a été ajouté ou
          retiré pour vous.
        </p>
      </div>
      {contenu}
    </section>
  );
}
