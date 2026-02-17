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

async function refreshAccessToken() {
  try {
    const response = await axios.post(
      "https://open-api.guesty.com/oauth2/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: process.env.GUESTY_REFRESH_TOKEN,
        client_id: process.env.GUESTY_CLIENT_ID,
        client_secret: process.env.GUESTY_CLIENT_SECRET
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }
    );

    accessToken = response.data.access_token;
    expiresAt = Date.now() + (response.data.expires_in * 1000);

    console.log("Access token refreshed");
  } catch (err) {
    console.error("Token refresh failed:", err.response?.data || err.message);
  }
}

async function getValidToken() {
  if (!accessToken || Date.now() >= expiresAt) {
    await refreshAccessToken();
  }
  return accessToken;
}

app.get("/reservations", async (req, res) => {
  try {
    const token = await getValidToken();

    const { from, to } = req.query;

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

    res.json(response.data);
  } catch (err) {
    console.error("Reservation fetch failed:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch reservations" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
