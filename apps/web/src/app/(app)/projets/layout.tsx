import { ProjetsAcces } from './_components/projets-acces';

/**
 * Espace Projets du RUN (ADR-0039) : liste des projets, « Mes tâches », et la
 * page de chaque projet (Liste, Kanban, Réglages ; Calendrier et Chronologie
 * au lot L3b). Exige une session et une organisation active ; lecture sous
 * `work.read`. `/projets` est distinct de `/projects` (initiatives BUILD).
 */
export default function ProjetsLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <ProjetsAcces>{children}</ProjetsAcces>;
}
