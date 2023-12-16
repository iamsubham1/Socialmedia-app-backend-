
// Load environment variables from config.env file and capture the result
require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');

// MongoDB connection URI(using dotenv to access environment variable)
const mongoURI = process.env.MONGODB_URI;
// console.log(mongoURI)

// Function to connect to MongoDB
const connectToMongo = async () => {

    try {
        await mongoose.connect(mongoURI);
        console.log("Connected to MongoDB successfully");
    }
    catch (error) {
        console.log(error);
        process.exit();
    }
};

// Export the connectToMongo function for use in other parts of the application

module.exports = connectToMongo;