const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config();
const app = require('./src/app');
const { connectDB } = require('./src/config/db');

const PORT = process.env.PORT || 3000;

async function startServer() {
  // Connect to DB (with resilient fallback)
  await connectDB();

  app.listen(PORT, () => {
    console.log(`Inspectra Backend running on port ${PORT}`);
  });
}

startServer();
