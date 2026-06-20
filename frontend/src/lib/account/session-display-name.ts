// One-source name prefill for onboarding: the OAuth display name.
//
// The signed-in user already gave us their name at the OAuth provider, so the
// wizard should reuse it everywhere a name is shown rather than asking again.
// This app mounts NO <SessionProvider> (see UserLoginScreen), so the only way to
// read the session client-side is to fetch the NextAuth session endpoint
// directly. Returns "" on any failure so a prefill is best-effort and never
// blocks a step.
//
// No emojis, no em-dashes, no mid-sentence colons.

export async function fetchSessionDisplayName(): Promise<string> {
  try {
    const res = await fetch("/api/auth/session", {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { user?: { name?: string | null } } | null;
    return (data?.user?.name ?? "").trim();
  } catch {
    return "";
  }
}
