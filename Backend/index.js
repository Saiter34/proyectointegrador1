// Backend/index.js
// Este es el archivo principal de tu servidor Express.

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const pool = require('./db'); // Importa la configuración de conexión a PostgreSQL.
const bcrypt = require('bcryptjs'); // Para hash de contraseñas.
const jwt = require('jsonwebtoken'); // Para JSON Web Tokens.
const path = require('path'); // Para manejar rutas de archivos.

// --- Carga de variables de entorno ---
// Configura dotenv para cargar el archivo .env ubicado en la raíz del proyecto.
// '__dirname' es la ruta del directorio actual (Backend), '../.env' sube un nivel.
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const app = express();
// Define el puerto del servidor, usando la variable de entorno PORT o 3000 por defecto.
const PORT = process.env.PORT || 3000; 

// --- JWT_SECRET ---
// Obtiene el secreto JWT de las variables de entorno. Si no está definido, usa un valor por defecto.
// ¡ES CRÍTICO QUE ESTE SECRETO SEA EL MISMO EN authMiddleware.js y en .env!
const JWT_SECRET = process.env.JWT_SECRET || 'tu_secreto_jwt_super_seguro_y_largo_aqui_cambialo_en_produccion_1234567890ABCDEF';

// --- Importa tus middlewares de autenticación y autorización ---
// Asegúrate de que esta ruta sea correcta: desde 'Backend' a 'middleware/authMiddleware.js'.
const { authenticateToken, authorizeRole } = require('./middleware/authMiddleware');

// --- Importa tus módulos de rutas ---
// Asumiendo que 'eventos.js' maneja las rutas de administración de eventos.
const eventosAdminRoutes = require('./routes/eventos'); 
// Asumiendo que 'eventosprov.js' maneja las rutas de eventos para el proveedor.
const eventosProveedorRoutes = require('./routes/eventosprov'); 
// Asumiendo que 'intermediario.js' maneja las rutas de solicitudes de organizador.
const intermediarioRoutes = require('./routes/intermediario'); 

// --- Middlewares Globales de Express ---
app.use(cors()); // Habilita Cross-Origin Resource Sharing para permitir solicitudes desde el frontend.
app.use(bodyParser.json()); // Parsea las solicitudes entrantes con cargas JSON.


// --- Rutas de Autenticación y Registro de Usuarios ---

/**
 * @route POST /register
 * @description Registra un nuevo usuario con rol por defecto 'cliente'.
 * @access Público
 */
app.post('/register', async (req, res) => {
    const { nombres, apellidos, email, telefono, contrasena, dia, mes, anio } = req.body;
    const fecha_nacimiento_usuario = `${anio}-${mes}-${dia}`; // Formatea la fecha de nacimiento.

    try {
        // Genera un hash de la contraseña para seguridad.
        const salt = await bcrypt.genSalt(10);
        const hashed_password = await bcrypt.hash(contrasena, salt);

        // Inserta el nuevo usuario en la base de datos.
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
        if (error.code === '23505') { // Código de error de PostgreSQL para violación de unicidad (ej. email duplicado).
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
        // Busca al usuario por email en la base de datos.
        const result = await pool.query(
            'SELECT id, "password_hash", "ES_Organizador", "Nom_Usuario", "Rol_Usuario" FROM "Usuarios" WHERE "Correo_Usuario" = $1',
            [email]
        );
        const user = result.rows[0];

        if (!user) { 
            return res.status(400).json({ message: 'Credenciales inválidas: Email no encontrado.' }); 
        }
        // Compara la contraseña proporcionada con el hash almacenado.
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) { 
            return res.status(400).json({ message: 'Credenciales inválidas: Contraseña incorrecta.' }); 
        }

        // Si las credenciales son válidas, crea un token JWT.
        // El payload del token incluye el ID, si es organizador, nombre y ROL del usuario.
        const token = jwt.sign(
            {
                id: user.id,
                is_organizador: user.ES_Organizador,
                nom_usuario: user.Nom_Usuario,
                rol: user.Rol_Usuario // Incluye el rol para uso en los middlewares de autorización.
            },
            JWT_SECRET, // Firma el token con el secreto.
            { expiresIn: '1h' } // El token expira en 1 hora.
        );

        // Envía la respuesta con el token y la información relevante del usuario.
        res.status(200).json({
            message: 'Inicio de sesión exitoso.',
            userId: user.id,
            userName: user.Nom_Usuario,
            isOrganizer: user.ES_Organizador,
            userRole: user.Rol_Usuario, // Envía el rol al frontend.
            token: token
        });

    } catch (error) {
        console.error('Error al iniciar sesión:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al iniciar sesión.' });
    }
});

/**
 * @route POST /organizer-request
 * @description Permite a un usuario existente solicitar convertirse en organizador.
 * Cambia el rol del usuario a 'pendiente_organizador' y crea una entrada en "Organizadores".
 * @access Privado (solo usuarios autenticados, no organizadores ni administradores ya establecidos)
 */
