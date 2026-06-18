"use client";

// The /welcome route. The standalone welcome page was retired (the welcome now
// lives on the signed-out front door at "/"), but the URL still gets visited
// from old bookmarks and muscle memory. Rather than a bare 404, this:
//
//   signed OUT -> redirect to "/" (where the welcome landing actually renders).
//   signed IN  -> a friendly prompt offering to log out and see the welcome,
//                 since the welcome screen IS the signed-out view.
//
// Public marketing route (whitelisted in providers.tsx) so it renders for both
// states without the folder-connect gate hijacking it.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";

import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import { useHasCloudSession } from "@/components/account/AccountFirstRedirect";
import { Icon } from "@/components/icons";

export default function WelcomeRoute() {
  const router = useRouter();
  // true = signed in, false = signed out, null = still resolving.
  const hasSession = useHasCloudSession();

  // Signed-out visitors go straight to the welcome landing at "/".
  useEffect(() => {
    if (hasSession === false) router.replace("/");
  }, [hasSession, router]);

  const signedIn = hasSession === true;

  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <MarketingNav />
      <section className="relative overflow-hidden">
        <MarketingBackdrop tone="soft" />
        <div className="relative z-10 mx-auto max-w-lg px-6 pb-24 pt-24 text-center sm:pt-32">
          {signedIn ? (
            <>
              <h1 className="text-display font-bold tracking-tight text-foreground">
                Want to log out and see the welcome screen?
              </h1>
              <p className="mt-3 text-body text-foreground-muted">
                The welcome screen is the signed-out front door, and you are
                signed in right now. Log out to see it, or head back to your
                work.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => void signOut({ callbackUrl: "/" })}
                  className="inline-flex items-center gap-2 rounded-full bg-brand-action px-5 py-2.5 text-meta font-semibold text-white transition-opacity hover:opacity-90"
                >
                  <Icon name="logout" className="h-4 w-4 shrink-0" />
                  Log out and see it
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/")}
                  className="rounded-full border border-border bg-surface-raised px-5 py-2.5 text-meta font-semibold text-foreground transition-colors hover:border-brand-action/40"
                >
                  Back to your work
                </button>
              </div>
            </>
          ) : (
            // Loading or about to redirect (signed-out). Calm placeholder.
            <p className="text-body text-foreground-muted">
              Taking you to the welcome screen.
            </p>
          )}
        </div>
      </section>
      <MarketingFooter />
    </div>
  );
}
