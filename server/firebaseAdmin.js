const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const credential = process.env.FIREBASE_PRIVATE_KEY
  ? cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    })
  : cert(require('./serviceAccountKey.json'));

const app = initializeApp({ credential });

module.exports = { auth: getAuth(app) };