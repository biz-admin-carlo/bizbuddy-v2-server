// src/config/firebase.js
const admin = require("firebase-admin");

let initialized = false;

function initFirebase() {
  if (initialized) return admin;

  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } =
    process.env;

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    console.warn(
      "Firebase Admin not fully configured. Skipping initialization."
    );
    return null;
  }

  try {
    const privateKey = FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
    initialized = true;
    return admin;
  } catch (err) {
    console.error("Firebase Admin init error:", err);
    return null;
  }
}

function getMessaging() {
  if (!initialized) {
    const res = initFirebase();
    if (!res) return null;
  }
  try {
    return admin.messaging();
  } catch (err) {
    console.error("Firebase messaging not available:", err);
    return null;
  }
}

module.exports = { initFirebase, getMessaging };
