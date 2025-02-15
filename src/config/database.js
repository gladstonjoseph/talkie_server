const { Pool } = require("pg");

const pool = new Pool({
  connectionString: "postgresql://talkie_db_qzri_user:KNmfCEUNZrYkyvSo8Kl1NGf8rcUHUyvS@dpg-cuc40s3qf0us73c5gg8g-a.oregon-postgres.render.com/talkie_db_qzri",
  ssl: {
    rejectUnauthorized: false
  }
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to the database:', err.stack);
  } else {
    console.log('Connected to database successfully');
    release();
  }
});

module.exports = pool; 