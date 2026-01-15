import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.GUESTY_CLIENT_ID;
const CLIENT_SECRET = process.env.GUESTY_CLIENT_SECRET;

// Block any non-GET requests to YOUR API (extra safety)
app.use((req, res, next) => {
  const m = req.method.toUpperCase();
  if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
    return res.status(405).send("Method not allowed");
  }
  next();
});

app.get("/", (req, res) => res.send("Guesty PMC API running"));

// ---------- Token cache + single-flight lock ----------
let cachedToken = null;
let cachedTokenExpiresAt = 0; // unix ms
let tokenInFlight = null; // Promise<string> | null

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTokenWithBackoff() {
  const url = "https://open-api.guesty.com/oauth2/token";

  // Exponential backoff up to ~1 minute, plus jitter
  const delays = [0, 2000, 5000, 10000, 20000, 30000, 45000];

  let lastErr = null;

  for (let i = 0; i < delays.length; i++) {
    const base = delays[i];
    const jitter = Math.floor(Math.random() * 800); // 0-800ms
    if (base > 0) await sleep(base + jitter);

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });

    // Respect Retry-After if present
    if (r.status === 429) {
      const retryAfter = r.headers.get("retry-after");
      const text = await r.text();
      lastErr = new Error(`Token error 429: ${text}`);

      if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds > 0) {
          await sleep(seconds * 1000);
        }
      }
      continue;
    }

    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!r.ok) {
      lastErr = new Error(`Token error ${r.status}: ${JSON.stringify(data)}`);
      continue;
    }

    if (!data.access_token) {
      lastErr = new Error(`Token missing access_token: ${JSON.stringify(data)}`);
      continue;
    }

    // Cache token
    cachedToken = data.access_token;
    const expiresInSec = Number(data.expires_in || 3600);
    cachedTokenExpiresAt = Date.now() + expiresInSec * 1000;

    return cachedToken;
  }

  throw lastErr || new Error("Failed to get token");
}

async function getToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing GUESTY_CLIENT_ID or GUESTY_CLIENT_SECRET in Render env vars");
  }

  // Use cached token if valid for > 2 minutes
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 120_000) {
    return cachedToken;
  }

  // Single-flight: if a token request is already running, await it
  if (tokenInFlight) return tokenInFlight;

  tokenInFlight = (async () => {
    try {
      return await fetchTokenWithBackoff();
    } finally {
      tokenInFlight = null;
    }
  })();

  return tokenInFlight;
}

// ---------- Read-only PMC endpoint ----------
app.get("/pmc-summary", async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: "from and to required (YYYY-MM-DD)" });
    }

    const token = await getToken();

    const r = await fetch(
      `https://open-api.guesty.com/v1/financialReports/transactions?from=${encodeURIComponent(
        from
      )}&to=${encodeURIComponent(to)}&limit=100`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );

    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!r.ok) {
      return res.status(r.status).json({ error: "Guesty transactions error", data });
    }

    const results =
      Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];

    const pmc = results.filter((t) => (t?.type || "") === "PMC_COMMISSION");

    res.json({ from, to, count: pmc.length, results: pmc });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log("Server running on", PORT));
