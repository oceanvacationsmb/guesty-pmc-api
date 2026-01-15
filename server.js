import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.GUESTY_CLIENT_ID;
const CLIENT_SECRET = process.env.GUESTY_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn("Missing GUESTY_CLIENT_ID or GUESTY_CLIENT_SECRET env vars");
}

const TOKEN_URL = "https://open-api.guesty.com/oauth2/token";
const OPEN_API_BASE = "https://open-api.guesty.com";

// simple in memory token cache
let cachedToken = null;
let tokenExpiresAtMs = 0;

function isValidDateString(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAtMs) return cachedToken;

  const body = new URLSearchParams();
  body.append("grant_type", "client_credentials");
  body.append("scope", "openid");

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  const text = await r.text();
  if (!r.ok) {
    throw new Error(`Token error ${r.status}: ${text}`);
  }

  const json = JSON.parse(text);
  const accessToken = json.access_token;
  const expiresInSec = Number(json.expires_in || 1800);

  cachedToken = accessToken;
  tokenExpiresAtMs = Date.now() + Math.max(60, expiresInSec - 60) * 1000; // refresh 60s early
  return cachedToken;
}

async function fetchTransactions(from, to) {
  const token = await getToken();

  const url = new URL(`${OPEN_API_BASE}/v1/financialReports/transactions`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);

  const r = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const text = await r.text();

  if (!r.ok) {
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    return {
      ok: false,
      status: r.status,
      raw: text,
      parsed,
      url: url.toString(),
    };
  }

  const data = JSON.parse(text);
  return { ok: true, data, url: url.toString() };
}

// health check
app.get("/", (req, res) => {
  res.send("Guesty PMC API running");
});

// summary endpoint
app.get("/pmc-summary", async (req, res) => {
  try {
    const { from, to } = req.query;

    if (!isValidDateString(from) || !isValidDateString(to)) {
      return res.status(400).json({
        error: "from and to required in YYYY-MM-DD format",
        example: "/pmc-summary?from=2026-01-01&to=2026-01-14",
      });
    }

    const tx = await fetchTransactions(from, to);

    if (!tx.ok) {
      return res.status(502).json({
        error: "Guesty transactions error",
        data: tx,
      });
    }

    const results = Array.isArray(tx.data?.results) ? tx.data.results : [];
    const pmcOnly = results.filter((t) => t?.type === "PMC_COMMISSION");

    const total = pmcOnly.reduce((sum, t) => {
      const amount = Number(t?.amount || 0);
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0);

    res.json({
      from,
      to,
      count: pmcOnly.length,
      total,
      items: pmcOnly,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});
