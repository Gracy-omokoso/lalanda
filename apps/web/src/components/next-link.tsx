// Pont entre les composants de `@lalanda/ui` (qui ne dépendent pas de Next) et
// `next/link` : passer `renderLink={renderNextLink}` à `TabsNav` ou `Stepper`.

import type { LinkRenderProps } from '@lalanda/ui';
import Link from 'next/link';

export function renderNextLink({ children, ...props }: LinkRenderProps): React.ReactElement {
  return <Link {...props}>{children}</Link>;
}
