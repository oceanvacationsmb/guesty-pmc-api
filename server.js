import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;

/* =====================================================
   TOKEN CACHE
===================================================== */

let accessToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();

  // If token still valid, reuse it
  if (accessToken && now < tokenExpiresAt) {
    return accessToken;
  }

  try {
    const response = await axios.post(
      "https://open-api.guesty.com/oauth2/token",
      {
        grant_type: "client_credentials",
        client_id: process.env.GUESTY_CLIENT_ID,
        client_secret: process.env.GUESTY_CLIENT_SECRET
      }
    );

    accessToken = response.data.access_token;

    // expires_in comes in seconds
    tokenExpiresAt = now + (response.data.expires_in - 60) * 1000;

    console.log("New Guesty token generated");

    return accessToken;

  } catch (error) {
    console.error("Token error:", error.response?.data || error.message);
    throw new Error("Failed to get Guesty token");
  }
}

/* =====================================================
   HEALTH CHECK
===================================================== */

app.get("/", (req, res) => {
  res.send("Guesty PMC API running");
});

/* =====================================================
   RESERVATIONS ENDPOINT
===================================================== */

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
          include: "financials"
        }
      }
    );

    res.json(response.data);

  } catch (error) {
    console.error("Server error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch reservations" });
  }
});

/* =====================================================
   START SERVER
===================================================== */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
