// Backend/routes/intermediario.js
// Este archivo maneja las rutas para que el administrador gestione las solicitudes de registro de organizadores.

const express = require('express');
const router = express.Router();
const pool = require('../db'); 
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware'); // Importa los middlewares

// --- RUTAS PROTEGIDAS PARA ADMINISTRADORES DE SOLICITUDES DE ORGANIZADOR ---
// Todas estas rutas requieren autenticación y rol de 'admin'.

/**
 * @route GET /api/admin/solicitudes/organizer-requests/pending
 * @description Obtiene todas las solicitudes de registro de organizadores que están en estado 'pendiente'.
 * @access Privado (solo administradores)
 */
router.get('/organizer-requests/pending', authenticateToken, authorizeRole(['admin']), async (req, res) => {
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
                o."Estado_Solicitud",
                o.fecha_solicitud AS "Fecha_Solicitud"
            FROM "Usuarios" u
            JOIN "Organizadores" o ON u.id = o."Id_Usuario"
            WHERE o."Estado_Solicitud" = 'pendiente'
            ORDER BY o.fecha_solicitud ASC;` 
        );
        res.status(200).json({ requests: result.rows });
    } catch (error) {
        console.error('Error al obtener solicitudes pendientes de organizador:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener solicitudes pendientes.' });
    }
});

/**
 * @route POST /api/admin/solicitudes/organizer-requests/approve/:userId
 * @description Aprueba una solicitud de registro de organizador, cambiando su rol a 'organizador'.
 * @access Privado (solo administradores)
 */
router.post('/organizer-requests/approve/:userId', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const userIdToApprove = req.params.userId;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN'); 

        const userUpdateResult = await client.query(
            `UPDATE "Usuarios" SET "Rol_Usuario" = 'organizador', "ES_Organizador" = TRUE WHERE id = $1 AND "Rol_Usuario" = 'pendiente_organizador'`,
            [userIdToApprove]
        );

        if (userUpdateResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Usuario no encontrado o su rol no es pendiente de organizador.' });
        }

        const organizerRequestUpdateResult = await client.query(
            `UPDATE "Organizadores" SET "Estado_Solicitud" = 'aprobado' WHERE "Id_Usuario" = $1 AND "Estado_Solicitud" = 'pendiente'`,
            [userIdToApprove]
        );

        if (organizerRequestUpdateResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Solicitud de organizador pendiente no encontrada.' });
        }

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

/**
 * @route POST /api/admin/solicitudes/organizer-requests/reject/:userId
 * @description Rechaza una solicitud de registro de organizador, revirtiendo su rol a 'cliente'.
 * @access Privado (solo administradores)
 */
router.post('/organizer-requests/reject/:userId', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const userIdToReject = req.params.userId;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const userUpdateResult = await client.query(
            `UPDATE "Usuarios" SET "Rol_Usuario" = 'cliente', "ES_Organizador" = FALSE WHERE id = $1 AND "Rol_Usuario" = 'pendiente_organizador'`,
            [userIdToReject]
        );

        if (userUpdateResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Usuario no encontrado o su rol no es pendiente de organizador.' });
        }

        const organizerRequestUpdateResult = await client.query(
            `UPDATE "Organizadores" SET "Estado_Solicitud" = 'rechazado' WHERE "Id_Usuario" = $1 AND "Estado_Solicitud" = 'pendiente'`,
            [userIdToReject]
        );

        if (organizerRequestUpdateResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Solicitud de organizador pendiente no encontrada.' });
        }

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

/**
 * @route GET /api/admin/solicitudes/organizers/approved
 * @description Obtiene la lista de organizadores ya aprobados.
 * @access Privado (solo administradores)
 */
router.get('/organizers/approved', authenticateToken, authorizeRole(['admin']), async (req, res) => {
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
            WHERE o."Estado_Solicitud" = 'aprobado' AND u."Rol_Usuario" = 'organizador';`
        );
        res.status(200).json({ approvedOrganizers: result.rows });
    } catch (error) {
        console.error('Error al obtener organizadores aprobados:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener organizadores aprobados.' });
    }
});

/**
 * @route POST /api/admin/solicitudes/organizers/remove/:userId
 * @description Elimina un organizador (revierte su rol a 'cliente' y elimina la entrada de organizador),
 * pero solo si no tiene eventos asociados.
 * @access Privado (solo administradores)
 */
router.post('/organizers/remove/:userId', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const userIdToRemove = req.params.userId;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Paso 1: Obtener el Id_Organizador de la tabla "Organizadores"
        // para el userId dado. Necesitamos este ID para buscar en Eventos.
        const organizerIdResult = await client.query(
            `SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1 AND "Estado_Solicitud" = 'aprobado'`,
            [userIdToRemove]
        );

        if (organizerIdResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Organizador no encontrado o no está aprobado.' });
        }

        const organizerId = organizerIdResult.rows[0].Id_Organizador;

        // Paso 2: Verificar si el organizador tiene eventos asociados
        // ¡CORRECCIÓN AQUÍ! Cambiado "Fk_Id_Organizador" a "Id_Organizador"
        const eventsCheckResult = await client.query(
            `SELECT COUNT(*) FROM "Eventos" WHERE "Id_Organizador" = $1`,
            [organizerId]
        );

        const eventCount = parseInt(eventsCheckResult.rows[0].count, 10);

        if (eventCount > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `No se puede eliminar el organizador. Tiene ${eventCount} evento(s) asociado(s). Por favor, gestione sus eventos primero.` });
        }

        // Paso 3: Revertir el rol del usuario a 'cliente' y ES_Organizador a FALSE.
        const userUpdateResult = await client.query(
            `UPDATE "Usuarios" SET "Rol_Usuario" = 'cliente', "ES_Organizador" = FALSE WHERE id = $1 AND "Rol_Usuario" = 'organizador'`,
            [userIdToRemove]
        );

        if (userUpdateResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Usuario no encontrado o no es un organizador activo.' });
        }

        // Paso 4: Eliminar la entrada de la tabla "Organizadores".
        const organizerDeleteResult = await client.query(
            `DELETE FROM "Organizadores" WHERE "Id_Usuario" = $1 AND "Estado_Solicitud" = 'aprobado'`,
            [userIdToRemove]
        );

        if (organizerDeleteResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Entrada de organizador aprobado no encontrada para este usuario.' });
        }

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

module.exports = router;
