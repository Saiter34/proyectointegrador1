// Backend/routes/solicitudCliente.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

/**
 * @route POST /api/solicitudCliente
 * @description Permite a un cliente enviar una solicitud de evento futuro.
 * @access Privado (Cliente - requiere autenticación)
 */
router.post('/', authenticateToken, authorizeRole(['cliente']), async (req, res) => {
    const Id_Usuario = req.user.id; // El ID del usuario cliente autenticado
    const { asunto, descripcion } = req.body;

    // Validaciones
    if (!asunto || !descripcion) {
        return res.status(400).json({ message: 'Por favor, proporciona un asunto y una descripción para tu solicitud.' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const insertQuery = `
            INSERT INTO "SolicitudCliente" (
                "Id_Usuario", 
                "Asunto_Solicitud", 
                "Descripcion_Solicitud", 
                "Fecha_Envio", 
                "Estado_Solicitud"
            )
            VALUES ($1, $2, $3, NOW(), 'pendiente')
            RETURNING *;
        `;
        const result = await client.query(insertQuery, [
            Id_Usuario,
            asunto,
            descripcion
        ]);

        await client.query('COMMIT');
        res.status(201).json({ message: 'Solicitud enviada exitosamente. ¡Gracias por tu sugerencia!', solicitud: result.rows[0] });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al enviar solicitud de cliente:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al enviar la solicitud.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route GET /api/solicitudCliente/admin
 * @description Obtiene todas las solicitudes de clientes para el administrador.
 * @access Privado (Admin - requiere autenticación)
 */
router.get('/admin', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const query = `
            SELECT 
                sc."Id_Solicitud",
                sc."Asunto_Solicitud",
                sc."Descripcion_Solicitud",
                sc."Fecha_Envio",
                sc."Estado_Solicitud",
                u."Nom_Usuario",
                u."Ape_Usuario",
                u."Correo_Usuario"
            FROM "SolicitudCliente" sc
            JOIN "Usuarios" u ON sc."Id_Usuario" = u.id
            ORDER BY sc."Fecha_Envio" DESC;
        `;
        const result = await client.query(query);
        res.status(200).json({ message: 'Solicitudes de clientes obtenidas exitosamente.', solicitudes: result.rows });
    } catch (error) {
        console.error('Error al obtener solicitudes de clientes para el administrador:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener solicitudes.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route PUT /api/solicitudCliente/admin/:id/estado
 * @description Actualiza el estado de una solicitud de cliente (ej. a 'revisado' o 'rechazado').
 * @access Privado (Admin - requiere autenticación)
 */
router.put('/admin/:id/estado', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body; // El nuevo estado (ej. 'revisado', 'rechazado')

    if (!estado || !['revisado', 'rechazado'].includes(estado)) {
        return res.status(400).json({ message: 'Estado inválido proporcionado. Debe ser "revisado" o "rechazado".' });
    }

    let client;
    try {
        client = await pool.connect();
        const updateQuery = `
            UPDATE "SolicitudCliente"
            SET "Estado_Solicitud" = $1
            WHERE "Id_Solicitud" = $2
            RETURNING *;
        `;
        const result = await client.query(updateQuery, [estado, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Solicitud de cliente no encontrada.' });
        }

        res.status(200).json({ message: `Estado de la solicitud ${id} actualizado a '${estado}'.`, solicitud: result.rows[0] });
    } catch (error) {
        console.error('Error al actualizar estado de la solicitud de cliente:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al actualizar el estado de la solicitud.' });
    } finally {
        if (client) client.release();
    }
});

module.exports = router;