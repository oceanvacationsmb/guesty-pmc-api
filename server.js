import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.GUESTY_CLIENT_ID;
const CLIENT_SECRET = process.env.GUESTY_CLIENT_SECRET;

/* health check */
app.get("/", (req, res) => {
  res.send("Guesty PMC API running");
});

/* get token */
async function getToken() {
  const r = await fetch("https://auth.guesty.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  });

  const data = await r.json();
  if (!data.access_token) {
    throw new Error(JSON.stringify(data));
  }

  return data.access_token;
}

/* PMC summary endpoint (READ ONLY) */
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
          Accept: "application/json"
        }
      }
    );

    const data = await r.json();

    const pmc = (data.results || []).filter(
      t => t.type === "PMC_COMMISSION"
    );

    res.json(pmc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Running on ${PORT}`);
});
