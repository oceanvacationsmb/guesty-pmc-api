import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.GUESTY_CLIENT_ID;
const CLIENT_SECRET = process.env.GUESTY_CLIENT_SECRET;

const TOKEN_URL = "https://open-api.guesty.com/oauth2/token";
const TRANSACTIONS_URL =
  "https://open-api.guesty.com/v1/financialReports/transactions";

let cachedToken = null;
let tokenExpiresAt = 0;

// ================= TOKEN =================
async function getToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;

  const body = new URLSearchParams();
  body.append("grant_type", "client_credentials");

  const auth = Buffer.from(
    `${CLIENT_ID}:${CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: body.toString()
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Token error ${res.status}: ${text}`);
  }

  const json = JSON.parse(text);
  cachedToken = json.access_token;
  tokenExpiresAt = Date.now() + (json.expires_in - 60) * 1000;

  return cachedToken;
}

// ================= HEALTH =================
app.get("/", (_, res) => {
  res.send("Guesty PMC API running (READ ONLY)");
});

// ================= PMC SUMMARY =================
app.get("/pmc-summary", async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({
        error: "from and to dates required (YYYY-MM-DD)"
      });
    }

    const token = await getToken();

    const r = await fetch(
      `${TRANSACTIONS_URL}?from=${from}&to=${to}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      }
    );

    const raw = await r.text();
    if (!r.ok) {
      return res.status(500).json({
        error: "Guesty transactions error",
        data: raw
      });
    }

    const json = JSON.parse(raw);
    const rows = Array.isArray(json.results) ? json.results : [];

    // ONLY PMC COMMISSION
    const pmc = rows.filter(
      t => t.type === "PMC_COMMISSION"
    );

    // GROUP BY PROPERTY
    const summary = {};
    for (const t of pmc) {
      const name =
        t.listing?.title ||
        t.listing?.nickname ||
        "Unknown Property";

      summary[name] = (summary[name] || 0) + Number(t.amount || 0);
    }

    res.json({
      from,
      to,
      properties: summary,
      total_pmc: Object.values(summary).reduce((a, b) => a + b, 0)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Running on port ${PORT}`);
});
