import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

let cachedToken = null;
let tokenExpiresAt = null;

// ===============================
// GET ACCESS TOKEN (WITH CACHE)
// ===============================
async function getAccessToken() {

  if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  try {

    const response = await axios.post(
      "https://open-api.guesty.com/oauth2/token",
      new URLSearchParams({
        grant_type: "client_credentials",
        scope: "open-api"
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
          "Authorization":
            "Basic " +
            Buffer.from(
              process.env.GUESTY_CLIENT_ID +
                ":" +
                process.env.GUESTY_CLIENT_SECRET
            ).toString("base64")
        }
      }
    );

    cachedToken = response.data.access_token;

    // expire 1 minute early for safety
    tokenExpiresAt =
      Date.now() + (response.data.expires_in - 60) * 1000;

    console.log("New Guesty token acquired");

    return cachedToken;

  } catch (err) {
    console.error("Token error:", err.response?.data || err.message);
    throw new Error("Failed to get Guesty token");
  }
}

// ===============================
// ROOT
// ===============================
app.get("/", (req, res) => {
  res.send("Guesty PMC API running");
});

// ===============================
// RESERVATIONS ENDPOINT
// ===============================
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
          limit: 2000
        }
      }
    );

    res.json(response.data);

  } catch (err) {
    console.error("Server error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch reservations" });
  }
});

// ===============================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
