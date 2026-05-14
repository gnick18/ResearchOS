import { NextRequest } from "next/server";
import { isLabArchivesConfigured } from "@/lib/labarchives/config";

/**
 * `GET /api/auth/labarchives/callback` — popup-window credential form.
 *
 * Mirrors the role of the Google/Microsoft callback routes: the wizard
 * opens a popup at this URL, the user signs in, and the popup posts the
 * result back to `window.opener` then closes itself. The big difference
 * is that LabArchives has no third-party consent server — there's no
 * provider to redirect to and bounce back from — so this page IS the
 * credential form.
 *
 * The form POSTs to `/api/auth/labarchives/login` (server-side, HMAC-signed
 * call to LabArchives), and on success postMessages the UID + display name
 * back to the opener tab.
 *
 * If the integration is not configured we render an error stub instead.
 */
export async function GET(_req: NextRequest): Promise<Response> {
  if (!isLabArchivesConfigured()) {
    return new Response(errorHtml("LabArchives integration is not configured on this deployment."), {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return new Response(formHtml(), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function formHtml(): string {
  // Inlined CSS + script — keeping the popup as a single self-contained
  // page so it works even when the rest of the app is offline / shipping
  // a new bundle.
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Sign in to LabArchives</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 1.5rem; color: #1f2937; background: #f9fafb; }
  h2 { margin: 0 0 0.25rem; font-size: 1rem; }
  p.note { margin: 0 0 1rem; font-size: 0.8rem; color: #6b7280; }
  label { display: block; font-size: 0.75rem; font-weight: 500; color: #374151; margin-bottom: 0.25rem; margin-top: 0.75rem; }
  input { width: 100%; box-sizing: border-box; padding: 0.5rem 0.625rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.875rem; }
  button { margin-top: 1rem; width: 100%; background: #2563eb; color: white; border: 0; padding: 0.625rem; border-radius: 6px; font-weight: 500; font-size: 0.875rem; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .err { color: #b91c1c; font-size: 0.8rem; margin-top: 0.75rem; min-height: 1.1em; }
  .help { font-size: 0.7rem; color: #6b7280; margin-top: 0.75rem; }
</style></head>
<body>
  <h2>Sign in to LabArchives</h2>
  <p class="note">Used to fetch online-only inline images from your ELN export.</p>
  <form id="f" autocomplete="on">
    <label for="user">Email or login</label>
    <input id="user" name="loginOrEmail" type="text" autocomplete="username" required />
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" required />
    <button id="btn" type="submit">Sign in</button>
    <p id="err" class="err"></p>
    <p class="help">SSO users: you may need a one-time app authentication token (LabArchives → your name → "LA App authentication") instead of your usual password.</p>
  </form>
  <script>
    (function () {
      var form = document.getElementById("f");
      var btn = document.getElementById("btn");
      var errEl = document.getElementById("err");

      function postBack(payload) {
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(
              { source: "researchos-oauth", payload: payload },
              window.location.origin,
            );
          }
        } catch (_) { /* ignore */ }
      }

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        errEl.textContent = "";
        btn.disabled = true;
        btn.textContent = "Signing in…";

        var data = new FormData(form);
        fetch("/api/auth/labarchives/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            loginOrEmail: data.get("loginOrEmail"),
            password: data.get("password"),
          }),
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
          .then(function (res) {
            if (!res.ok || !res.body.uid) {
              errEl.textContent = res.body.error || "Sign-in failed.";
              postBack({ provider: "labarchives", error: errEl.textContent });
              btn.disabled = false;
              btn.textContent = "Sign in";
              return;
            }
            postBack({
              provider: "labarchives",
              uid: res.body.uid,
              fullname: res.body.fullname || null,
              email: res.body.email || null,
            });
            btn.textContent = "Connected — closing…";
            setTimeout(function () { window.close(); }, 300);
          })
          .catch(function (err) {
            errEl.textContent = "Network error: " + (err && err.message ? err.message : String(err));
            postBack({ provider: "labarchives", error: errEl.textContent });
            btn.disabled = false;
            btn.textContent = "Sign in";
          });
      });
    })();
  </script>
</body></html>`;
}

function errorHtml(message: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>LabArchives</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 2rem; text-align: center; color: #1f2937; }
  .err { color: #b91c1c; }
</style></head>
<body>
  <h2 class="err">Integration not configured</h2>
  <p>${escapeHtml(message)}</p>
  <p style="font-size: 0.8rem; color: #6b7280;">Ask the deployment admin to set LABARCHIVES_ACCESS_KEY_ID and LABARCHIVES_ACCESS_PASSWORD.</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
