// Settings the server code reads when it loads. The database URLs point nowhere, so a test that reached a
// real query would fail instead of touching any data.
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/never';
process.env.USERS_MONGODB_URI ||= 'mongodb://127.0.0.1:1/never';
process.env.JWT_SECRET ||= 'test-secret';
