import Link from "next/link";

import OperatorSignIn from "@/components/admin/OperatorSignIn";

/**
 * The screen shown at /admin when the visitor is NOT an operator (logged out, or
 * signed in with an account that is not on the ADMIN_EMAILS allow-list). It
 * renders ONLY the sign-in block, never the OperatorShell, so none of the
 * operator-only content (the metrics, the finances, or the client-computed
 * price-modeling figures) is in the page for a non-operator. The server gate in
 * page.tsx decides shell vs this screen, so the shell never reaches here.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
export default function OperatorAccessRequired() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-sunken px-6 py-16 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface-raised p-6 shadow-sm">
        <p className="text-meta font-bold uppercase tracking-wide text-foreground-muted">
          ResearchOS
        </p>
        <h1 className="mt-1 text-heading font-bold tracking-tight text-foreground">
          Admin access required
        </h1>
        <p className="mt-2 text-body text-foreground-muted leading-relaxed">
          The operator console is for ResearchOS operators only. Sign in with an
          authorized account to continue, or head back to the app.
        </p>

        <OperatorSignIn />

        <div className="mt-5 border-t border-border pt-4">
          <Link
            href="/"
            className="text-body font-medium text-sky-700 underline-offset-2 hover:underline"
          >
            Back to the app
          </Link>
        </div>
      </div>
    </div>
  );
}
