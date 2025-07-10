const express = require('express');
const router = express.Router();
const pool = require('../db'); 
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');

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
                "Puntos_Teycketan",
                "Usado_Primera_Compra" 
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), false, false, 'cliente', 0, FALSE) 
            RETURNING "id", "Nom_Usuario", "Correo_Usuario", "Rol_Usuario", "Puntos_Teycketan", "Usado_Primera_Compra"`, 
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
            { expiresIn: '1d' }
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
                rol: user.Rol_Usuario,
                puntos: user.Puntos_Teycketan,
                usadoPrimeraCompra: user.Usado_Primera_Compra,
                telefono: user.Tlf_Usuario
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
            'SELECT "id", "Nom_Usuario", "Ape_Usuario", "Correo_Usuario", "Tlf_Usuario", "Fecha_Nacimiento", "ES_Organizador", "Rol_Usuario", "Puntos_Teycketan", "Usado_Primera_Compra" FROM "Usuarios" WHERE "id" = $1', 
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

// ENDPOINT: Actualizar perfil del usuario
router.put('/:id', authenticateToken, async (req, res) => {
    const userId = req.params.id;
    const { Nom_Usuario, Ape_Usuario, Tlf_Usuario } = req.body; // No permitimos cambiar email desde aquí

    // Asegurarse de que el usuario que intenta actualizar sea el mismo que inició sesión
    if (req.user.id.toString() !== userId && req.user.rol !== 'admin') {
        return res.status(403).json({ mensaje: 'Acceso denegado. No tienes permiso para editar este perfil.' });
    }

    let client; // Declarar client aquí para usarlo en finally
    try {
        client = await pool.connect(); // Asignar client aquí
        await client.query('BEGIN'); // Iniciar transacción

        const query = `
            UPDATE "Usuarios"
            SET 
                "Nom_Usuario" = COALESCE($1, "Nom_Usuario"),
                "Ape_Usuario" = COALESCE($2, "Ape_Usuario"),
                "Tlf_Usuario" = COALESCE($3, "Tlf_Usuario")
            WHERE "id" = $4
            RETURNING "id", "Nom_Usuario", "Ape_Usuario", "Tlf_Usuario", "Correo_Usuario", "Rol_Usuario";
        `;
        const values = [Nom_Usuario, Ape_Usuario, Tlf_Usuario, userId];

        const result = await client.query(query, values);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK'); // Revertir si no se encontró el usuario
            return res.status(404).json({ mensaje: 'Usuario no encontrado.' });
        }

        // NUEVA LÓGICA: Crear notificación al actualizar perfil
        await client.query(
            `INSERT INTO "Notificaciones" ("Id_Usuario", "Mensaje", "Fecha_Creacion", "Leida", "Tipo_Notificacion") 
             VALUES ($1, $2, NOW(), FALSE, $3)`,
            [userId, 'Tus datos de perfil han sido actualizados exitosamente.', 'perfil_actualizado']
        );

        await client.query('COMMIT'); // Confirmar la transacción
        res.status(200).json({ mensaje: 'Perfil actualizado exitosamente.', usuario: result.rows[0] });

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK'); // Revertir la transacción en caso de error
        }
        console.error('Error al actualizar perfil de usuario y crear notificación:', error);
        res.status(500).json({ mensaje: 'Error interno del servidor al actualizar el perfil.' });
    } finally {
        if (client) {
            client.release(); // Liberar el cliente
        }
    }
});


// Endpoint para actualizar Usado_Primera_Compra (llamado después de la primera compra con descuento)
router.put('/:id/mark-first-purchase-used', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const requestingUserId = req.user.id;

    if (id != requestingUserId && req.user.rol !== 'admin') {
        return res.status(403).json({ message: 'Acceso denegado. No tienes permiso para actualizar este usuario.' });
    }

    try {
        const result = await pool.query(
            `UPDATE "Usuarios" SET "Usado_Primera_Compra" = TRUE WHERE "id" = $1 RETURNING "id", "Usado_Primera_Compra"`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }

        res.status(200).json({ message: 'Estado de primera compra actualizado exitosamente.', user: result.rows[0] });
    } catch (error) {
        console.error('Error al actualizar estado de primera compra:', error);
        res.status(500).json({ message: 'Error interno del servidor al actualizar estado de primera compra.' });
    }
});

module.exports = router;
