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

// get access token
async function getToken() {
  const res = await fetch("https://auth.guesty.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  });

  const data = await res.json();
  return data.access_token;
}

// PMC commission endpoint
app.get("/pmc", async (req, res) => {
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
          Accept: "application/json"
        }
      }
    );

    const data = await r.json();

    // ONLY PMC commissions
    const pmc = data.results.filter(
      t => t.type === "PMC_COMMISSION"
    );

    res.json(pmc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
