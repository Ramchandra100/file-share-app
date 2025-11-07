const mongoose = require('mongoose');
require('dotenv').config();

console.log('Testing MongoDB connection...');
console.log('URI:', process.env.MONGODB_URI);

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ SUCCESS: Connected to MongoDB!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ FAILED:', err.message);
    console.log('Please check:');
    console.log('1. Database user exists in MongoDB Atlas');
    console.log('2. Network Access allows 0.0.0.0/0');
    console.log('3. Password is correct in connection string');
    process.exit(1);
  });