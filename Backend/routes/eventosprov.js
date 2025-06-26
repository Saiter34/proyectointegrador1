// Backend/routes/eventosprov.js
// Este archivo maneja las rutas para que un proveedor/organizador gestione sus propios eventos.

const express = require('express');
const router = express.Router();
const pool = require('../db'); // Importa el pool de conexión a la base de datos (ruta relativa a Backend/)
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware'); // Importa los middlewares de autenticación y autorización

// --- RUTAS PROTEGIDAS PARA PROVEEDORES/ORGANIZADORES ---

/**
 * @route POST /api/proveedor/eventos/crear
 * @description Envía una solicitud de creación de un nuevo evento. El estado inicial es 'Pendiente'.
 * @access Privado (solo proveedores/organizadores autenticados)
 */
router.post('/eventos/crear', authenticateToken, authorizeRole(['proveedor', 'organizador']), async (req, res) => {
    // Captura los campos del body con los nuevos nombres
    const { nombre, fecha, horarioInicio, horarioFin, ubicacion, descripcion, precioGeneral, precioVIP } = req.body; 
    const proveedorId = req.user.id; 

    // Validación básica de los campos obligatorios.
    if (!nombre || !fecha || !horarioInicio || !horarioFin || !ubicacion || !descripcion || precioGeneral === undefined || precioGeneral === null) {
        return res.status(400).json({ error: 'Nombre, fecha, horario de inicio, horario de fin, ubicación, descripción y precio general son obligatorios para enviar la solicitud de evento.' });
    }

    // Calcular PrecioConadis automáticamente (20% menos del PrecioGeneral)
    const precioConadis = precioGeneral !== null ? (parseFloat(precioGeneral) * 0.80).toFixed(2) : null;
    console.log('PrecioConadis calculado (crear):', precioConadis);

    try {
        // Inserta el nuevo evento en la base de datos con un estado 'Pendiente'.
        const result = await pool.query(
            'INSERT INTO "Eventos" ("Nom_Evento", "Fecha", "Horario_Inicio", "Horario_Fin", "Ubicacion", "Descripcion", "PrecioGeneral", "PrecioVIP", "PrecioConadis", "Id_Organizador", "Estado") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
            [nombre, fecha, horarioInicio, horarioFin, ubicacion, descripcion, precioGeneral, precioVIP, precioConadis, proveedorId, 'Pendiente'] 
        );
        res.status(201).json({ message: 'Solicitud de evento creada exitosamente y pendiente de aprobación por el administrador.', event: result.rows[0] });
    } catch (error) {
        console.error('Error al enviar la solicitud de evento:', error);
        res.status(500).json({ error: 'Error interno del servidor al procesar la solicitud de evento.' });
    }
});

/**
 * @route GET /api/proveedor/eventos/estadisticas
 * @description Obtiene estadísticas de los eventos creados por el proveedor/organizador autenticado.
 * @access Privado (solo proveedores/organizadores autenticados)
 */
router.get('/eventos/estadisticas', authenticateToken, authorizeRole(['proveedor', 'organizador']), async (req, res) => {
    const proveedorId = req.user.id; // ID del proveedor autenticado.

    try {
        const eventosCount = await pool.query('SELECT COUNT(*) FROM "Eventos" WHERE "Id_Organizador" = $1', [proveedorId]);
        const eventosActivos = await pool.query('SELECT COUNT(*) FROM "Eventos" WHERE "Id_Organizador" = $1 AND "Estado" = \'Activo\'', [proveedorId]);
        
        // ¡¡¡AHORA T."Id_Evento" DEBERÍA EXISTIR EN LA TABLA TICKETS!!!
        const ventasPorEvento = await pool.query(`
            SELECT
                E."Id_Evento",
                E."Nom_Evento",
                COALESCE(SUM(T."Cantidad"), 0) AS "EntradasVendidas",
                COALESCE(SUM(T."Cantidad" * T."PrecioUnitario"), 0) AS "GananciaTotal"
            FROM "Eventos" E
            LEFT JOIN "Tickets" T ON E."Id_Evento" = T."Id_Evento" 
            WHERE E."Id_Organizador" = $1
            GROUP BY E."Id_Evento", E."Nom_Evento"
            ORDER BY E."Fecha" DESC;` 
        , [proveedorId]);

        res.json({
            totalEventosCreados: parseInt(eventosCount.rows[0].count),
            totalEventosActivos: parseInt(eventosActivos.rows[0].count),
            estadisticasEventos: ventasPorEvento.rows
        });

    }
    catch (error) {
        console.error('Error al obtener estadísticas del proveedor:', error);
        res.status(500).json({ error: 'Error interno del servidor al obtener estadísticas.' });
    }
});

