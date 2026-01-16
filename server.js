import express from "express";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/*
ENV VARS YOU MUST SET ON RENDER
GUESTY_CLIENT_ID
GUESTY_CLIENT_SECRET
*/

const TOKEN_URL = "https://open-api.guesty.com/oauth2/token";
const OAPI_BASE = "https://open-api.guesty.com/v1";

let tokenCache = {
  accessToken: null,
  expiresAtMs: 0
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchToken() {
  const clientId = process.env.GUESTY_CLIENT_ID;
  const clientSecret = process.env.GUESTY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing env vars GUESTY_CLIENT_ID or GUESTY_CLIENT_SECRET");
  }

  const now = Date.now();
  if (tokenCache.accessToken && now < tokenCache.expiresAtMs - 60_000) {
    return tokenCache.accessToken;
  }

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("scope", "open-api");
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);

  let lastErr = null;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      });

      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }

      if (!res.ok) {
        if (res.status === 429) {
          const backoffMs = 1000 * attempt * attempt;
          await sleep(backoffMs);
          lastErr = new Error(`Token error 429: ${text}`);
          continue;
        }
        throw new Error(`Token error ${res.status}: ${text}`);
      }

      const accessToken = json.access_token;
      const expiresIn = Number(json.expires_in || 3600);

      tokenCache.accessToken = accessToken;
      tokenCache.expiresAtMs = Date.now() + expiresIn * 1000;

      return accessToken;
    } catch (e) {
      lastErr = e;
      await sleep(250 * attempt);
    }
  }

  throw lastErr || new Error("Token fetch failed");
}

function parseISODate(value, name) {
  if (!value) throw new Error(`Missing query param: ${name}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid ${name}. Use YYYY-MM-DD`);
  return value;
}

/*
You configure sales commission per property here.
KEY must match listing id (preferred) OR listing nickname/title (fallback).
Examples:
"65a1b2c3d4e5f6a7b8c9d0e1": 0.10
"Beach House 7BR": 0.05
*/
const SALES_RATE_MAP = {
  // "LISTING_ID_HERE": 0.10,
  // "ANOTHER_LISTING_ID": 0.05
};

/*
Goal
Return PMC totals per property for a date range, then compute sales commission
PMC total = sum of journal lines that represent PMC income
This uses Guesty Accounting endpoints (accounting add-on users).
Docs show journal entries endpoint exists. :contentReference[oaicite:5]{index=5}
*/
async function fetchJournalEntries(token, from, to) {
  const url = new URL(`${OAPI_BASE}/accounting-api/journal-entries/all`);

  url.searchParams.set("from", from);
  url.searchParams.set("to", to);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "accept": "application/json",
      "authorization": `Bearer ${token}`
    }
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!res.ok) {
    const msg = typeof json === "object" ? JSON.stringify(json) : String(text);
    throw new Error(`Guesty journal entries error ${res.status}: ${msg}`);
  }

  return json;
}

function normalizeNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/*
This is intentionally defensive because accounting payloads differ per account.
We look for amounts and a listing identifier inside each entry line.
We only count lines that look like PMC income (keywords).
*/
function extractPmcByProperty(journalPayload) {
  const rows = [];

  const items = Array.isArray(journalPayload?.results)
    ? journalPayload.results
    : Array.isArray(journalPayload)
      ? journalPayload
      : Array.isArray(journalPayload?.data)
        ? journalPayload.data
        : [];

  for (const entry of items) {
    const lines = Array.isArray(entry?.lines) ? entry.lines : Array.isArray(entry?.entries) ? entry.entries : [];

    for (const line of lines) {
      const blob = JSON.stringify(line).toLowerCase();

      const looksLikePmc =
        blob.includes("pmc") ||
        blob.includes("property management") ||
        blob.includes("management fee") ||
        blob.includes("management commission") ||
        blob.includes("pmc commission");

      if (!looksLikePmc) continue;

      const amount =
        normalizeNumber(line.amount) ||
        normalizeNumber(line.total) ||
        normalizeNumber(line.value) ||
        normalizeNumber(line.credit) ||
        0;

      if (!amount) continue;

      const listingId =
        line.listingId ||
        line.propertyId ||
        line.listing?.id ||
        entry.listingId ||
        entry.propertyId ||
        entry.listing?.id ||
        null;

      const listingName =
        line.listingName ||
        line.propertyName ||
        line.listing?.title ||
        entry.listingName ||
        entry.propertyName ||
        entry.listing?.title ||
        null;

      const key = listingId || listingName || "UNKNOWN";

      rows.push({
        key,
        listingId: listingId || null,
        listingName: listingName || null,
        amount
      });
    }
  }

  const totals = new Map();
  for (const r of rows) {
    totals.set(r.key, (totals.get(r.key) || 0) + r.amount);
  }

  const result = [];
  for (const [key, pmcTotal] of totals.entries()) {
    const rate = SALES_RATE_MAP[key] ?? 0;
    result.push({
      propertyKey: key,
      pmcTotal: Number(pmcTotal.toFixed(2)),
      salesRate: rate,
      salesCommission: Number((pmcTotal * rate).toFixed(2))
    });
  }

  result.sort((a, b) => b.pmcTotal - a.pmcTotal);
  const grandPMC = result.reduce((s, x) => s + x.pmcTotal, 0);
  const grandSales = result.reduce((s, x) => s + x.salesCommission, 0);

  return {
    properties: result,
    totals: {
      pmcTotal: Number(grandPMC.toFixed(2)),
      salesCommission: Number(grandSales.toFixed(2))
    }
  };
}

app.get("/health", (req, res) => {
  res.json({ ok: true, mode: "READ_ONLY" });
});

/*
This is the route your webpage should call
GET /commissions?from=YYYY-MM-DD&to=YYYY-MM-DD
*/
app.get("/commissions", async (req, res) => {
  try {
    const from = parseISODate(req.query.from, "from");
    const to = parseISODate(req.query.to, "to");

    const token = await fetchToken();
    const journal = await fetchJournalEntries(token, from, to);
    const summary = extractPmcByProperty(journal);

    res.json({
      from,
      to,
      readOnly: true,
      summary
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
