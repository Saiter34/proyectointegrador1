const { Pool } = require('pg');
require('dotenv').config();

console.log('--- Variables de Entorno en db.js ---');
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_PASSWORD:', process.env.DB_PASSWORD);
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_DATABASE:', process.env.DB_DATABASE);
console.log('-----------------------------------');

const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_DATABASE,
    ssl: false
});

pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error al conectar a PostgreSQL:', err.stack);
    }
    console.log('Conexión exitosa a PostgreSQL!');
    release();
});

module.exports = pool;