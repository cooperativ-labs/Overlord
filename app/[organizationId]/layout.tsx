import { OrganizationShell } from './OrganizationShell';

export default function OrganizationLayout({ children }: { children: React.ReactNode }) {
  return <OrganizationShell>{children}</OrganizationShell>;
}
