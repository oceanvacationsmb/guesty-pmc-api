const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors({
  origin: "https://oceanvacationsmb.github.io"
}));

app.use(express.json());

let accessToken = null;
let expiresAt = 0;

async function getAccessToken() {
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
  expiresAt = Date.now() + (response.data.expires_in - 60) * 1000;

  return accessToken;
}

app.get("/reservations", async (req, res) => {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: "Missing from or to date" });
    }

    const token = await getAccessToken();

    const response = await axios.get(
      "https://open-api.guesty.com/v1/reservations",
      {
        headers: {
          Authorization: `Bearer ${token}`
        },
        params: {
          checkInDate: from,
          checkOutDate: to
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch reservations" });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
