const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const pool = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const JWT_SECRET = process.env.JWT_SECRET || 'este_es_un_secreto_muy_seguro_y_largo_para_jwt_cambialo_en_produccion_porfavor_1234567890';

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        return res.status(401).json({ message: 'Acceso denegado. Se requiere autenticación.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error('Error de verificación de JWT:', err.message);
            return res.status(403).json({ message: 'Token inválido o expirado.' });
        }
        req.user = user; 
        next();
    });
}

function authorizeAdmin(req, res, next) {
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ message: 'Acceso denegado. Requiere rol de administrador.' });
    }
    next();
}

function authorizeOrganizerOrAdmin(req, res, next) {
    if (req.user.rol !== 'organizador' && req.user.rol !== 'admin') {
        return res.status(403).json({ message: 'Acceso denegado. Requiere rol de organizador o administrador.' });
    }
    next();
}


const usuariosRoutes = require('./routes/usuarios');
app.use('/api/usuarios', usuariosRoutes);


app.post('/register', async (req, res) => {
    const { nombres, apellidos, email, telefono, contrasena, dia, mes, anio } = req.body;
    const fecha_nacimiento_usuario = `${anio}-${mes}-${dia}`;

    try {
        const salt = await bcrypt.genSalt(10);
        const hashed_password = await bcrypt.hash(contrasena, salt);

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
                "Autenticacion_2fa",
                "Rol_Usuario"
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

app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const result = await pool.query(
            'SELECT id, "password_hash", "ES_Organizador", "Nom_Usuario", "Rol_Usuario" FROM "Usuarios" WHERE "Correo_Usuario" = $1',
            [email]
        );
        const user = result.rows[0];

        if (!user) { return res.status(400).json({ message: 'Credenciales inválidas: Email no encontrado.' }); }
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) { return res.status(400).json({ message: 'Credenciales inválidas: Contraseña incorrecta.' }); }

        const token = jwt.sign(
            {
                id: user.id,
                is_organizador: user.ES_Organizador,
                nom_usuario: user.Nom_Usuario,
                rol: user.Rol_Usuario 
            },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.status(200).json({
            message: 'Inicio de sesión exitoso.',
            userId: user.id,
            userName: user.Nom_Usuario,
            isOrganizer: user.ES_Organizador,
            userRole: user.Rol_Usuario, 
            token: token
        });

    } catch (error) {
        console.error('Error al iniciar sesión:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al iniciar sesión.' });
    }
});


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
            `INSERT INTO "Organizadores" ("Id_Usuario", "Nom_Empresa", "Descripcion", "Estado_Solicitud")
            VALUES ($1, $2, $3, 'pendiente') RETURNING "Id_Organizador"`,
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
        if (error.code === '23505') { // Código para violación de clave única (si ya existe un organizador para este usuario)
            return res.status(409).json({ message: 'Ya existe una solicitud de organizador para este usuario o ya es organizador.' });
        }
        res.status(500).json({ message: 'Error interno del servidor al enviar solicitud de organizador.' });
    } finally {
        if (client) {
            client.release();
        }
    }
});



