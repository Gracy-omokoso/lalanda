'use client';

// Liste paginée par curseur, commune aux clients et au catalogue (docs/16 :
// pagination par curseur ; ADR-0022 § S25c.5).
//
// - Un changement de filtre repart de la première page, après 300 ms de pause :
//   la recherche ne lance pas une requête par touche.
// - Une réponse arrivée APRÈS une requête plus récente est ignorée : sans cette
//   garde, taper « kin » puis effacer pourrait afficher les résultats de « ki ».
// - « Afficher plus » ajoute la page suivante sans doublon.

import { useCallback, useEffect, useRef, useState } from 'react';

import { estRefus, fusionnerPage, messageVentes } from './sales-model';

export type EtatListe = 'chargement' | 'pret' | 'erreur' | 'refus';

export interface ListeVentes<T> {
  items: T[];
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
  etat: EtatListe;
  erreur: string | null;
  suivante: boolean;
  chargementSuite: boolean;
  erreurSuite: string | null;
  chargerSuite: () => void;
  recharger: () => void;
}

export function useSalesList<T extends { id: string }>(
  charger: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>,
  /** Clé des filtres : la liste repart de zéro quand elle change. */
  cle: string,
): ListeVentes<T> {
  const [items, setItems] = useState<T[]>([]);
  const [curseur, setCurseur] = useState<string | null>(null);
  const [etat, setEtat] = useState<EtatListe>('chargement');
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargementSuite, setChargementSuite] = useState(false);
  const [erreurSuite, setErreurSuite] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const derniere = useRef(0);
  const premiere = useRef(true);
  const versionLancee = useRef(0);
  const chargerRef = useRef(charger);
  chargerRef.current = charger;

  useEffect(() => {
    const numero = ++derniere.current;
    const lancer = (): void => {
      setEtat((e) => (e === 'pret' ? 'pret' : 'chargement'));
      setErreur(null);
      setErreurSuite(null);
      chargerRef
        .current(null)
        .then((page) => {
          if (numero !== derniere.current) return;
          setItems(page.items);
          setCurseur(page.nextCursor);
          setEtat('pret');
        })
        .catch((err: unknown) => {
          if (numero !== derniere.current) return;
          if (estRefus(err)) {
            setEtat('refus');
            setErreur(messageVentes(err, 'Accès refusé.'));
          } else {
            setEtat('erreur');
            setErreur(messageVentes(err, 'Impossible de charger la liste.'));
          }
        });
    };
    // Premier chargement et rechargement explicite : tout de suite. Changement
    // de filtre : après une pause de frappe.
    if (premiere.current || version !== versionLancee.current) {
      premiere.current = false;
      versionLancee.current = version;
      lancer();
      return;
    }
    const minuteur = setTimeout(lancer, 300);
    return () => clearTimeout(minuteur);
  }, [cle, version]);

  const chargerSuite = useCallback((): void => {
    if (curseur === null || chargementSuite) return;
    const numero = derniere.current;
    setChargementSuite(true);
    setErreurSuite(null);
    chargerRef
      .current(curseur)
      .then((page) => {
        if (numero !== derniere.current) return;
        setItems((actuels) => fusionnerPage(actuels, page.items));
        setCurseur(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (numero !== derniere.current) return;
        setErreurSuite(messageVentes(err, 'Impossible de charger la suite.'));
      })
      .finally(() => setChargementSuite(false));
  }, [curseur, chargementSuite]);

  const recharger = useCallback((): void => setVersion((v) => v + 1), []);

  return {
    items,
    setItems,
    etat,
    erreur,
    suivante: curseur !== null,
    chargementSuite,
    erreurSuite,
    chargerSuite,
    recharger,
  };
}
