import { OrganizationsPage } from "@/components/admin/organizations";
// The parent auth gate can redirect before this page renders. Instant config is per segment.
export const instant = false;
export default function Page() { return <OrganizationsPage />; }
