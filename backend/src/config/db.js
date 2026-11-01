const mongoose = require('mongoose');

let isConnected = false;

async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/devpilot';
  
  if (isConnected) {
    return true;
  }

  try {
    // Attempt connection with a short 3-second timeout for local dev resilience
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 3000,
    });
    isConnected = true;
    console.log('MongoDB connected successfully:', uri.replace(/\/\/.*@/, '//***@'));
    return true;
  } catch (error) {
    console.warn('MongoDB connection unavailable. Operating in resilient file-backed storage mode.');
    console.warn('Reason:', error.message);
    isConnected = false;
    return false;
  }
}

function getIsConnected() {
  return isConnected;
}

module.exports = { connectDB, getIsConnected };

