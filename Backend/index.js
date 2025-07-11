// Backend/index.js
// Este es el archivo principal de tu servidor Express.

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const pool = require('./db'); // Importa la configuración de conexión a PostgreSQL.
const bcrypt = require('bcryptjs'); // Para hash de contraseñas.
const jwt = require('jsonwebtoken'); // Para JSON Web Tokens.
const path = require('path'); // Para manejar rutas de archivos.
const fs = require('fs'); // Importa el módulo 'fs' para manejar sistemas de archivos
const helmet = require('helmet');

// --- Carga de variables de entorno ---
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;

// --- JWT_SECRET ---
const JWT_SECRET = process.env.JWT_SECRET || 'tu_secreto_jwt_super_seguro_y_largo_aqui_cambialo_en_produccion_1234567890ABCDEF';

// --- Importa tus middlewares de autenticación y autorización ---
const { authenticateToken, authorizeRole } = require('./middleware/authMiddleware');

// --- Importa tus módulos de rutas ---
const eventosAdminRoutes = require('./routes/eventos'); 
const eventosProveedorRoutes = require('./routes/eventosprov'); 
const intermediarioRoutes = require('./routes/intermediario');
const publicEventsRoutes = require('./routes/eventospublicos'); 
const lugaresRoutes = require('./routes/lugares'); 
const comprasRoutes = require('./routes/compras'); 
const usuariosRoutes = require('./routes/usuarios'); 
const notificacionesRoutes = require('./routes/notificaciones'); 
const contactoProveedorRoutes = require('./routes/contactoProveedor'); 
const solicitudClienteRoutes = require('./routes/solicitudCliente'); // ¡NUEVA LÍNEA!
const adminCountsRoutes = require('./routes/adminCounts'); // Importa el nuevo archivo de rutas


app.use(helmet());

// Middleware para permitir solo ciertas IPs (puedes adaptarlo o comentar si estás en desarrollo)
app.use((req, res, next) => {
    const allowedIps = ['127.0.0.1', '::1', '192.168.1.33']; // Cambia por las IPs que tú autorizas
    const ip = req.ip.replace('::ffff:', ''); // Formato común en Express

    if (!allowedIps.includes(ip)) {
        console.warn(`Intento de acceso bloqueado desde IP no autorizada: ${ip}`);
        return res.status(403).json({ message: 'Acceso denegado desde esta IP.' });
    }
    next();
});

// --- Middlewares Globales de Express ---

app.use(cors({
    origin: ['http://127.0.0.1:5502', 'http://localhost:3000', 'http://127.0.0.1:5500'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


// --- Configuración de Multer: Directorios para imágenes ---
const eventImagesDir = path.join(__dirname, '..', 'Fronted', 'img', 'event_images');
if (!fs.existsSync(eventImagesDir)) {
    fs.mkdirSync(eventImagesDir, { recursive: true });
    console.log(`Carpeta de imágenes de eventos creada en: ${eventImagesDir}`);
}

const placeImagesDir = path.join(__dirname, '..', 'Fronted', 'img', 'place_images');
if (!fs.existsSync(placeImagesDir)) {
    fs.mkdirSync(placeImagesDir, { recursive: true });
    console.log(`Carpeta de imágenes de lugares creada en: ${placeImagesDir}`);
}


// =========================================================
// !!! LÍNEAS IMPORTANTES PARA SERVIR EL FRONTEND DESDE EL BACKEND !!!
// =========================================================

// Servir archivos estáticos desde la carpeta 'Fronted'
app.use(express.static(path.join(__dirname, '../Fronted')));

app.use('/img/event_images', express.static(eventImagesDir));

app.use('/img/place_images', express.static(placeImagesDir));


// Ruta para servir login.html por defecto cuando se accede a la raíz del servidor
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../Fronted/login.html'));
});

app.get('/Admin/:file', (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.redirect('/login.html');
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.rol !== 'admin') {
            return res.redirect('/login.html');
        }
        next();
    } catch (err) {
        return res.redirect('/login.html');
    }
});

(function () {
    const token = localStorage.getItem('jwtToken');
    const userRole = localStorage.getItem('userRole');

    if (!token || userRole !== 'organizador') {
        alert('Acceso denegado. Solo organizadores pueden ingresar.');
        window.location.replace('../login.html');
    }
});
app.get('/Organizador/:file', (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.redirect('/login.html');
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.rol !== 'organizador') {
            return res.redirect('/login.html');
        }
        next();
    } catch (err) {
        return res.redirect('/login.html');
    }
});

