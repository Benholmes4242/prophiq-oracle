import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/my-questions")({
  beforeLoad: () => {
    throw redirect({ to: "/asked", replace: true });
  },
});
