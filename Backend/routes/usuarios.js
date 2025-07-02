// Backend/routes/usuarios.js
const express = require('express');
const router = express.Router();
const pool = require('../db'); 
const bcrypt = require('bcryptjs'); // <-- CORRECCIÓN AQUÍ
const jwt = require('jsonwebtoken');

// Importa el middleware de autenticación desde authMiddleware.js
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware'); 

router.post('/registro', async (req, res) => {
    const { nombre, apellido, email, telefono, contrasena, dia, mes, anio } = req.body;

    if (!nombre || !apellido || !email || !contrasena || !dia || !mes || !anio) {
        return res.status(400).json({ mensaje: 'Por favor, completa todos los campos requeridos.' });
    }

    try {
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(contrasena, salt);

        const fecha_nacimiento = `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;

        const result = await pool.query(
            `INSERT INTO "Usuarios" (
                "Nom_Usuario",
                "Ape_Usuario",
                "Correo_Usuario",
                "password_hash",
                "Tlf_Usuario",
                "Fecha_Nacimiento",
                "Fecha_Reg",
                "ES_Organizador",
                "Autenticacion_2fa",
                "Rol_Usuario",
                "Puntos_Teycketan" 
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), false, false, 'cliente', 0) 
            RETURNING "id", "Nom_Usuario", "Correo_Usuario", "Rol_Usuario"`,
            [nombre, apellido, email, password_hash, telefono, fecha_nacimiento]
        );

        res.status(201).json({ mensaje: 'Usuario registrado exitosamente', usuario: result.rows[0] });

    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ mensaje: 'El email ya está registrado.' });
        }
        console.error('Error al registrar usuario:', error);
        res.status(500).json({ mensaje: 'Error interno del servidor al registrar usuario.' });
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ mensaje: 'Por favor, ingresa tu email y contraseña.' });
    }

    try {
        const result = await pool.query('SELECT * FROM "Usuarios" WHERE "Correo_Usuario" = $1', [email]);
        const user = result.rows[0];

        if (!user) {
            return res.status(400).json({ mensaje: 'Credenciales inválidas.' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(400).json({ mensaje: 'Credenciales inválidas.' });
        }

        const token = jwt.sign(
            {
                id: user.id,
                email: user.Correo_Usuario,
                nombre: user.Nom_Usuario,
                is_organizador: user.ES_Organizador,
                rol: user.Rol_Usuario 
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.status(200).json({
            mensaje: 'Inicio de sesión exitoso.',
            token: token,
            usuario: {
                id: user.id,
                nombre: user.Nom_Usuario,
                apellido: user.Ape_Usuario,
                email: user.Correo_Usuario,
                isOrganizer: user.ES_Organizador, 
                rol: user.Rol_Usuario 
            }
        });

    } catch (error) {
        console.error('Error al iniciar sesión:', error);
        res.status(500).json({ mensaje: 'Error interno del servidor al iniciar sesión.' });
    }
});

router.get('/me', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT "id", "Nom_Usuario", "Ape_Usuario", "Correo_Usuario", "Tlf_Usuario", "Fecha_Nacimiento", "ES_Organizador", "Rol_Usuario", "Puntos_Teycketan" FROM "Usuarios" WHERE "id" = $1',
            [req.user.id]
        );
        const user = result.rows[0];

        if (!user) {
            return res.status(404).json({ mensaje: 'Usuario no encontrado.' });
        }

        res.status(200).json({ usuario: user });
    } catch (error) {
        console.error('Error al obtener datos del usuario:', error);
        res.status(500).json({ mensaje: 'Error interno del servidor al obtener datos del usuario.' });
    }
});

/**
 * @route GET /:id/points
 * @description Obtiene los puntos Teycketan de un usuario específico.
 * @access Protegido (solo el propio usuario o un admin)
 */
router.get('/:id/points', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const requestingUserId = req.user.id; 

    if (id != requestingUserId && req.user.rol !== 'admin') {
        return res.status(403).json({ message: 'Acceso denegado. No tienes permiso para ver los puntos de este usuario.' });
    }

    try {
        const result = await pool.query(
            `SELECT "Puntos_Teycketan" FROM "Usuarios" WHERE "id" = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }

        res.status(200).json({ points: result.rows[0].Puntos_Teycketan || 0 });
    } catch (error) {
        console.error('Error al obtener puntos del usuario:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener puntos.' });
    }
});


module.exports = router;
