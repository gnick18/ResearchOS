import { NextRequest } from "next/server";

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
 * Server-side we always render the form, because the deployer credentials
 * may live either in env vars (visible here) or in a sidecar file in the
 * user's data folder (only visible to the opener via FSA). The popup asks
 * the opener for sidecar creds on load — if it gets them, it includes them
 * in the POST body. The `/login` route does the final "is the integration
 * configured?" check and surfaces a generic error if neither source
 * supplied creds.
 */
export async function GET(_req: NextRequest): Promise<Response> {
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

      // Deployer creds (sidecar mode) come from the opener via postMessage.
      // In env-var mode the opener responds with null and we send the login
      // request with no deployerCreds field; the server resolves the creds
      // from env. In sidecar mode the opener reads the FSA sidecar and
      // sends them back here.
      var deployerCreds = null;
      var deployerCredsReady = null; // Promise resolved once we hear back
      function requestDeployerCreds() {
        deployerCredsReady = new Promise(function (resolve) {
          var done = false;
          function settle(value) { if (!done) { done = true; resolve(value); } }
          function onMessage(event) {
            if (event.origin !== window.location.origin) return;
            if (!event.data || event.data.source !== "researchos-labarchives-opener") return;
            if (event.data.type !== "deployer-creds") return;
            window.removeEventListener("message", onMessage);
            settle(event.data.creds || null);
          }
          window.addEventListener("message", onMessage);
          try {
            if (window.opener && !window.opener.closed) {
              window.opener.postMessage(
                { source: "researchos-labarchives-popup", type: "request-deployer-creds" },
                window.location.origin,
              );
            } else {
              // No opener (popup opened directly?) — proceed without sidecar.
              settle(null);
            }
          } catch (_) { settle(null); }
          // Give the opener a generous window to reply before assuming
          // env-var mode. The opener's reply path involves an async FSA
          // read so 1.5s is conservative.
          setTimeout(function () { settle(null); }, 1500);
        });
        deployerCredsReady.then(function (c) { deployerCreds = c; });
      }
      requestDeployerCreds();

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
        // Wait for the deployer-creds probe to settle before posting.
        (deployerCredsReady || Promise.resolve(null)).then(function () {
          var body = {
            loginOrEmail: data.get("loginOrEmail"),
            password: data.get("password"),
          };
          if (deployerCreds && typeof deployerCreds === "object") {
            body.deployerCreds = deployerCreds;
          }
          return fetch("/api/auth/labarchives/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
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