/**
 * @route GET /api/proveedor/eventos/:id
 * @description Obtiene los detalles de un evento específico creado por el proveedor/organizador autenticado.
 * @access Privado (solo proveedores/organizadores autenticados)
 *
 * NOTA IMPORTANTE: Esta ruta DEBE estar DESPUÉS de cualquier ruta que tenga un segmento fijo
 * después de '/eventos/' (como '/eventos/estadisticas'), de lo contrario,
 * Express intentará interpretar el segmento fijo como un ID.
 */
router.get('/eventos/:id', authenticateToken, authorizeRole(['proveedor', 'organizador']), async (req, res) => {
    const { id } = req.params; // ID del evento solicitado desde los parámetros de la URL.
    const proveedorId = req.user.id; // ID del proveedor autenticado.

    try {
        const result = await pool.query(
            'SELECT "Id_Evento", "Nom_Evento", "Fecha", "Horario_Inicio", "Horario_Fin", "Ubicacion", "Descripcion", "PrecioGeneral", "PrecioVIP", "PrecioConadis", "Estado" FROM "Eventos" WHERE "Id_Evento" = $1 AND "Id_Organizador" = $2',
            [id, proveedorId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Evento no encontrado o no pertenece a este proveedor.' });
        }
        res.json(result.rows[0]); // Devuelve los detalles del evento.
    } catch (error) {
        console.error('Error al obtener el evento específico del proveedor:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});


/**
 * @route GET /api/proveedor/eventos
 * @description Obtiene todos los eventos (pendientes, activos, etc.) creados por el proveedor/organizador autenticado.
 * @access Privado (solo proveedores/organizadores autenticados)
 */
router.get('/eventos', authenticateToken, authorizeRole(['proveedor', 'organizador']), async (req, res) => {
    const proveedorId = req.user.id; // ID del proveedor autenticado.

    try {
        const result = await pool.query('SELECT "Id_Evento", "Nom_Evento", "Fecha", "Horario_Inicio", "Horario_Fin", "Ubicacion", "Descripcion", "PrecioGeneral", "PrecioVIP", "PrecioConadis", "Estado" FROM "Eventos" WHERE "Id_Organizador" = $1 ORDER BY "Fecha" DESC', [proveedorId]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener los eventos del proveedor:', error);
        res.status(500).json({ error: 'Error interno del servidor al obtener eventos.' });
    }
});


/**
 * @route PUT /api/proveedor/eventos/:id
 * @description Actualiza los detalles de un evento existente creado por el proveedor/organizador autenticado.
 * @access Privado (solo proveedores/organizadores autenticados)
 */
router.put('/eventos/:id', authenticateToken, authorizeRole(['proveedor', 'organizador']), async (req, res) => {
    const { id } = req.params; // ID del evento a actualizar.
    const { nombre, fecha, horarioInicio, horarioFin, ubicacion, descripcion, precioGeneral, precioVIP } = req.body; 
    const proveedorId = req.user.id; // ID del proveedor autenticado.

    // Validación básica de los campos obligatorios para la actualización
    if (!nombre || !fecha || !horarioInicio || !horarioFin || !ubicacion || !descripcion || precioGeneral === undefined || precioGeneral === null) {
        return res.status(400).json({ error: 'Todos los campos (nombre, fecha, horario de inicio, horario de fin, ubicación, descripción, precio general) son obligatorios para actualizar el evento.' });
    }

    // Calcular PrecioConadis automáticamente para la actualización
    const precioConadis = precioGeneral !== null ? (parseFloat(precioGeneral) * 0.80).toFixed(2) : null;
    
    try {
        const result = await pool.query(
            'UPDATE "Eventos" SET "Nom_Evento" = $1, "Fecha" = $2, "Horario_Inicio" = $3, "Horario_Fin" = $4, "Ubicacion" = $5, "Descripcion" = $6, "PrecioGeneral" = $7, "PrecioVIP" = $8, "PrecioConadis" = $9 WHERE "Id_Evento" = $10 AND "Id_Organizador" = $11 RETURNING *',
            [nombre, fecha, horarioInicio, horarioFin, ubicacion, descripcion, precioGeneral, precioVIP, precioConadis, id, proveedorId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Evento no encontrado o no pertenece a este proveedor.' });
        }
        res.json({ message: 'Evento actualizado exitosamente.', event: result.rows[0] });
    } catch (error) {
        console.error('Error al actualizar el evento:', error);
        res.status(500).json({ error: 'Error interno del servidor al actualizar el evento.' });
    }
});

module.exports = router;
