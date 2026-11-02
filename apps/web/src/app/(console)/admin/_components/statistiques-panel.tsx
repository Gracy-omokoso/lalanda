'use client';

// Module « Statistiques » de la console (ADR-0053 § 6.7 — lot P7).
//
// Agrégats seulement : comptes d'organisations, de comptes, d'essais, adoption des
// modules et volumes d'usage. Aucune donnée d'un client. Toute case de moins de cinq
// est servie masquée par l'API et s'affiche « < 5 ».

import { useEffect, useState } from 'react';

import { Bandeau, Compteur, Vide } from './admin-chrome';
import { formaterDateHeure, messageErreur } from './admin-model';
import {
  afficherCase,
  chargerStatistiques,
  libelleEtat,
  libelleModule,
  libelleOffre,
  libellePays,
  libelleType,
  lignesTriees,
  type LigneStat,
  type StatistiquesView,
} from './statistiques-model';

export function StatistiquesPanel(): React.ReactElement {
  const [vue, setVue] = useState<StatistiquesView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    chargerStatistiques()
      .then((v) => {
        if (actif) setVue(v);
      })
      .catch((err: unknown) => {
        if (actif) setErreur(messageErreur(err, 'Impossible de charger les statistiques.'));
      });
    return () => {
      actif = false;
    };
  }, []);

  if (erreur) return <Bandeau ton="echec">{erreur}</Bandeau>;
  if (!vue) return <Vide>Chargement des statistiques…</Vide>;

  const s = vue.minCell;
  const c = (x: Parameters<typeof afficherCase>[0]) => afficherCase(x, s);
  const fenetre = `${vue.windowDays} derniers jours`;

  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-3xl text-sm text-[var(--foreground-muted)]">
        Calculé le {formaterDateHeure(vue.generatedAt)}. Aucune case de moins de {s} n’est affichée
        en clair (« &lt; {s} ») ; dans une répartition, une seconde case peut être masquée pour que
        la première ne se déduise pas du total.
      </p>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Compteur libelle="Organisations" valeur={c(vue.organizations.total)} />
        <Compteur
          libelle="Organisations actives"
          valeur={c(vue.organizations.activeInWindow)}
          precision={`un membre connecté sur les ${fenetre}`}
        />
        <Compteur
          libelle="Nouvelles organisations"
          valeur={c(vue.organizations.createdInWindow)}
          precision={fenetre}
        />
        <Compteur libelle="Comptes" valeur={c(vue.users.total)} />
        <Compteur
          libelle="Comptes actifs"
          valeur={c(vue.users.activeInWindow)}
          precision={fenetre}
        />
        <Compteur
          libelle="Nouveaux comptes"
          valeur={c(vue.users.createdInWindow)}
          precision={fenetre}
        />
        <Compteur libelle="Essais démarrés" valeur={c(vue.trials.started)} />
        <Compteur
          libelle="Essais convertis"
          valeur={c(vue.trials.converted)}
          precision={`essais en cours : ${c(vue.trials.ongoing)}`}
        />
        <Compteur
          libelle="Appels à l’IA"
          valeur={c(vue.usage.aiCallsInWindow)}
          precision={fenetre}
        />
        <Compteur
          libelle="Exports PDF"
          valeur={c(vue.usage.pdfExportsInWindow)}
          precision={fenetre}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Repartition
          titre="Par offre"
          lignes={vue.organizations.byPlan}
          libelle={libelleOffre}
          seuil={s}
          trier={false}
        />
        <Repartition
          titre="Par pays"
          lignes={vue.organizations.byCountry}
          libelle={libellePays}
          seuil={s}
        />
        <Repartition
          titre="Par état d’abonnement"
          lignes={vue.organizations.bySubscriptionStatus}
          libelle={libelleEtat}
          seuil={s}
        />
        <Repartition
          titre="Par type d’organisation"
          lignes={vue.organizations.byType}
          libelle={libelleType}
          seuil={s}
        />
      </div>

      <Repartition
        titre="Adoption des modules"
        aide="Nombre d’organisations ayant au moins un élément dans le module. Aucun contenu, aucun montant."
        lignes={vue.modules}
        libelle={libelleModule}
        seuil={s}
      />
    </div>
  );
}

function Repartition({
  titre,
  aide,
  lignes,
  libelle,
  seuil,
  trier = true,
}: {
  titre: string;
  aide?: string;
  lignes: readonly LigneStat[];
  libelle: (cle: string) => string;
  seuil: number;
  trier?: boolean;
}): React.ReactElement {
  const liste = trier ? lignesTriees(lignes) : lignes;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-lg font-bold tracking-tight">{titre}</h2>
      {aide ? <p className="text-sm text-[var(--foreground-muted)]">{aide}</p> : null}
      {liste.length === 0 ? (
        <Vide>Aucune donnée.</Vide>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {liste.map((l) => (
              <tr key={l.key} className="border-b border-[var(--border)]">
                <td className="py-1.5 pr-4">{libelle(l.key)}</td>
                <td
                  className={`py-1.5 text-right font-mono tabular-nums ${
                    l.cell.masked ? 'text-[var(--foreground-muted)]' : ''
                  }`}
                >
                  {afficherCase(l.cell, seuil)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
