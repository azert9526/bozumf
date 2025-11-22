const { Pool } = require('pg');

const pool  = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'visionproxy',
    password: 'postgres',
    port: 5432,
});

// logging de conexiune
pool.on('connect', () => {
    console.log('Connected to the database');
})

module.exports = pool;