app.get('/Cliente/:file', (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.redirect('/login.html');
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.rol !== 'cliente') {
            return res.redirect('/login.html');
        }
        next();
    } catch (err) {
        return res.redirect('/login.html');
    }
});
// =========================================================
// !!! FIN DE LÍNEAS IMPORTANTES PARA SERVIR EL FRONTEND !!!
// =========================================================


// --- Rutas de Autenticación y Registro de Usuarios (mantener aquí si no están en usuarios.js) ---

/**
 * @route POST /register
 * @description Registra un nuevo usuario con rol por defecto 'cliente'.
 * @access Público
 */
app.post('/register', async (req, res) => {
    const { nombres, apellidos, email, telefono, contrasena, dia, mes, anio } = req.body;
    const fecha_nacimiento_usuario = `${anio}-${mes}-${dia}`;

    try {
        const salt = await bcrypt.genSalt(10);
        const hashed_password = await bcrypt.hash(contrasena, salt);

        const result = await pool.query(
            `INSERT INTO "Usuarios" (
                "Nom_Usuario", "Ape_Usuario", "Correo_Usuario", "Tlf_Usuario", "password_hash",
                "Fecha_Reg", "Fecha_Nacimiento", "ES_Organizador", "Autenticacion_2fa", "Rol_Usuario"
            ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, FALSE, FALSE, 'cliente') RETURNING id`,
            [nombres, apellidos, email, telefono, hashed_password, fecha_nacimiento_usuario]
        );

        const newUser = result.rows[0];
        res.status(201).json({ message: 'Usuario registrado exitosamente', userId: newUser.id });

    } catch (error) {
        console.error('Error al registrar usuario:', error.message);
        if (error.code === '23505') {
            return res.status(409).json({ message: 'El email ya está registrado. Por favor, usa otro.' });
        }
        res.status(500).json({ message: 'Error interno del servidor al registrar usuario.' });
    }
});

/**
 * @route POST /login
 * @description Autentica a un usuario y retorna un token JWT si las credenciales son válidas.
 * @access Público
 */
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const result = await pool.query(
            'SELECT id, "password_hash", "ES_Organizador", "Nom_Usuario", "Rol_Usuario", "Puntos_Teycketan", "Usado_Primera_Compra" FROM "Usuarios" WHERE "Correo_Usuario" = $1',
            [email]
        );
        const user = result.rows[0];

        if (!user) {
            return res.status(400).json({ message: 'Credenciales inválidas: Email no encontrado.' });
        }
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(400).json({ message: 'Credenciales inválidas: Contraseña incorrecta.' });
        }

        const token = jwt.sign(
            {
                id: user.id,
                is_organizador: user.ES_Organizador,
                nom_usuario: user.Nom_Usuario,
                rol: user.Rol_Usuario
            },
            JWT_SECRET,
            { expiresIn: '8h' } 
        );

        res.status(200).json({
            message: 'Inicio de sesión exitoso.',
            userId: user.id,
            userName: user.Nom_Usuario,
            isOrganizer: user.ES_Organizador,
            userRole: user.Rol_Usuario,
            token: token,
            userPoints: user.Puntos_Teycketan, 
            userUsedFirstPurchase: user.Usado_Primera_Compra 
        });

    } catch (error) {
        console.error('Error al iniciar sesión:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al iniciar sesión.' });
    }
});

/**
 * @route POST /organizer-request
 * @description Permite a un usuario existente solicitar convertirse en organizador.
 * @access Privado (solo usuarios autenticados, no organizadores ni administradores ya establecidos)
 */
