const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

let credential;

if (process.env.FIREBASE_PRIVATE_KEY) {
  credential = cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  });
} else {
  credential = cert(require('./serviceAccountKey.json'));
}

const app = getApps().length
  ? getApps()[0]
  : initializeApp({ credential });

module.exports = { auth: getAuth(app) };