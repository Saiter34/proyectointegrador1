const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware'); // Asegúrate de que la ruta sea correcta

/**
 * @route GET /notificaciones/usuario/:userId
 * @description Obtiene todas las notificaciones de un usuario.
 * @access Privado (solo el propio usuario o admin)
 */
router.get('/usuario/:userId', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    const requestingUserId = req.user.id; // ID del usuario que hace la solicitud

    // Seguridad: Asegurar que solo el propio usuario o un admin pueda ver sus notificaciones
    if (parseInt(userId) !== requestingUserId && req.user.rol !== 'admin') {
        return res.status(403).json({ message: 'Acceso denegado. No tienes permiso para ver estas notificaciones.' });
    }

    try {
        const result = await pool.query(
            `SELECT "Id_Notificacion", "Mensaje", "Fecha_Creacion", "Leida", "Tipo_Notificacion"
             FROM "Notificaciones"
             WHERE "Id_Usuario" = $1
             ORDER BY "Fecha_Creacion" DESC`,
            [userId]
        );
        res.status(200).json({ notifications: result.rows });
    } catch (error) {
        console.error('Error al obtener notificaciones del usuario:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener notificaciones.' });
    }
});

/**
 * @route PUT /notificaciones/:id/mark-as-read
 * @description Marca una notificación específica como leída.
 * @access Privado (solo el propio usuario o admin)
 */
router.put('/:id/mark-as-read', authenticateToken, async (req, res) => {
    const { id } = req.params; // Id_Notificacion
    const requestingUserId = req.user.id;

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Verificar que la notificación exista y pertenezca al usuario o que el usuario sea admin
        const notifCheck = await client.query(
            `SELECT "Id_Usuario" FROM "Notificaciones" WHERE "Id_Notificacion" = $1`,
            [id]
        );

        if (notifCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Notificación no encontrada.' });
        }

        const notificationOwnerId = notifCheck.rows[0].Id_Usuario;

        if (notificationOwnerId !== requestingUserId && req.user.rol !== 'admin') {
            await client.query('ROLLBACK');
            return res.status(403).json({ message: 'Acceso denegado. No tienes permiso para modificar esta notificación.' });
        }

        const result = await client.query(
            `UPDATE "Notificaciones" SET "Leida" = TRUE WHERE "Id_Notificacion" = $1 RETURNING *`,
            [id]
        );

        await client.query('COMMIT');
        res.status(200).json({ message: 'Notificación marcada como leída.', notification: result.rows[0] });
    } catch (error) {
        if (client) {
            await client.query('ROLLBACK');
        }
        console.error('Error al marcar notificación como leída:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al marcar notificación como leída.' });
    } finally {
        if (client) {
            client.release();
        }
    }
});

/**
 * @route POST /notificaciones
 * @description Crea una nueva notificación.
 * @access Privado (solo el propio usuario o admin)
 */
router.post('/', authenticateToken, async (req, res) => {
    const { id_usuario, mensaje, tipo_notificacion } = req.body;

    // Seguridad: Un usuario solo puede crear notificaciones para sí mismo, a menos que sea admin
    if (req.user.id.toString() !== id_usuario.toString() && req.user.rol !== 'admin') {
        return res.status(403).json({ message: 'Acceso denegado. No tienes permiso para crear notificaciones para este usuario.' });
    }

    if (!mensaje) {
        return res.status(400).json({ message: 'El mensaje de la notificación es requerido.' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO "Notificaciones" ("Id_Usuario", "Mensaje", "Fecha_Creacion", "Leida", "Tipo_Notificacion") 
             VALUES ($1, $2, NOW(), FALSE, $3) RETURNING *`,
            [id_usuario, mensaje, tipo_notificacion || 'general'] // 'general' como tipo por defecto
        );
        res.status(201).json({ message: 'Notificación creada exitosamente.', notification: result.rows[0] });
    } catch (error) {
        console.error('Error al crear notificación:', error);
        res.status(500).json({ message: 'Error interno del servidor al crear notificación.' });
    }
});

module.exports = router;