app.get('/admin/organizer-requests/pending', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                u.id AS user_id,
                u."Nom_Usuario",
                u."Ape_Usuario",
                u."Correo_Usuario",
                u."Tlf_Usuario",
                o."Id_Organizador",
                o."Nom_Empresa",
                o."Descripcion",
                o."Estado_Solicitud"
            FROM "Usuarios" u
            JOIN "Organizadores" o ON u.id = o."Id_Usuario"
            WHERE o."Estado_Solicitud" = 'pendiente';`
        );
        res.status(200).json({ requests: result.rows });
    } catch (error) {
        console.error('Error al obtener solicitudes pendientes de organizador:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener solicitudes pendientes.' });
    }
});

app.post('/admin/organizer-requests/approve/:userId', authenticateToken, authorizeAdmin, async (req, res) => {
    const userIdToApprove = req.params.userId;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        await client.query(
            `UPDATE "Usuarios" SET "Rol_Usuario" = 'organizador', "ES_Organizador" = TRUE WHERE id = $1 AND "Rol_Usuario" = 'pendiente_organizador'`,
            [userIdToApprove]
        );

        await client.query(
            `UPDATE "Organizadores" SET "Estado_Solicitud" = 'aprobado' WHERE "Id_Usuario" = $1 AND "Estado_Solicitud" = 'pendiente'`,
            [userIdToApprove]
        );

        await client.query('COMMIT');
        res.status(200).json({ message: `Solicitud de organizador para usuario ${userIdToApprove} aprobada exitosamente.` });

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK');
        }
        console.error('Error al aprobar solicitud de organizador:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al aprobar solicitud de organizador.' });
    } finally {
        if (client) {
            client.release();
        }
    }
});

app.post('/admin/organizer-requests/reject/:userId', authenticateToken, authorizeAdmin, async (req, res) => {
    const userIdToReject = req.params.userId;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        await client.query(
            `UPDATE "Usuarios" SET "Rol_Usuario" = 'cliente', "ES_Organizador" = FALSE WHERE id = $1 AND "Rol_Usuario" = 'pendiente_organizador'`,
            [userIdToReject]
        );

        await client.query(
            `UPDATE "Organizadores" SET "Estado_Solicitud" = 'rechazada' WHERE "Id_Usuario" = $1 AND "Estado_Solicitud" = 'pendiente'`,
            [userIdToReject]
        );

        await client.query('COMMIT');
        res.status(200).json({ message: `Solicitud de organizador para usuario ${userIdToReject} rechazada.` });

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK');
        }
        console.error('Error al rechazar solicitud de organizador:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al rechazar solicitud de organizador.' });
    } finally {
        if (client) {
            client.release();
        }
    }
});

app.get('/admin/organizers/approved', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                u.id AS user_id,
                u."Nom_Usuario",
                u."Ape_Usuario",
                u."Correo_Usuario",
                o."Id_Organizador",
                o."Nom_Empresa",
                o."Descripcion",
                o."Estado_Solicitud"
            FROM "Usuarios" u
            JOIN "Organizadores" o ON u.id = o."Id_Usuario"
            WHERE o."Estado_Solicitud" = 'aprobado' AND u."Rol_Usuario" = 'organizador';`
        );
        res.status(200).json({ approvedOrganizers: result.rows });
    } catch (error) {
        console.error('Error al obtener organizadores aprobados:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener organizadores aprobados.' });
    }
});

app.post('/admin/organizers/remove/:userId', authenticateToken, authorizeAdmin, async (req, res) => {
    const userIdToRemove = req.params.userId;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        await client.query(
            `UPDATE "Usuarios" SET "Rol_Usuario" = 'cliente', "ES_Organizador" = FALSE WHERE id = $1 AND "Rol_Usuario" = 'organizador'`,
            [userIdToRemove]
        );

        await client.query(
            `DELETE FROM "Organizadores" WHERE "Id_Usuario" = $1 AND "Estado_Solicitud" = 'aprobado'`,
            [userIdToRemove]
        );

        await client.query('COMMIT');
        res.status(200).json({ message: `Organizador con ID ${userIdToRemove} eliminado y rol revertido a cliente.` });

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK');
        }
        console.error('Error al eliminar organizador:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al eliminar organizador.' });
    } finally {
        if (client) {
            client.release();
        }
    }
});


app.get('/protected-organizer-route', authenticateToken, authorizeOrganizerOrAdmin, (req, res) => {
    res.status(200).json({ message: `¡Bienvenido ${req.user.rol}! Tu ID de usuario es ${req.user.id}. Tienes acceso a esta ruta.` });
});

app.get('/protected-admin-route', authenticateToken, authorizeAdmin, (req, res) => {
    res.status(200).json({ message: `¡Bienvenido administrador! Tu ID de usuario es ${req.user.id}. Tienes acceso a esta ruta de administración.` });
});


app.listen(PORT, () => {
    console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
});