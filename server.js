import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.GUESTY_CLIENT_ID;
const CLIENT_SECRET = process.env.GUESTY_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing env vars: GUESTY_CLIENT_ID / GUESTY_CLIENT_SECRET");
}

const TOKEN_URL = "https://open-api.guesty.com/oauth2/token";
const TRANSACTIONS_URL = "https://open-api.guesty.com/v1/financialReports/transactions";

let cachedToken = null; // { access_token, expires_at_ms }

function toBasicAuth(id, secret) {
  return Buffer.from(`${id}:${secret}`).toString("base64");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getToken() {
  const now = Date.now();

  if (cachedToken?.access_token && cachedToken?.expires_at_ms && now < cachedToken.expires_at_ms) {
    return cachedToken.access_token;
  }

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("scope", "open-api");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${toBasicAuth(CLIENT_ID, CLIENT_SECRET)}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Token error ${res.status}: ${text}`);
  }

  const json = JSON.parse(text);

  const expiresInSec = Number(json.expires_in || 3600);
  cachedToken = {
    access_token: json.access_token,
    expires_at_ms: Date.now() + (expiresInSec - 60) * 1000
  };

  return cachedToken.access_token;
}

async function fetchGuestyTransactions({ from, to }) {
  const token = await getToken();

  const url = new URL(TRANSACTIONS_URL);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  const contentType = res.headers.get("content-type") || "";
  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`Guesty transactions error ${res.status}: ${raw}`);
  }

  if (!contentType.includes("application/json")) {
    throw new Error(`Guesty transactions error: non-JSON response: ${raw}`);
  }

  return JSON.parse(raw);
}

function parseDateParam(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

app.get("/", (req, res) => {
  res.send("Guesty PMC API running");
});

app.get("/commissions", async (req, res) => {
  try {
    const { from, to } = req.query;

    if (!parseDateParam(from) || !parseDateParam(to)) {
      return res.status(400).json({ error: "from and to are required in YYYY-MM-DD format" });
    }

    const data = await fetchGuestyTransactions({ from, to });

    const results = Array.isArray(data?.results) ? data.results : [];
    const pmc = results.filter((t) => t?.type === "PMC_COMMISSION");

    return res.json(pmc);
  } catch (e) {
    const msg = String(e?.message || e);

    if (msg.includes("Token error 429")) {
      return res.status(429).json({
        error: "Token rate limited by Guesty (429). Stop retrying and wait. Your code now caches tokens to avoid this.",
        details: msg
      });
    }

    return res.status(500).json({ error: msg });
  }
});

app.get("/pmc-summary", async (req, res) => {
  try {
    const { from, to } = req.query;

    if (!parseDateParam(from) || !parseDateParam(to)) {
      return res.status(400).json({ error: "from and to are required in YYYY-MM-DD format" });
    }

    const data = await fetchGuestyTransactions({ from, to });

    const results = Array.isArray(data?.results) ? data.results : [];
    const pmc = results.filter((t) => t?.type === "PMC_COMMISSION");

    const total = pmc.reduce((sum, t) => {
      const val =
        Number(t?.amount) ||
        Number(t?.netAmount) ||
        Number(t?.value) ||
        0;
      return sum + val;
    }, 0);

    return res.json({
      from,
      to,
      count: pmc.length,
      total,
      items: pmc
    });
  } catch (e) {
    const msg = String(e?.message || e);

    if (msg.includes("Token error 429")) {
      return res.status(429).json({
        error: "Token rate limited by Guesty (429). Stop retrying and wait. Your code now caches tokens to avoid this.",
        details: msg
      });
    }

    return res.status(500).json({ error: msg });
  }
});

app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});
