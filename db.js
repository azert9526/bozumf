const { Pool } = require('pg');

const pool  = new Pool({
    user: 'your_username',
    host: 'localhost',
    database: 'your_database',
    password: 'your_password',
    port: 5432,
})

// logging de conexiune
pool.on('connect', () => {
    console.log('Connected to the database');
})

module.exports = pool;

