"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface BetaTester {
  id: number;
  email: string;
  name: string | null;
  addedAt: string;
}

interface SendResult {
  sent: number;
  failed: number;
  testOnly?: boolean;
  details?: { email: string; ok: boolean; error?: string }[];
}

export default function BroadcastPanel() {
  const [testers, setTesters] = useState<BetaTester[]>([]);
  const [loadingTesters, setLoadingTesters] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  const [subject, setSubject] = useState("Site is down for updates");
  const [body, setBody] = useState(
    "Hello everyone, the website is down as I'm making tons of pushes and changes. I'm worried about data corruption from people using the tool mid-alterations to backend. I'm going to try hard to get it back live on Wed.\n\nTLDR; ResearchOS LLC is officially licensed in the state of WI and I'm now a registered app store dev for Google and iPhone! Companion app should be live on app store by lab meeting.",
  );
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");

  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  const fetchTesters = useCallback(async () => {
    setLoadingTesters(true);
    try {
      const res = await fetch("/api/admin/broadcast/recipients");
      if (res.ok) {
        const data = await res.json();
        setTesters(data.testers ?? []);
      }
    } finally {
      setLoadingTesters(false);
    }
  }, []);

  useEffect(() => {
    fetchTesters();
  }, [fetchTesters]);

  const addTester = async () => {
    if (!newEmail.trim()) return;
    setAddBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/broadcast/recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail, name: newName || undefined }),
      });
      if (res.ok) {
        setNewEmail("");
        setNewName("");
        await fetchTesters();
      } else {
        const data = await res.json();
        setError(data.error ?? "failed to add");
      }
    } finally {
      setAddBusy(false);
    }
  };

  const removeTester = async (id: number) => {
    setError(null);
    await fetch("/api/admin/broadcast/recipients", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await fetchTesters();
  };

  const loadPreview = async () => {
    if (!subject.trim() || !body.trim()) return;
    setPreviewBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/broadcast/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          body,
          ctaLabel: ctaLabel || undefined,
          ctaUrl: ctaUrl || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPreviewHtml(data.html);
      } else {
        const data = await res.json();
        setError(data.error ?? "preview failed");
      }
    } finally {
      setPreviewBusy(false);
    }
  };

  useEffect(() => {
    if (previewHtml && iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(previewHtml);
        doc.close();
      }
    }
  }, [previewHtml]);

  const send = async (testOnly: boolean) => {
    if (!subject.trim() || !body.trim()) return;
    setSendBusy(true);
    setError(null);
    setSendResult(null);
    try {
      const res = await fetch("/api/admin/broadcast/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          body,
          ctaLabel: ctaLabel || undefined,
          ctaUrl: ctaUrl || undefined,
          testOnly,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSendResult(data);
      } else {
        setError(data.error ?? "send failed");
      }
    } catch {
      setError("network error");
    } finally {
      setSendBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-surface-raised p-6">
      <h2 className="text-title font-semibold text-foreground">
        Broadcast email
      </h2>
      <p className="mt-1 text-meta text-foreground-muted leading-relaxed">
        Send a branded email from support@research-os.app to your beta group.
      </p>

      {error && (
        <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3 text-meta text-rose-700">
          {error}
        </div>
      )}

      {/* Recipient list */}
      <div className="mt-6">
        <h3 className="text-body font-semibold text-foreground">
          Recipients
        </h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            type="email"
            placeholder="email@example.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-body text-foreground placeholder:text-foreground-muted focus:border-brand-action focus:outline-none"
          />
          <input
            type="text"
            placeholder="name (optional)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-body text-foreground placeholder:text-foreground-muted focus:border-brand-action focus:outline-none"
          />
          <button
            type="button"
            onClick={addTester}
            disabled={addBusy || !newEmail.trim()}
            className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-lg px-4 py-1.5 text-body font-medium disabled:opacity-40"
          >
            {addBusy ? "Adding..." : "Add"}
          </button>
        </div>
        {loadingTesters ? (
          <p className="mt-2 text-meta text-foreground-muted">Loading...</p>
        ) : testers.length === 0 ? (
          <p className="mt-2 text-meta text-foreground-muted">
            No recipients yet. Add emails above.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {testers.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-1.5"
              >
                <span className="text-body text-foreground">
                  {t.email}
                  {t.name && (
                    <span className="ml-2 text-meta text-foreground-muted">
                      ({t.name})
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => removeTester(t.id)}
                  className="text-meta text-rose-600 hover:text-rose-800"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Compose form */}
      <div className="mt-8">
        <h3 className="text-body font-semibold text-foreground">Compose</h3>
        <div className="mt-3 space-y-3">
          <input
            type="text"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:border-brand-action focus:outline-none"
          />
          <textarea
            placeholder="Body (separate paragraphs with blank lines)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:border-brand-action focus:outline-none"
          />
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              placeholder="CTA button label (optional)"
              value={ctaLabel}
              onChange={(e) => setCtaLabel(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-body text-foreground placeholder:text-foreground-muted focus:border-brand-action focus:outline-none"
            />
            <input
              type="url"
              placeholder="CTA button URL (optional)"
              value={ctaUrl}
              onChange={(e) => setCtaUrl(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-body text-foreground placeholder:text-foreground-muted focus:border-brand-action focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="mt-6">
        <button
          type="button"
          onClick={loadPreview}
          disabled={previewBusy || !subject.trim() || !body.trim()}
          className="rounded-lg border border-border bg-surface-raised px-4 py-2 text-body font-medium text-foreground hover:bg-surface-sunken disabled:opacity-40"
        >
          {previewBusy ? "Loading preview..." : "Preview email"}
        </button>
        {previewHtml !== null && (
          <div className="mt-3 rounded-lg border border-border bg-surface p-2">
            <iframe
              ref={iframeRef}
              title="Email preview"
              className="w-full rounded"
              style={{ minHeight: 500, border: "none" }}
            />
          </div>
        )}
      </div>

      {/* Send controls */}
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => send(true)}
          disabled={sendBusy || !subject.trim() || !body.trim()}
          className="ros-btn-neutral px-4 py-2 text-body font-medium disabled:opacity-40"
        >
          {sendBusy ? "Sending..." : "Send test to myself"}
        </button>
        <button
          type="button"
          onClick={() => send(false)}
          disabled={
            sendBusy || !subject.trim() || !body.trim() || testers.length === 0
          }
          className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-lg px-4 py-2 text-body font-medium disabled:opacity-40"
        >
          {sendBusy
            ? "Sending..."
            : `Send to all ${testers.length} recipient${testers.length === 1 ? "" : "s"}`}
        </button>
      </div>

      {sendResult && (
        <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-meta text-emerald-700">
          {sendResult.testOnly
            ? `Test email sent to yourself.`
            : `Sent to ${sendResult.sent} of ${sendResult.sent + sendResult.failed} recipients.`}
          {sendResult.failed > 0 && (
            <span className="ml-1 text-rose-600">
              ({sendResult.failed} failed)
            </span>
          )}
        </div>
      )}
    </section>
  );
}
