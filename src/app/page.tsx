import { redirect } from "next/navigation";
// This entry is a redirect, not an instant-rendered page.
export const instant = false;
export default function Home() { redirect("/admin"); }
