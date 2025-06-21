// src/prisma/seed.js

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function parseTimestamp(str) {
  let replaced = str.replace(" ", "T");
  replaced = replaced.replace(/\+(\d{2})(?!:)/, "+$1:00");
  return new Date(replaced);
}

async function main() {
  await prisma.subscriptionPlan.createMany({
    data: [
      {
        id: "cll9abc201",
        name: "Free",
        rangeOfUsers: "1",
        description: "A great way to explore BizBuddy with full access to essential timekeeping features",
        price: 0.0,
        features: {
          leaves: false,
          payroll: false,
          timekeeping: true,
          "timekeeping-punch-offline": false,
        },
      },
      {
        id: "cll9abc202",
        name: "Basic",
        rangeOfUsers: "2-9",
        description: "Ideal for growing businesses that need more control and insights into their team's productivity.",
        price: 25.99,
        features: {
          leaves: true,
          payroll: true,
          timekeeping: true,
          "timekeeping-punch-offline": false,
        },
      },
      {
        id: "cll9abc203",
        name: "Basic",
        rangeOfUsers: "10-19",
        description: "Ideal for growing businesses that need more control and insights into their team's productivity.",
        price: 39.99,
        features: {
          leaves: true,
          payroll: true,
          timekeeping: true,
          "timekeeping-punch-offline": false,
        },
      },
      {
        id: "cll9abc204",
        name: "Basic",
        rangeOfUsers: "20-49",
        description: "Ideal for growing businesses that need more control and insights into their team's productivity.",
        price: 69.99,
        features: {
          leaves: true,
          payroll: true,
          timekeeping: true,
          "timekeeping-punch-offline": false,
        },
      },
      {
        id: "cll9abc205",
        name: "Basic",
        rangeOfUsers: "50-99",
        description: "Ideal for growing businesses that need more control and insights into their team's productivity.",
        price: 119.99,
        features: {
          leaves: true,
          payroll: true,
          timekeeping: true,
          "timekeeping-punch-offline": false,
        },
      },
      {
        id: "cll9abc206",
        name: "Basic",
        rangeOfUsers: "100-200",
        description: "Ideal for growing businesses that need more control and insights into their team's productivity.",
        price: 169.99,
        features: {
          leaves: true,
          payroll: true,
          timekeeping: true,
          "timekeeping-punch-offline": false,
        },
      },
      {
        id: "cll9abc207",
        name: "Pro",
        rangeOfUsers: "2-9",
        description: "Designed for businesses that need full customization and scalability. Get all the tools you need to optimize workforce management.",
        price: 49.99,
        features: {
          leaves: true,
          payroll: true,
          timekeeping: true,
          "timekeeping-punch-offline": true,
        },
      },
      {
        id: "cll9abc208",
        name: "Pro",
        rangeOfUsers: "10-19",
        description: "Designed for businesses that need full customization and scalability. Get all the tools you need to optimize workforce management.",
        price: 59.99,
        features: {
          leaves: true,
          payroll: true,
          timekeeping: true,
          "timekeeping-punch-offline": true,
        },
      },
      {
        id: "cll9abc209",
        name: "Pro",
        rangeOfUsers: "20-49",
        description: "Designed for businesses that need full customization and scalability. Get all the tools you need to optimize workforce management.",
        price: 79.99,
        features: {
          leaves: true,
          payroll: true,
          timekeeping: true,
          "timekeeping-punch-offline": true,
        },
      },
      {
        id: "cll9abc210",
        name: "Pro",
        rangeOfUsers: "50-99",
        description: "Designed for businesses that need full customization and scalability. Get all the tools you need to optimize workforce management.",
        price: 129.99,
        features: {
          leaves: true,
          payroll: true,
          timekeeping: true,
          "timekeeping-punch-offline": true,
        },
      },
      {
        id: "cll9abc211",
        name: "Pro",
        rangeOfUsers: "100-200",
        description: "Designed for businesses that need full customization and scalability. Get all the tools you need to optimize workforce management.",
        price: 179.99,
        features: {
          leaves: true,
          payroll: true,
          timekeeping: true,
          "timekeeping-punch-offline": true,
        },
      },
    ],
    skipDuplicates: true,
  });

  console.log("SubscriptionPlan data seeded successfully!");

  await prisma.company.upsert({
    where: { id: "cm7lx48x70005vr3sk1bcnhcy" },
    update: {},
    create: {
      id: "cm7lx48x70005vr3sk1bcnhcy",
      name: "BizSolutions",
      userId: "cm7lx48wq0003vr3syh4jesxh",
      createdAt: parseTimestamp("2025-02-26 20:55:01.675+08"),
      updatedAt: parseTimestamp("2025-02-26 20:55:01.675+08"),
    },
  });

  await prisma.user.upsert({
    where: { id: "cm7lx48wq0003vr3syh4jesxh" },
    update: {},
    create: {
      id: "cm7lx48wq0003vr3syh4jesxh",
      username: "devfranco",
      email: "saintsfranco2@gmail.com",
      password: "$2a$10$xtzm29rE.TSo6nT.gJVtVuejUTjJcO1yf24yr78RhHEocZWH9.KEu",
      companyId: "cm7lx48x70005vr3sk1bcnhcy",
      role: "superadmin",
      status: "active",
      createdAt: parseTimestamp("2025-02-26 20:55:01.656+08"),
      updatedAt: parseTimestamp("2025-02-26 20:55:01.656+08"),
    },
  });

  await prisma.subscription.upsert({
    where: { id: "cm7lx48xe0007vr3svln2rxl4" },
    update: {},
    create: {
      id: "cm7lx48xe0007vr3svln2rxl4",
      userId: "cm7lx48wq0003vr3syh4jesxh",
      companyId: "cm7lx48x70005vr3sk1bcnhcy",
      planId: "cll9abc207",
      startDate: parseTimestamp("2025-02-26 20:55:01.682+08"),
      active: true,
      createdAt: parseTimestamp("2025-02-26 20:55:01.682+08"),
      updatedAt: parseTimestamp("2025-02-26 20:55:01.682+08"),
    },
  });

  await prisma.payment.upsert({
    where: { id: "cm7ixzxeb0008vrnsbsv789yh" },
    update: {},
    create: {
      id: "cm7ixzxeb0008vrnsbsv789yh",
      companyName: "BizSolutions",
      email: "saintsfranco2@gmail.com",
      amount: 25.99,
      paymentDate: parseTimestamp("2025-02-24 18:56:21.204+08"),
      createdAt: parseTimestamp("2025-02-24 18:56:21.204+08"),
      updatedAt: parseTimestamp("2025-02-24 18:56:21.204+08"),
    },
  });

  console.log("Additional data (Company, User, Subscription, Payment) seeded successfully!");
}

main()
  .catch((e) => {
    console.error("Error seeding data:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