app.post('/organizer-request', authenticateToken, async (req, res) => {
    const { nom_empresa, descripcion } = req.body;
    const userId = req.user.id; // ID del usuario que hace la solicitud, desde el token.
    const currentUserRole = req.user.rol; // Rol actual del usuario, desde el token.

    // Validar si el usuario ya tiene un rol de organizador/administrador o ya tiene una solicitud pendiente.
    if (currentUserRole === 'organizador' || currentUserRole === 'admin') {
        return res.status(400).json({ message: 'Este usuario ya tiene un rol de organizador o administrador. No puede solicitarlo de nuevo.' });
    }
    if (currentUserRole === 'pendiente_organizador') {
        return res.status(400).json({ message: 'Tu solicitud ya está pendiente de aprobación. Por favor, espera.' });
    }

    let client; // Variable para la conexión de la base de datos dentro de la transacción.
    try {
        client = await pool.connect();
        await client.query('BEGIN'); // Inicia una transacción para asegurar la atomicidad de las operaciones.

        // Inserta la solicitud en la tabla "Organizadores" con estado 'pendiente'.
        const insertResult = await client.query(
            `INSERT INTO "Organizadores" ("Id_Usuario", "Nom_Empresa", "Descripcion", "Estado_Solicitud", "Fecha_Solicitud")
             VALUES ($1, $2, $3, 'pendiente', CURRENT_TIMESTAMP) RETURNING "Id_Organizador"`,
            [userId, nom_empresa, descripcion]
        );

        // Actualiza el rol del usuario a 'pendiente_organizador' en la tabla "Usuarios".
        await client.query(
            `UPDATE "Usuarios" SET "Rol_Usuario" = 'pendiente_organizador' WHERE id = $1`,
            [userId]
        );

        await client.query('COMMIT'); // Confirma todos los cambios de la transacción.

        res.status(200).json({
            message: 'Solicitud de organizador enviada. Está pendiente de aprobación por un administrador.',
            organizerRequestId: insertResult.rows[0].Id_Organizador,
            newStatus: 'pendiente_organizador'
        });

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK'); // Si algo falla, revierte todos los cambios de la transacción.
        }
        console.error('Error al enviar solicitud de organizador:', error.message);
        if (error.code === '23505') { // Error de unicidad (ej. ya existe una solicitud para este usuario).
            return res.status(409).json({ message: 'Ya existe una solicitud de organizador para este usuario o ya es organizador.' });
        }
        res.status(500).json({ message: 'Error interno del servidor al enviar solicitud de organizador.' });
    } finally {
        if (client) {
            client.release(); // Siempre libera la conexión al pool.
        }
    }
});


// --- Montaje de Rutas Modulares ---

// Monta las rutas de administración de eventos.
// Todas las rutas dentro de 'eventosAdminRoutes' (de Backend/routes/eventos.js)
// serán accesibles bajo '/api/admin/eventos' y requerirán rol 'admin'.
app.use('/api/admin/eventos', authenticateToken, authorizeRole(['admin']), eventosAdminRoutes);

// Monta las rutas para el panel del proveedor/organizador.
// Todas las rutas dentro de 'eventosProveedorRoutes' (de Backend/routes/eventosprov.js)
// serán accesibles bajo '/api/proveedor' y requerirán rol 'proveedor' o 'organizador'.
app.use('/api/proveedor', eventosProveedorRoutes);

// Monta las rutas para la gestión de solicitudes de organizador.
// Todas las rutas dentro de 'intermediarioRoutes' (de Backend/routes/intermediario.js)
// serán accesibles bajo '/api/admin/solicitudes' y requerirán rol 'admin'.
app.use('/api/admin/solicitudes', authenticateToken, authorizeRole(['admin']), intermediarioRoutes);


// --- Rutas protegidas de ejemplo para diferentes roles ---
// Estas rutas son solo para demostración, puedes moverlas a archivos de ruta dedicados si lo necesitas.

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


// --- Manejo de Rutas no Encontradas (404) ---
// Este middleware se ejecuta si ninguna de las rutas anteriores coincide con la solicitud.
app.use((req, res, next) => {
    res.status(404).json({ message: 'Ruta no encontrada.' });
});

// --- Manejo de Errores Global ---
// Este middleware captura cualquier error que ocurra en las rutas o middlewares anteriores.
app.use((err, req, res, next) => {
    console.error(err.stack); // Registra el stack de error para depuración en la consola del servidor.
    res.status(500).json({ message: 'Ocurrió un error interno en el servidor.', error: err.message });
});


// --- Iniciar el Servidor ---
// El servidor comienza a escuchar en el puerto definido.
app.listen(PORT, () => {
    console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
});
