// app.js

const express = require("express");
const cors = require("cors");
const morganMiddleware = require("@middlewares/morganMiddleware");
const { requestLogger } = require("@middlewares/requestLogger");
const cookieParser = require("cookie-parser");

const app = express();

app.use(
  cors({
    origin: ["http://localhost:19006", "https://mybizbuddy.co", "http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  })
);

app.use(cookieParser());

app.use(morganMiddleware);
app.use(requestLogger);

app.use((req, res, next) => {
  if (req.originalUrl.startsWith("/api/payments/stripe-webhook")) {
    next();
  } else {
    express.json()(req, res, next);
  }
});

module.exports = app;
