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

async function getToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing GUESTY_CLIENT_ID or GUESTY_CLIENT_SECRET in Render env vars");
  }

  // IMPORTANT: correct token endpoint
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
    throw new Error(`Token error ${r.status}: ${JSON.stringify(data)}`);
  }

  if (!data.access_token) {
    throw new Error(`Token missing access_token: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

app.get("/pmc-summary", async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: "from and to required (YYYY-MM-DD)" });

    const token = await getToken();

    const r = await fetch(
      `https://open-api.guesty.com/v1/financialReports/transactions?from=${from}&to=${to}&limit=100`,
      {
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

    const results = Array.isArray(data?.results) ? data.results : [];
    const pmc = results.filter(t => (t?.type || "") === "PMC_COMMISSION");

    res.json(pmc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log("Server running on", PORT));
