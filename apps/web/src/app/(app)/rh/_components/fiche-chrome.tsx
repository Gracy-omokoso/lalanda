'use client';

// Coquille de la fiche collaborateur (ADR-0045 § 8, lot H6) : lit la fiche
// (`GET /hr/employees/:id` — `hr.read`, le manager pour son équipe, ou soi), pose
// le bandeau et les onglets livrés, et partage la fiche avec les onglets.
// Hors portée, l'API répond 404 (elle ne confirme pas l'existence) : l'écran le
// dit sans rien inventer.

import { Badge } from '@lalanda/ui';
import { ArrowLeft, IdCard } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { hrApi, type HrEmployeeView, type HrSettingsContractType } from '@/lib/api-hr';

import { ONGLETS_FICHE, ongletActif } from './collaborateurs-model';
import { useReferentielsRh } from './referentiels';
import { useAccesRh } from './rh-access';
import {
  RH_BASE,
  lienCollaborateur,
  libelleStatutCollaborateur,
  lire,
  nomAffiche,
  peutLireRh,
  statutDe,
  type Lecture,
} from './rh-model';
import { Bandeau, Chargement, EchecLecture } from './rh-ui';

interface FicheCtx {
  fiche: HrEmployeeView;
  contrats: readonly HrSettingsContractType[];
  remplacer: (f: HrEmployeeView) => void;
}

const Contexte = createContext<FicheCtx | null>(null);

export function useFiche(): FicheCtx {
  const c = useContext(Contexte);
  if (c === null) throw new Error('useFiche hors de la fiche collaborateur');
  return c;
}

export function FicheChrome({
  employeeId,
  children,
}: {
  employeeId: string;
  children: React.ReactNode;
}): React.ReactElement {
  const pathname = usePathname();
  const { actions } = useAccesRh();
  const { contrats } = useReferentielsRh(false);
  const [lecture, setLecture] = useState<Lecture<HrEmployeeView> | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let annule = false;
    void lire(hrApi.getEmployee(employeeId)).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [employeeId, version]);

  const remplacer = useCallback((f: HrEmployeeView) => setLecture({ ok: true, valeur: f }), []);
  const base = lienCollaborateur(employeeId);
  const retour = peutLireRh(actions) ? `${RH_BASE}/collaborateurs` : `${RH_BASE}/equipe`;

  const lienRetour = (
    <Link
      href={retour}
      className="inline-flex items-center gap-1 self-start text-sm underline underline-offset-2"
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      {peutLireRh(actions) ? 'Tous les collaborateurs' : 'Mon équipe'}
    </Link>
  );

  if (lecture === null) return <Chargement texte="Chargement de la fiche…" />;
  if (!lecture.ok) {
    return (
      <section className="flex flex-col gap-4">
        {lienRetour}
        {statutDe(lecture.erreur) === 404 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center sm:p-8">
            <p className="text-sm font-medium">Fiche introuvable</p>
            <p className="mx-auto mt-1 max-w-xl text-sm text-[var(--foreground-muted)]">
              Ce collaborateur n’existe pas, n’est pas dans votre périmètre, ou les fiches ne sont
              pas encore disponibles sur ce serveur.
            </p>
          </div>
        ) : (
          <EchecLecture
            erreur={lecture.erreur}
            repli="La fiche est illisible."
            onReessayer={() => setVersion((v) => v + 1)}
          />
        )}
      </section>
    );
  }

  const fiche = lecture.valeur;
  const statut = libelleStatutCollaborateur(fiche);
  const actif = ongletActif(pathname, base);

  return (
    <Contexte.Provider value={{ fiche, contrats, remplacer }}>
      <section className="flex min-w-0 flex-col gap-5">
        {lienRetour}
        <Bandeau
          icone={IdCard}
          titre={nomAffiche(fiche)}
          sousTitre={[fiche.jobTitle, fiche.departmentName].filter(Boolean).join(' · ')}
          actions={<Badge tone={statut.ton}>{statut.texte}</Badge>}
        >
          <nav aria-label="Sections de la fiche" className="-mb-1 flex gap-1 overflow-x-auto">
            {ONGLETS_FICHE.map((o) => (
              <Link
                key={o.id}
                href={o.segment ? `${base}/${o.segment}` : base}
                aria-current={actif === o.id ? 'page' : undefined}
                className={`shrink-0 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition ${
                  actif === o.id
                    ? 'bg-[var(--surface)] shadow-sm'
                    : 'text-[var(--foreground-muted)] hover:bg-[var(--surface)]'
                }`}
              >
                {o.libelle}
              </Link>
            ))}
          </nav>
        </Bandeau>
        {children}
      </section>
    </Contexte.Provider>
  );
}
