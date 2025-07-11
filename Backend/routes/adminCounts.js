const express = require('express');
const router = express.Router();
const pool = require('../db'); // Importa el pool de PostgreSQL desde tu archivo db.js
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware'); // Importa tus middlewares

// Middleware específico para autorizar solo a administradores.
const authorizeAdmin = authorizeRole(['admin']); 

/**
 * @brief Función genérica para obtener el recuento de elementos pendientes de una tabla.
 * @param {string} tableName - El nombre de la tabla en la base de datos.
 * @param {string} statusColumnName - El nombre de la columna que contiene el estado.
 * @param {object} res - El objeto de respuesta de Express.
 */
async function getPendingCount(tableName, statusColumnName, res) {
    try {
        // Usamos comillas dobles para asegurar que PostgreSQL interprete los nombres
        // de tablas y columnas exactamente como están (sensible a mayúsculas/minúsculas).
        const queryText = `SELECT COUNT(*) AS count FROM "${tableName}" WHERE "${statusColumnName}" = $1`;
        const result = await pool.query(queryText, ['pendiente']);
        
        if (result.rows.length > 0) {
            res.json({ count: result.rows[0].count });
        } else {
            res.json({ count: 0 });
        }
    } catch (err) {
        console.error(`Error al obtener el recuento de "${tableName}" (columna: "${statusColumnName}"):`, err);
        // Envía un mensaje de error más detallado al frontend para depuración
        res.status(500).json({ message: `Error interno del servidor al obtener el recuento de ${tableName}.`, error: err.message });
    }
}

// Rutas para obtener el recuento de elementos pendientes, protegidas por autenticación y autorización de admin.

router.get('/solicitudCliente/count/estado/pendiente', authenticateToken, authorizeAdmin, async (req, res) => {
    // Asumo que 'SolicitudCliente' y 'Estado_Solicitud' son correctos.
    await getPendingCount('SolicitudCliente', 'Estado_Solicitud', res); 
});

router.get('/contactoProveedor/count/estado/pendiente', authenticateToken, authorizeAdmin, async (req, res) => {
    // Asumo que 'ContactoProveedor' y 'Estado' son correctos.
    await getPendingCount('ContactoProveedor', 'Estado', res);
});

router.get('/solicitudProveedor/count/estado/pendiente', authenticateToken, authorizeAdmin, async (req, res) => {
    // CORREGIDO: La tabla para solicitudes de proveedor es "Organizadores".
    await getPendingCount('Organizadores', 'Estado_Solicitud', res); 
});

router.get('/eventos/count/estado/pendiente', authenticateToken, authorizeAdmin, async (req, res) => {
    // CORREGIDO: La columna de estado en la tabla "Eventos" es "Estado".
    await getPendingCount('Eventos', 'Estado', res); 
});

router.get('/solicitudDestacar/count/estado/pendiente', authenticateToken, authorizeAdmin, async (req, res) => {
    // CORREGIDO: "SolicitudDestacar" es una COLUMNA en la tabla "Eventos".
    // Asumo que esta columna contiene un estado de texto como 'pendiente'.
    await getPendingCount('Eventos', 'SolicitudDestacar', res); 
});

module.exports = router;
