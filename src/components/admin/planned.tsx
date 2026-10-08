"use client";
import { Planned, NoPermission } from "./common";
import { useAdmin } from "./provider";
export function SystemPlanned(props: React.ComponentProps<typeof Planned>) {
  const { state } = useAdmin();
  return state.actor.isSuperAdmin ? <Planned {...props} /> : <NoPermission />;
}
