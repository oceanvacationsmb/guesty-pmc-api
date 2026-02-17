import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

const GUESTY_CLIENT_ID = process.env.GUESTY_CLIENT_ID;
const GUESTY_CLIENT_SECRET = process.env.GUESTY_CLIENT_SECRET;

let cachedToken = null;
let tokenExpiry = 0;

/* ===============================
   GET ACCESS TOKEN (with caching)
=================================*/
async function getAccessToken() {
  const now = Date.now();

  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  try {
    const response = await axios.post(
      "https://open-api.guesty.com/oauth2/token",
      {
        grant_type: "client_credentials",
        scope: "open-api"
      },
      {
        auth: {
          username: GUESTY_CLIENT_ID,
          password: GUESTY_CLIENT_SECRET
        }
      }
    );

    cachedToken = response.data.access_token;
    tokenExpiry = now + (response.data.expires_in - 60) * 1000;

    return cachedToken;

  } catch (err) {
    console.error("Token error:", err.response?.data || err.message);
    throw new Error("Failed to get Guesty token");
  }
}

/* ===============================
   HELPER DELAY FUNCTION
=================================*/
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ===============================
   FETCH RESERVATIONS
=================================*/
app.get("/reservations", async (req, res) => {
  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: "Missing from/to dates" });
  }

  try {
    const token = await getAccessToken();

    let allReservations = [];
    let skip = 0;
    const limit = 100;

    while (true) {
      try {

        const response = await axios.get(
          "https://open-api.guesty.com/v1/reservations",
          {
            headers: {
              Authorization: `Bearer ${token}`
            },
            params: {
              checkInFrom: from,
              checkInTo: to,
              limit: limit,
              skip: skip
            }
          }
        );

        const results = response.data.results || [];

        allReservations.push(...results);

        if (results.length < limit) break;

        skip += limit;

        // 🔥 small delay to prevent rate limits
        await sleep(400);

      } catch (err) {

        if (err.response?.status === 429) {
          console.log("Rate limited. Waiting 2 seconds...");
          await sleep(2000);
          continue;
        }

        console.error("Guesty fetch error:", err.response?.data || err.message);
        return res.status(500).json({ error: "Guesty API error" });
      }
    }

    return res.json(allReservations);

  } catch (err) {
    console.error("Server error:", err.message);
    return res.status(500).json({ error: "Failed to fetch reservations" });
  }
});

/* ===============================
   HEALTH CHECK
=================================*/
app.get("/", (req, res) => {
  res.send("Guesty PMC API running");
});

/* ===============================
   START SERVER
=================================*/
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
