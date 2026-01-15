// server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();

/**
 * CORS
 * Set ALLOWED_ORIGINS to your site domain (recommended), e.g.:
 * https://oceanvacationsmb.github.io
 * https://pmc-commission.onrender.com
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // allow curl/postman
      if (allowedOrigins.includes("*")) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
  })
);

const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.GUESTY_CLIENT_ID;
const CLIENT_SECRET = process.env.GUESTY_CLIENT_SECRET;

// Keep these configurable so you can match whatever Guesty shows in their docs/portal
const GUESTY_BASE_URL = process.env.GUESTY_BASE_URL || "https://open-api.guesty.com";
const TOKEN_URL = process.env.GUESTY_TOKEN_URL || `${GUESTY_BASE_URL}/oauth2/token`;

// READ ONLY: this service only performs GET requests to read data and never calls any update endpoints.

function requireEnv() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    const msg =
      "Missing env vars: GUESTY_CLIENT_ID and/or GUESTY_CLIENT_SECRET. Add them in Render → Environment.";
    const err = new Error(msg);
    err.statusCode = 500;
    throw err;
  }
}

function parseDateParam(v, name) {
  if (!v) throw new Error(`Missing query param: ${name}`);
  // Accept YYYY-MM-DD only
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`Invalid ${name}. Use YYYY-MM-DD`);
  return v;
}

async function getToken() {
  requireEnv();

  // Client Credentials OAuth2
  // Many providers accept either form-encoded with client_id/client_secret
  // or Basic auth. We'll do form-encoded + Basic to maximize compatibility.
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Token response not JSON: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(`Token error (${res.status}): ${JSON.stringify(json)}`);
  }

  const token = json.access_token || json.token || json.accessToken;
  if (!token) throw new Error(`Token missing in response: ${JSON.stringify(json)}`);

  return token;
}

/**
 * Fetch transactions with pagination.
 * We keep param names flexible (Guesty can vary). We try common patterns.
 */
async function fetchAllTransactions({ from, to }) {
  const token = await getToken();

  const limit = Number(process.env.GUESTY_PAGE_LIMIT || 100);
  let skip = 0;
  let all = [];

  while (true) {
    const url = new URL(`${GUESTY_BASE_URL}/v1/financialReports/transactions`);

    // Common query param patterns:
    // from/to, fromDate/toDate, startDate/endDate
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);

    // Pagination patterns:
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("skip", String(skip));

    const r = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Transactions response not JSON: ${text.slice(0, 300)}`);
    }

    if (!r.ok) {
      throw new Error(`Transactions error (${r.status}): ${JSON.stringify(data)}`);
    }

    // Guesty responses sometimes return: {results:[...]} or {data:[...]} etc
    const page =
      (Array.isArray(data?.results) && data.results) ||
      (Array.isArray(data?.data) && data.data) ||
      (Array.isArray(data?.transactions) && data.transactions) ||
      (Array.isArray(data) && data) ||
      [];

    all = all.concat(page);

    if (page.length < limit) break; // done
    skip += limit;

    // safety cap
    if (skip > 50000) break;
  }

  return all;
}

function safeNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function extractListingId(t) {
  // Try common fields
  return (
    t?.listingId ||
    t?.listing?._id ||
    t?.listing?.id ||
    t?.listing ||
    t?.entityId ||
    t?.entity?._id ||
    t?.entity?.id ||
    null
  );
}

function extractListingName(t) {
  return (
    t?.listing?.title ||
    t?.listing?.nickname ||
    t?.listing?.name ||
    t?.listingTitle ||
    t?.listingName ||
    null
  );
}

function extractAmount(t) {
  // Try common amount fields
  return (
    safeNumber(t?.amount) ||
    safeNumber(t?.netAmount) ||
    safeNumber(t?.total) ||
    safeNumber(t?.value) ||
    0
  );
}

function isPmcCommission(t) {
  const type = (t?.type || t?.transactionType || "").toString().toUpperCase();
  return type === "PMC_COMMISSION";
}

// Health / root
app.get("/", (req, res) => {
  res.send("Guesty PMC API running");
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/**
 * Raw PMC commission transactions (filtered)
 * GET /commissions?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
app.get("/commissions", async (req, res) => {
  try {
    const from = parseDateParam(req.query.from, "from");
    const to = parseDateParam(req.query.to, "to");

    const tx = await fetchAllTransactions({ from, to });
    const pmc = tx.filter(isPmcCommission);

    res.json({
      from,
      to,
      count: pmc.length,
      results: pmc,
    });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || String(e) });
  }
});

/**
 * Summary per property (this is what your page should use)
 * GET /pmc-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns:
 * [
 *   { listingId, listingName, pmcTotal, salesRate, salesCommission }
 * ]
 *
 * salesRate is pulled from your mapping:
 * - Set SALES_RATE_DEFAULT=0.05 (optional)
 * - Add SALES_RATE_<LISTING_ID>=0.10 for specific properties
 */
app.get("/pmc-summary", async (req, res) => {
  try {
    const from = parseDateParam(req.query.from, "from");
    const to = parseDateParam(req.query.to, "to");

    const tx = await fetchAllTransactions({ from, to });
    const pmc = tx.filter(isPmcCommission);

    const totals = new Map();

    for (const t of pmc) {
      const listingId = extractListingId(t) || "UNKNOWN";
      const listingName = extractListingName(t) || "";

      const amt = extractAmount(t);

      const key = String(listingId);
      const cur = totals.get(key) || { listingId: key, listingName, pmcTotal: 0 };
      cur.pmcTotal += amt;

      // keep name if we got it later
      if (!cur.listingName && listingName) cur.listingName = listingName;

      totals.set(key, cur);
    }

    const defaultRate = safeNumber(process.env.SALES_RATE_DEFAULT || 0.05);

    const out = Array.from(totals.values())
      .map((row) => {
        const specific = process.env[`SALES_RATE_${row.listingId}`];
        const salesRate = specific !== undefined ? safeNumber(specific) : defaultRate;
        const salesCommission = row.pmcTotal * salesRate;

        return {
          listingId: row.listingId,
          listingName: row.listingName,
          pmcTotal: Number(row.pmcTotal.toFixed(2)),
          salesRate,
          salesCommission: Number(salesCommission.toFixed(2)),
        };
      })
      .sort((a, b) => b.pmcTotal - a.pmcTotal);

    res.json({ from, to, count: out.length, results: out });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
