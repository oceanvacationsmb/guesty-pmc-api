import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.GUESTY_CLIENT_ID;
const CLIENT_SECRET = process.env.GUESTY_CLIENT_SECRET;

// health check
app.get("/", (req, res) => {
  res.send("Guesty PMC API running");
});

// token fetch (READ ONLY)
async function getToken() {
  const body = new URLSearchParams();
  body.append("grant_type", "client_credentials");

  const auth = Buffer.from(
    `${CLIENT_ID}:${CLIENT_SECRET}`
  ).toString("base64");

  const r = await fetch("https://auth.guesty.com/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(text);
  }

  const data = await r.json();
  return data.access_token;
}

// PMC summary endpoint (READ ONLY)
app.get("/pmc-summary", async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: "from and to required" });
    }

    const token = await getToken();

    const r = await fetch(
      `https://open-api.guesty.com/v1/financialReports/transactions?from=${from}&to=${to}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );

    const data = await r.json();

    const pmc = (data.results || []).filter(
      (t) => t.type === "PMC_COMMISSION"
    );

    res.json(pmc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
