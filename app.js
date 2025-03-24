// app.js

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const app = express();

app.use(
  cors({
    origin: ["http://localhost:19006", "https://mybizbuddy.co", "http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(cookieParser());

app.use((req, res, next) => {
  if (req.originalUrl.startsWith("/api/payments/stripe-webhook")) {
    next();
  } else {
    express.json()(req, res, next);
  }
});

module.exports = app;
