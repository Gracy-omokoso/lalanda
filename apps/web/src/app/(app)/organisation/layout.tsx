import { OrganizationChrome } from './_components/organization-chrome';

/**
 * Chrome commun de l'espace organisation (S21a, ADR-0030) : en-tête + onglets.
 * Les pages filles ne rendent que leur contenu.
 *
 * Contrairement à `/compte`, cet espace EXIGE une organisation active : toutes
 * ses routes API sont scopées par `organizationId`. Un utilisateur sans
 * organisation reçoit `403 NO_ORGANIZATION`, que les pages traitent comme un
 * état — « créez une organisation ou acceptez une invitation » — et non comme
 * une panne.
 */
export default function OrganizationLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <OrganizationChrome>{children}</OrganizationChrome>;
}
