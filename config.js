const fs = require('fs');
if (fs.existsSync('config.env')) require('dotenv').config({ path: './config.env' });

function convertToBool(text, fault = 'true') {
    return text === fault ? true : false;
}
module.exports = {
SESSION_ID: process.env.SESSION_ID || "HIcX3QZS#ga-fQ6AI56L9eMiazrk-Y9lOn26KQjFDjdaL1u9e738",
MONGODB: process.env.MONGODB || "mongodb://mongo:CDtKUSOqoMKqImVzlWQfeXhKLltXPdPK@hopper.proxy.rlwy.net:12391",
};
