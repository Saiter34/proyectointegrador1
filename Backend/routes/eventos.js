// Backend/routes/eventos.js
// Este archivo maneja las rutas para la administración de eventos por el rol 'admin'.

const express = require('express');
const router = express.Router();
const pool = require('../db'); 
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware'); // Importa los middlewares

// --- RUTAS PROTEGIDAS PARA ADMINISTRADORES DE EVENTOS ---

/**
 * @route GET /api/admin/eventos/solicitudes/pendientes
 * @description Obtiene todas las solicitudes de eventos que están en estado 'Pendiente' para aprobación del admin.
 * @access Privado (solo administradores)
 */
router.get('/solicitudes/pendientes', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                E."Id_Evento", 
                E."Nom_Evento", 
                E."Fecha", -- Cambiado de "Fecha_Inicio" a "Fecha"
                E."Horario_Inicio", -- Nueva columna
                E."Horario_Fin",    -- Nueva columna
                E."Ubicacion", 
                E."Descripcion", 
                E."PrecioGeneral", 
                E."PrecioVIP", 
                E."PrecioConadis",
                U."Nom_Usuario" AS "NombreProveedor",
                U."Ape_Usuario" AS "ApellidoProveedor",
                U."Correo_Usuario" AS "EmailProveedor"
            FROM "Eventos" E
            JOIN "Usuarios" U ON E."Id_Organizador" = U.id
            WHERE E."Estado" = 'Pendiente'
            ORDER BY E."Fecha" ASC; -- Cambiado de "Fecha_Inicio" a "Fecha"
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener solicitudes de eventos pendientes para el administrador:', error);
        res.status(500).json({ error: 'Error interno del servidor al obtener solicitudes de eventos.' });
    }
});

/**
 * @route PUT /api/admin/eventos/solicitudes/:id/aprobar
 * @description Cambia el estado de una solicitud de evento de 'Pendiente' a 'Activo'.
 * @access Privado (solo administradores)
 */
router.put('/solicitudes/:id/aprobar', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { id } = req.params; // ID del evento a aprobar.

    try {
        const result = await pool.query(
            'UPDATE "Eventos" SET "Estado" = \'Activo\' WHERE "Id_Evento" = $1 AND "Estado" = \'Pendiente\' RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Solicitud de evento no encontrada o ya ha sido procesada.' });
        }
        res.json({ message: 'Solicitud de evento aprobada. El evento ahora está activo.', event: result.rows[0] });
    } catch (error) {
        console.error('Error al aprobar solicitud de evento:', error);
        res.status(500).json({ error: 'Error interno del servidor al aprobar el evento.' });
    }
});

/**
 * @route PUT /api/admin/eventos/solicitudes/:id/rechazar
 * @description Cambia el estado de una solicitud de evento de 'Pendiente' a 'Rechazado'.
 * @access Privado (solo administradores)
 */
router.put('/solicitudes/:id/rechazar', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { id } = req.params; // ID del evento a rechazar.

    try {
        const result = await pool.query(
            'UPDATE "Eventos" SET "Estado" = \'Rechazado\' WHERE "Id_Evento" = $1 AND "Estado" = \'Pendiente\' RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Solicitud de evento no encontrada o ya ha sido procesada.' });
        }
        res.json({ message: 'Solicitud de evento rechazada.', event: result.rows[0] });
    } catch (error) {
        console.error('Error al rechazar solicitud de evento:', error);
        res.status(500).json({ error: 'Error interno del servidor al rechazar el evento.' });
    }
});

/**
 * @route GET /api/admin/eventos/activos
 * @description Obtiene todos los eventos cuyo estado es 'Activo' (ya aprobados).
 * @access Privado (solo administradores)
 */
router.get('/activos', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    try {
        // Incluye las nuevas columnas de fecha y horario
        const result = await pool.query('SELECT "Id_Evento", "Nom_Evento", "Fecha", "Horario_Inicio", "Horario_Fin", "Ubicacion", "Descripcion", "PrecioGeneral", "PrecioVIP", "PrecioConadis", "Estado" FROM "Eventos" WHERE "Estado" = \'Activo\' ORDER BY "Fecha" ASC');
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener eventos activos para el administrador:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

module.exports = router;
