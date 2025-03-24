// File: prisma/seed.js
//
// This seed script inserts:
// 1) SubscriptionPlan records (11 static plan entries, including "Free", "Basic", and "Pro")
// 2) A Company record
// 3) A User record
// 4) A Subscription record
// 5) A Payment record
//
// You can run this script manually via:
//    node prisma/seed.js
//
// Ensure your .env has DATABASE_URL set to the correct Postgres DB
// and that you have run `npx prisma migrate dev` to initialize the schema.

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * Converts timestamps like "2025-02-26 20:55:01.675+08"
 * into something JS can parse, e.g. "2025-02-26T20:55:01.675+08:00"
 */
function parseTimestamp(str) {
  // For example: "2025-02-26 20:55:01.675+08"
  // => "2025-02-26T20:55:01.675+08:00"
  //
  // 1) Replace the space with 'T' => "2025-02-26T20:55:01.675+08"
  // 2) Insert ':00' into the final offset => "2025-02-26T20:55:01.675+08:00"
  //
  // If the offset is +08, we’ll convert that to +08:00
  // You could adapt this logic for other offsets if needed.
  let replaced = str.replace(" ", "T");
  // If the string ends with e.g. "+08", append ":00"
  replaced = replaced.replace(/\+(\d{2})(?!:)/, "+$1:00");

  // Now parse as a Date
  return new Date(replaced);
}

async function main() {
  // 1) Create SubscriptionPlan entries using createMany
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

  //
  // 2) Upsert (Company, User, Subscription, Payment)
  //

  // Upsert the Company
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

  // Upsert the User
  await prisma.user.upsert({
    where: { id: "cm7lx48wq0003vr3syh4jesxh" },
    update: {},
    create: {
      id: "cm7lx48wq0003vr3syh4jesxh",
      username: "devfranco",
      email: "saintsfranco2@gmail.com",
      password: "$2a$10$xtzm29rE.TSo6nT.gJVtVuejUTjJcO1yf24yr78RhHEocZWH9.KEu",
      companyId: "cm7lx48x70005vr3sk1bcnhcy",
      role: "superadmin", // Must match your userRole enum
      status: "active", // Must match your userStatus enum
      createdAt: parseTimestamp("2025-02-26 20:55:01.656+08"),
      updatedAt: parseTimestamp("2025-02-26 20:55:01.656+08"),
    },
  });

  // Upsert the Subscription
  await prisma.subscription.upsert({
    where: { id: "cm7lx48xe0007vr3svln2rxl4" },
    update: {},
    create: {
      id: "cm7lx48xe0007vr3svln2rxl4",
      userId: "cm7lx48wq0003vr3syh4jesxh",
      companyId: "cm7lx48x70005vr3sk1bcnhcy",
      planId: "cll9abc207", // Must match plan from above
      startDate: parseTimestamp("2025-02-26 20:55:01.682+08"),
      active: true,
      createdAt: parseTimestamp("2025-02-26 20:55:01.682+08"),
      updatedAt: parseTimestamp("2025-02-26 20:55:01.682+08"),
    },
  });

  // Upsert the Payment
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
