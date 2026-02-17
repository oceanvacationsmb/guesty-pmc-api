import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

const CLIENT_ID = process.env.GUESTY_CLIENT_ID;
const CLIENT_SECRET = process.env.GUESTY_CLIENT_SECRET;

let accessToken = null;
let tokenExpiresAt = 0;

/* ===========================
   GET ACCESS TOKEN (SAFE)
===========================*/
async function getAccessToken() {

  const now = Date.now();

  // ✅ Reuse token if still valid
  if (accessToken && now < tokenExpiresAt) {
    return accessToken;
  }

  console.log("Requesting new Guesty token...");

  try {
    const response = await axios.post(
      "https://open-api.guesty.com/oauth2/token",
      new URLSearchParams({
        grant_type: "client_credentials"
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        auth: {
          username: CLIENT_ID,
          password: CLIENT_SECRET
        }
      }
    );

    accessToken = response.data.access_token;

    // expire 1 minute earlier for safety
    tokenExpiresAt = now + (response.data.expires_in - 60) * 1000;

    console.log("Token acquired successfully");

    return accessToken;

  } catch (err) {
    console.error("Token error:", err.response?.data || err.message);
    throw new Error("Failed to get Guesty token");
  }
}

/* ===========================
   RESERVATIONS ENDPOINT
===========================*/
app.get("/reservations", async (req, res) => {

  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: "Missing from/to dates" });
  }

  try {

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
          limit: 200
        }
      }
    );

    return res.json(response.data.results || []);

  } catch (err) {

    console.error("Guesty error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to fetch reservations" });
  }
});

/* ===========================
   ROOT
===========================*/
app.get("/", (req, res) => {
  res.send("Guesty PMC API running");
});

/* ===========================
   START SERVER
===========================*/
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
