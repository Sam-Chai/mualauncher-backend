import { redirect } from "next/navigation";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { redirect(`/admin/clients/${(await params).id}`); }
