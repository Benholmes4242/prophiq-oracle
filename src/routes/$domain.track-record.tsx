import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/$domain/track-record")({
  beforeLoad: () => {
    throw redirect({ to: "/how-it-works", replace: true });
  },
});