app.post('/organizer-request', authenticateToken, async (req, res) => {
    const { nom_empresa, descripcion } = req.body;
    const userId = req.user.id;
    const currentUserRole = req.user.rol;

    if (currentUserRole === 'organizador' || currentUserRole === 'admin') {
        return res.status(400).json({ message: 'Este usuario ya tiene un rol de organizador o administrador. No puede solicitarlo de nuevo.' });
    }
    if (currentUserRole === 'pendiente_organizador') {
        return res.status(400).json({ message: 'Tu solicitud ya está pendiente de aprobación. Por favor, espera.' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const insertResult = await client.query(
            `INSERT INTO "Organizadores" ("Id_Usuario", "Nom_Empresa", "Descripcion", "Estado_Solicitud", "fecha_solicitud")
            VALUES ($1, $2, $3, 'pendiente', CURRENT_TIMESTAMP) RETURNING "Id_Organizador"`,
            [userId, nom_empresa, descripcion]
        );

        await client.query(
            `UPDATE "Usuarios" SET "Rol_Usuario" = 'pendiente_organizador' WHERE id = $1`,
            [userId]
        );

        await client.query('COMMIT');

        res.status(200).json({
            message: 'Solicitud de organizador enviada. Está pendiente de aprobación por un administrador.',
            organizerRequestId: insertResult.rows[0].Id_Organizador,
            newStatus: 'pendiente_organizador'
        });

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK');
        }
        console.error('Error al enviar solicitud de organizador:', error.message);
        if (error.code === '23505') {
            return res.status(409).json({ message: 'Ya existe una solicitud de organizador para este usuario o ya es organizador.' });
        }
        res.status(500).json({ message: 'Error interno del servidor al enviar solicitud de organizador.' });
    } finally {
        if (client) {
            client.release();
        }
    }
});


// --- Montaje de Rutas Modulares ---

// Monta las rutas de administración de eventos (protegidas para admin).
app.use('/api/admin/eventos', authenticateToken, authorizeRole(['admin']), eventosAdminRoutes);

// Monta las rutas para el panel del proveedor/organizador.
app.use('/api/proveedor', authenticateToken, authorizeRole(['organizador']), eventosProveedorRoutes); 

// Monta las rutas para el intermediario (gestión de solicitudes de reclamos de organizadores).
app.use('/api/contactoProveedor', authenticateToken, authorizeRole(['admin', 'organizador', 'cliente']),contactoProveedorRoutes); 

// Monta las rutas para la gestión de solicitudes de organizador (protegidas para admin).
app.use('/api/admin/solicitudes', authenticateToken, authorizeRole(['admin']), intermediarioRoutes);

// Monta las rutas públicas de eventos (accesibles sin autenticación) en /api/eventos
app.use('/api/eventos', publicEventsRoutes); 

// Monta las rutas de lugares, protegidas para administradores y organizadores.
app.use('/api/lugares', authenticateToken, authorizeRole(['admin', 'organizador']), lugaresRoutes);

// Monta las rutas de compras (protegidas para usuarios autenticados).
app.use('/api/compras', authenticateToken, comprasRoutes); 

// Monta las rutas de usuarios (protegidas para usuarios autenticados, para obtener puntos, etc.).
app.use('/api/usuarios', authenticateToken, usuariosRoutes);

// Monta las rutas de notificaciones (protegidas para usuarios autenticados).
app.use('/api/notificaciones', authenticateToken, notificacionesRoutes);

// Monta las rutas para las solicitudes de eventos de clientes (protegidas para clientes). ¡NUEVA LÍNEA!
app.use('/api/solicitudCliente', authenticateToken, solicitudClienteRoutes);


app.use('/api/adminCounts', authenticateToken, adminCountsRoutes); // Todas las rutas definidas en adminCounts.js comenzarán con /api


// --- Rutas protegidas de ejemplo para diferentes roles ---
/**
 * @route GET /protected-organizer-route
 * @description Ruta de ejemplo accesible por organizadores y administradores.
 * @access Privado (organizadores/administradores)
 */
app.get('/protected-organizer-route', authenticateToken, authorizeRole(['organizador', 'admin']), (req, res) => {
    res.status(200).json({ message: `¡Bienvenido ${req.user.rol}! Tu ID de usuario es ${req.user.id}. Tienes acceso a esta ruta.` });
});

/**
 * @route GET /protected-admin-route
 * @description Ruta de ejemplo accesible solo por administradores.
 * @access Privado (administradores)
 */
app.get('/protected-admin-route', authenticateToken, authorizeRole(['admin']), (req, res) => {
    res.status(200).json({ message: `¡Bienvenido administrador! Tu ID de usuario es ${req.user.id}. Tienes acceso a esta ruta de administración.` });
});


// --- Manejo de Rutas no Encontradas (404) y Errores Globales ---
app.use((req, res, next) => {
    res.status(404).json({ message: 'Ruta no encontrada.' });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Ocurrió un error interno en el servidor.', error: err.message });
});

// --- Manejo de errores de promesas no capturadas ---
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// --- Manejo de excepciones no capturadas ---
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});


// --- Iniciar el Servidor ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor backend corriendo en http://0.0.0.0:${PORT}`);
    console.log(`Frontend disponible en http://0.0.0.0:${PORT}`);
    pool.query('SELECT NOW()', (err, res) => {
        if (err) {
            console.error('Error de conexión a PostgreSQL:', err.message);
        } else {
            console.log('Conexión exitosa a PostgreSQL!');
        }
    });
});