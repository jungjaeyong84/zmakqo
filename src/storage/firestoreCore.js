// src/storage/firestoreCore.js
const admin = require("firebase-admin");

function getFirestore() {
  if (!admin.apps.length) {
    // GOOGLE_APPLICATION_CREDENTIALS / GOOGLE_CLOUD_PROJECT 환경변수 기반
    admin.initializeApp();
  }
  return admin.firestore();
}

module.exports = { getFirestore };
