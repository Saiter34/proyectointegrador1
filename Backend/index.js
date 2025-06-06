const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const pool = require('./db'); // db.js ya exporta directamente el pool de PostgreSQL
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Es crucial que este secreto sea largo, complejo y se maneje de forma segura.
// Obtenerlo de las variables de entorno es una buena práctica.
const JWT_SECRET = process.env.JWT_SECRET || 'este_es_un_secreto_muy_seguro_y_largo_para_jwt_cambialo_en_produccion_porfavor_1234567890';

// Middleware para autenticar el token JWT en las solicitudes
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Espera "Bearer TOKEN"

    if (token == null) {
        return res.status(401).json({ message: 'Acceso denegado. Se requiere autenticación.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error('Error de verificación de JWT:', err.message);
            // Puede ser un token inválido, expirado, etc.
            return res.status(403).json({ message: 'Token inválido o expirado.' });
        }
        req.user = user; // Almacena la información del usuario del token en el objeto de solicitud
        next(); // Continúa con la siguiente función de middleware/ruta
    });
}

// --- Ruta para el registro de nuevos usuarios (clientes) ---
app.post('/register', async (req, res) => {
    const { nombres, apellidos, email, telefono, contrasena, dia, mes, anio } = req.body;
    const fecha_nacimiento_usuario = `${anio}-${mes}-${dia}`;

    console.log('Datos recibidos del frontend (req.body):', req.body);
    console.log('Día:', dia, 'Mes:', mes, 'Año:', anio);
    console.log('Fecha de nacimiento construida:', fecha_nacimiento_usuario);

    try {
        const salt = await bcrypt.genSalt(10); // Genera un "salt" para hashear la contraseña
        const hashed_password = await bcrypt.hash(contrasena, salt); // Hashea la contraseña

        const result = await pool.query(
            `INSERT INTO "Usuarios" (
            "Nom_Usuario",
            "Ape_Usuario",
            "Correo_Usuario",
            "Tlf_Usuario",
            "password_hash",        
            "Fecha_Reg",            
            "Fecha_Nacimiento",     
            "ES_Organizador",
            "Autenticacion_2fa"
        ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, FALSE, FALSE) RETURNING id`, 
        [nombres, apellidos, email, telefono, hashed_password, fecha_nacimiento_usuario]
        );

        const newUser = result.rows[0]; // Obtiene el ID del usuario recién creado
        res.status(201).json({ message: 'Usuario registrado exitosamente', userId: newUser.id });

    } catch (error) {
        console.error('Error al registrar usuario:', error.message);
        // Código de error de PostgreSQL para violación de unicidad (ej: email ya existe)
        if (error.code === '23505') {
            return res.status(409).json({ message: 'El email ya está registrado. Por favor, usa otro.' });
        }
        res.status(500).json({ message: 'Error interno del servidor al registrar usuario.' });
    }
});

// --- Ruta para el inicio de sesión de usuarios ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const result = await pool.query(
            'SELECT id, "password_hash", "ES_Organizador", "Nom_Usuario" FROM "Usuarios" WHERE "Correo_Usuario" = $1',
            [email]
        );
        const user = result.rows[0];

        if (!user) {
            return res.status(400).json({ message: 'Credenciales inválidas: Email no encontrado.' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash); // Compara la contraseña hasheada

        if (!isMatch) {
            return res.status(400).json({ message: 'Credenciales inválidas: Contraseña incorrecta.' });
        }

        // Generar un token JWT para el usuario autenticado
        const token = jwt.sign(
            { id: user.id, is_organizador: user.ES_Organizador, nom_usuario: user.Nom_Usuario },
            JWT_SECRET,
            { expiresIn: '1h' } // El token expira en 1 hora
        );

        res.status(200).json({
            message: 'Inicio de sesión exitoso.',
            userId: user.id,
            userName: user.Nom_Usuario,
            isOrganizer: user.ES_Organizador,
            token: token // Envía el token JWT al frontend
        });

    } catch (error) {
        console.error('Error al iniciar sesión:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al iniciar sesión.' });
    }
});

// --- Ruta para que un USUARIO EXISTENTE se convierta en Organizador ---
// Esta ruta requiere autenticación JWT para verificar que el usuario está logueado
app.post('/organizer-request', authenticateToken, async (req, res) => {
    // Los datos del organizador (nom_empresa, descripcion) vienen del cuerpo de la solicitud
    const { nom_empresa, descripcion } = req.body;
    // El ID del usuario y si ya es organizador se obtienen del token JWT (gracias a authenticateToken)
    const userId = req.user.id;
    const isCurrentlyOrganizer = req.user.is_organizador;

    // Verificar si el usuario ya es un organizador para evitar duplicados
    if (isCurrentlyOrganizer) {
        return res.status(400).json({ message: 'Este usuario ya es un organizador.' });
    }

    let client; // Declara la variable client para que sea accesible en el bloque finally
    try {
        client = await pool.connect(); // Obtiene una conexión de la pool
        await client.query('BEGIN'); // Inicia una transacción para asegurar la atomicidad

        // 1. Actualizar el campo ES_Organizador del usuario a TRUE
        await client.query(
            `UPDATE "Usuarios" SET "ES_Organizador" = TRUE WHERE id = $1`,
            [userId]
        );

        // 2. Insertar los detalles del organizador en la tabla "Organizadores"
        const result = await client.query(
            `INSERT INTO "Organizadores" (
            "Id_Usuario",
            "Nom_Empresa",
            "Descripcion"
        ) VALUES ($1, $2, $3) RETURNING "Id_Organizador"`,
        [userId, nom_empresa, descripcion]
        );

        await client.query('COMMIT'); // Si todo fue bien, confirma la transacción

        // Envía una respuesta de éxito al frontend
        res.status(201).json({
            message: 'Solicitud de organizador procesada exitosamente. ¡Ahora eres un organizador!',
            organizerId: result.rows[0].Id_Organizador
        });

    } catch (error) {
        if (client) { // Si hubo un error y se obtuvo una conexión, intenta un rollback
            await client.query('ROLLBACK'); // Deshace todos los cambios de la transacción
        }
        console.error('Error al procesar solicitud de organizador:', error.message);
        // Si el error es una violación de la restricción de unicidad (ej: ya hay una entrada de organizador para este usuario)
        if (error.code === '23505') {
            return res.status(409).json({ message: 'Ya existe una entrada de organizador para este usuario.' });
        }
        res.status(500).json({ message: 'Error interno del servidor al procesar solicitud de organizador.' });
    } finally {
        if (client) { // Siempre libera la conexión, independientemente del resultado
            client.release();
        }
    }
});

// --- Ruta protegida de ejemplo para organizadores ---
app.get('/protected-organizer-route', authenticateToken, (req, res) => {
    // Verifica si el usuario autenticado tiene el rol de organizador
    if (!req.user.is_organizador) {
        return res.status(403).json({ message: 'Acceso denegado. Solo para organizadores autorizados.' });
    }
    res.status(200).json({ message: `¡Bienvenido organizador! Tu ID de usuario es ${req.user.id}. Tienes acceso a esta ruta.` });
});

// Inicia el servidor
app.listen(PORT, () => {
    console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
});