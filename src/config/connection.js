// src/config/connection.js

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function connect() {
  try {
    await prisma.$connect();
    console.log("Database connected successfully.");
  } catch (error) {
    console.error("Database connection error:", error);
    throw error;
  }
}

module.exports = { prisma, connect };
