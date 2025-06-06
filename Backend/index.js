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

const JWT_SECRET = 'este_es_un_secreto_muy_seguro_y_largo_para_jwt_cambialo_en_produccion_porfavor_1234567890';

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


app.post('/register', async (req, res) => {
    const { nombres, apellidos, email, telefono, contrasena, dia, mes, anio } = req.body;
    const fecha_nacimiento_usuario = `${anio}-${mes}-${dia}`;

    console.log('Datos recibidos del frontend (req.body):', req.body);
    console.log('Día:', dia, 'Mes:', mes, 'Año:', anio);
    console.log('Fecha de nacimiento construida:', fecha_nacimiento_usuario);

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
            "Autenticacion_2fa"
        ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, DEFAULT, FALSE) RETURNING id`, 
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
            'SELECT id, "password_hash", "ES_Organizador", "Nom_Usuario" FROM "Usuarios" WHERE "Correo_Usuario" = $1',
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

        res.status(200).json({
            message: 'Inicio de sesión exitoso.',
            userId: user.id,
            userName: user.Nom_Usuario,
            isOrganizer: user.ES_Organizador
        });

    } catch (error) {
        console.error('Error al iniciar sesión:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al iniciar sesión.' });
    }
});

app.post('/organizer-request', authenticateToken, async (req, res) => {
    const { nom_empresa, descripcion } = req.body;
    const userId = req.user.id;
    const isCurrentlyOrganizer = req.user.is_organizador;

    if (isCurrentlyOrganizer) {
    return res.status(400).json({ message: 'Este usuario ya es un organizador.' });
    }

try {
    await pool.query(
    `UPDATE "Usuarios" SET "ES_Organizador" = TRUE WHERE id = $1`,
    [userId]
    );

    const result = await pool.query(
        `INSERT INTO "Organizadores" (
        "Id_Usuario",
        "Nom_Empresa",
        "Descripcion"
    ) VALUES ($1, $2, $3) RETURNING "Id_Organizador"`,
    [userId, nom_empresa, descripcion]
    );

    res.status(201).json({
    message: 'Solicitud de organizador procesada exitosamente. ¡Ahora eres un organizador!',
    organizerId: result.rows[0].Id_Organizador
    });

} catch (error) {
    console.error('Error al procesar solicitud de organizador:', error.message);
    if (error.code === '23505') {
        return res.status(409).json({ message: 'Ya existe una entrada de organizador para este usuario.' });
    }
    res.status(500).json({ message: 'Error interno del servidor al procesar solicitud de organizador.' });
}
});

app.get('/protected-organizer-route', authenticateToken, (req, res) => {
if (!req.user.is_organizador) {
    return res.status(403).json({ message: 'Acceso denegado. Solo para organizadores autorizados.' });
}
res.status(200).json({ message: `¡Bienvenido organizador! Tu ID de usuario es ${req.user.id}. Tienes acceso a esta ruta.` });
});

app.listen(PORT, () => {
console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
});