        // Backend/db.js
        const { Pool } = require('pg'); // Importa la clase Pool de 'pg'
        const path = require('path');
        // Asegúrate de cargar dotenv para acceder a las variables de entorno para la DB
        require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

        console.log('--- Variables de Entorno en db.js ---');
        console.log('DB_USER:', process.env.DB_USER);
        console.log('DB_PASSWORD:', process.env.DB_PASSWORD);
        console.log('DB_HOST:', process.env.DB_HOST);
        console.log('DB_DATABASE:', process.env.DB_DATABASE);
        console.log('DB_PORT:', process.env.DB_PORT);
        console.log('-----------------------------------');

        // Crea una nueva instancia de Pool con tus credenciales de base de datos
        const pool = new Pool({
            user: process.env.DB_USER,
            host: process.env.DB_HOST,
            database: process.env.DB_DATABASE,
            password: process.env.DB_PASSWORD,
            port: process.env.DB_PORT,
            ssl: false // Establece a 'true' si tu base de datos requiere SSL.
        });

        // Función para conectar y verificar la DB al inicio (opcional, pero útil)
        pool.connect((err, client, done) => {
            if (err) {
                console.error('Error al conectar a PostgreSQL:', err.stack);
                return;
            }
            console.log('Conexión exitosa a PostgreSQL!');
            done(); // Libera el cliente de vuelta al pool
        });

        // Exporta el pool para que pueda ser utilizado en otras partes de tu aplicación
        module.exports = pool; // <-- ¡Exporta el pool directamente!
        