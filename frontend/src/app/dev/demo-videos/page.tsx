import { DEMO_CLIP_META } from "@/lib/demo-video/scripts";

// Dev launcher for the welcome-video clips. Open this in one tab, then click a
// clip to drive + record it. Each clip link carries `?record=1&demo=<id>`, so
// the demo loads on a pristine recording surface, shows a 5s countdown, and
// then the demo engine drives the UI with its animated cursor. Not linked from
// anywhere in the product; purely an internal recording console.
export const metadata = { title: "Demo video studio" };

export default function DemoVideoStudioPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-display font-bold text-foreground">Demo video studio</h1>
      <p className="mt-2 text-body text-foreground-muted">
        One launcher for the welcome-page clips. Click a clip to open it on a
        clean recording surface and drive it automatically.
      </p>

      <ol className="mt-6 space-y-1.5 rounded-xl border border-border bg-surface-sunken px-5 py-4 text-meta text-foreground-muted">
        <li>1. Fullscreen this window (the green button hides all browser chrome).</li>
        <li>2. Open a clip below, then start your screen recording (Cmd-Shift-5, entire screen).</li>
        <li>
          3. A 5-second countdown plays, then the cursor drives itself. Press{" "}
          <kbd className="rounded border border-border bg-surface-raised px-1">`</kbd>{" "}
          to re-take, or Cmd-R for a clean reload.
        </li>
        <li>4. Stop when it rests on the final frame, then come back here for the next.</li>
      </ol>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {DEMO_CLIP_META.map((clip) => (
          <a
            key={clip.id}
            href={`/demo?record=1&demo=${clip.id}${clip.viewAs ? `&demoViewAs=${clip.viewAs}` : ""}`}
            className="group flex flex-col rounded-xl border border-border bg-surface-raised p-5 transition-colors hover:border-brand-action hover:bg-surface-sunken"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-title font-semibold text-foreground">
                {clip.label}
              </span>
              <span className="text-meta text-foreground-muted">// {clip.hook}</span>
            </div>
            <p className="mt-1 text-body text-foreground-muted">{clip.summary}</p>
            <div className="mt-3 flex items-center justify-between">
              <code className="text-meta text-foreground-muted">{clip.file}</code>
              <span className="text-meta font-semibold text-brand-action group-hover:underline">
                Open &amp; record →
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
