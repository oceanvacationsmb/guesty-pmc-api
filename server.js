import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

const app = express();

app.use(cors({
  origin: "https://oceanvacationsmb.github.io"
}));

app.use(express.json());

let accessToken = null;
let expiresAt = 0;

/* =========================
   GET ACCESS TOKEN
========================= */
await new Promise(resolve => setTimeout(resolve, 1200));
async function getAccessToken() {

  // If token still valid, reuse it
  if (accessToken && Date.now() < expiresAt) {
    return accessToken;
  }

  const response = await axios.post(
    "https://open-api.guesty.com/oauth2/token",
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.GUESTY_CLIENT_ID,
      client_secret: process.env.GUESTY_CLIENT_SECRET
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );

  accessToken = response.data.access_token;

  // expires_in is in seconds
  expiresAt = Date.now() + (response.data.expires_in * 1000);

  return accessToken;
}

/* =========================
   RESERVATIONS ENDPOINT
========================= */
console.log("Incoming request:", req.query);
app.get("/reservations", async (req, res) => {

  try {

    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: "Missing from/to dates" });
    }

    const token = await getAccessToken();

    const response = await axios.get(
      "https://open-api.guesty.com/v1/reservations",
      {
        headers: {
          Authorization: `Bearer ${token}`
        },
        params: {
          checkInFrom: from,
          checkInTo: to,
          statementId: statementUrl
        }
      }
    );

    res.json(response.data);

  } catch (err) {

    console.error(err.response?.data || err.message);

    res.status(500).json({
      error: "Failed to fetch reservations"
    });
  }
});

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
