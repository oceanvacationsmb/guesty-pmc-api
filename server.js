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

    console.log("FULL ERROR:");
    console.log(err.response?.data || err.message);

    res.status(500).json({
      error: err.response?.data || err.message
    });
  }
});
