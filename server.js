import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.GUESTY_CLIENT_ID;
const CLIENT_SECRET = process.env.GUESTY_CLIENT_SECRET;

// Optional extra safety: block any non-GET requests to your API
app.use((req, res, next) => {
  const m = req.method.toUpperCase();
  if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
    return res.status(405).send("Method not allowed");
  }
  next();
});

app.get("/", (req, res) => {
  res.send("Guesty PMC API running");
});

// ---- Token cache to avoid 429 Too Many Requests ----
let cachedToken = null;
let cachedTokenExpiresAt = 0; // unix ms

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing GUESTY_CLIENT_ID or GUESTY_CLIENT_SECRET in Render env vars");
  }

  // Reuse token if it expires in > 60 seconds
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) {
    return cachedToken;
  }

  // Retry with backoff on 429
  const delays = [0, 1000, 2000, 4000]; // ms
  let lastErr = null;

  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await sleep(delays[i]);

    try {
      const r = await fetch("https://open-api.guesty.com/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET
        })
      });

      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      if (!r.ok) {
        // If rate limited, retry
        if (r.status === 429) {
          lastErr = new Error(`Token error 429: ${JSON.stringify(data)}`);
          continue;
        }
        throw new Error(`Token error ${r.status}: ${JSON.stringify(data)}`);
      }

      if (!data.access_token) {
        throw new Error(`Token missing access_token: ${JSON.stringify(data)}`);
      }

      cachedToken = data.access_token;

      // Guesty usually returns expires_in (seconds); fallback to 1 hour
      const expiresInSec = Number(data.expires_in || 3600);
      cachedTokenExpiresAt = Date.now() + expiresInSec * 1000;

      return cachedToken;
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("Failed to get token");
}

// ---- Read-only PMC endpoint ----
app.get("/pmc-summary", async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: "from and to required (YYYY-MM-DD)" });
    }

    const token = await getToken();

    const r = await fetch(
      `https://open-api.guesty.com/v1/financialReports/transactions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      }
    );

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!r.ok) {
      return res.status(r.status).json({ error: "Guesty transactions error", data });
    }

    const results =
      Array.isArray(data?.results) ? data.results :
      Array.isArray(data?.data) ? data.data :
      Array.isArray(data) ? data :
      [];

    const pmc = results.filter(t => (t?.type || "") === "PMC_COMMISSION");

    res.json({
      from,
      to,
      count: pmc.length,
      results: pmc
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log("Server running on", PORT);
});
