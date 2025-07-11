// Backend/routes/eventos.js
// Contiene rutas para la gestión de eventos por parte del ADMINISTRADOR.
// Estas rutas requieren autenticación y autorización de rol 'admin'.

const express = require('express');
const router = express.Router();
const pool = require('../db'); // Importa la configuración de conexión a PostgreSQL.
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware'); // Importa los middlewares

// Importa multer y path para la subida de imágenes
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // Para manejar archivos

// Directorio para guardar las imágenes (asegúrate de que exista o créalo)
const eventImagesDir = path.join(__dirname, '../../Fronted/img/event_images');

// Configuración de almacenamiento de Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Asegurarse de que el directorio exista
        if (!fs.existsSync(eventImagesDir)) {
            fs.mkdirSync(eventImagesDir, { recursive: true });
        }
        cb(null, eventImagesDir);
    },
    filename: (req, file, cb) => {
        // Generar un nombre de archivo único con la extensión original
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ storage: storage });

// --- Listas permitidas para validación (Consistentes con eventosprov.js) ---
const CATEGORIAS_VALIDAS = [
    'Deportiva', 'Concierto', 'Teatro', 'Música', 'Arte', 'Educación', 
    'Tecnología', 'Comedia', 'Infantil', 'Festival', 'Conferencia', 'Exposición'
]; 
const UBICACIONES_VALIDAS = ['San Marcos', 'Teatro Canut', 'Teatro Nacional', 'Estadio Nacional', 'Parque de la Exposición', 'Centro de Convenciones'];


/* --- RUTAS PARA ADMINISTRADORES --- */

/**
 * @route POST /
 * @description Crea un nuevo evento (accesible solo para administradores).
 * @access Privado (administrador)
 */
router.post('/', authenticateToken, authorizeRole(['admin']), upload.single('imagen_evento'), async (req, res) => {
    const {
        Nom_Evento, Descripcion, Fecha, Horario_Inicio, Horario_Fin, Categoria,
        PrecioGeneral, PrecioVIP, PrecioConadis, Id_Lugar, Reglas,
        Asientos_General_Disponibles, Asientos_VIP_Disponibles, Asientos_Conadis_Disponibles
    } = req.body;

    const URL_Imagen_Evento = req.file ? `/img/event_images/${req.file.filename}` : null;
    const Id_Organizador = req.user.id; // El admin es el organizador en este caso de creación directa

    try {
        const result = await pool.query(
            `INSERT INTO "Eventos" (
                "Nom_Evento", "Descripcion", "Fecha", "Horario_Inicio", "Horario_Fin", "Categoria",
                "PrecioGeneral", "PrecioVIP", "PrecioConadis", "Id_Lugar", "URL_Imagen_Evento",
                "Reglas", "Id_Organizador", "Estado", "fecha_creacion_evento",
                "Asientos_General_Disponibles", "Asientos_VIP_Disponibles", "Asientos_CONADIS_Disponibles"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'aprobado', CURRENT_TIMESTAMP, $14, $15, $16)
            RETURNING "Id_Evento"`,
            [
                Nom_Evento, Descripcion, Fecha, Horario_Inicio, Horario_Fin, Categoria,
                PrecioGeneral, PrecioVIP, PrecioConadis, Id_Lugar, URL_Imagen_Evento,
                Reglas, Id_Organizador,
                Asientos_General_Disponibles, Asientos_VIP_Disponibles, Asientos_Conadis_Disponibles
            ]
        );
        const newEvent = result.rows[0];
        res.status(201).json({ message: 'Evento creado y aprobado exitosamente', eventId: newEvent.Id_Evento });
    } catch (error) {
        console.error('Error al crear evento (Admin):', error.message);
        res.status(500).json({ message: 'Error interno del servidor al crear el evento.' });
    }
});

/**
 * @route GET /pendientes
 * @description Obtiene todos los eventos con estado 'pendiente' y su información de organizador y lugar.
 * @access Privado (Admin)
 */
router.get('/pendientes', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const query = `
            SELECT
                e."Id_Evento",
                e."Nom_Evento",
                e."Fecha",
                e."Horario_Inicio",
                e."Horario_Fin",
                e."Categoria",
                e."Id_Lugar", 
                e."Descripcion",
                e."PrecioGeneral",
                e."PrecioVIP",
                e."PrecioConadis",
                e."Estado",
                e."URL_Imagen_Evento", 
                e."URL_Mapa",
                e."Reglas",
                e."SolicitudDestacar",
                l."Nom_Lugar", 
                l."Ubicacion_Lugar" AS "Ubicacion", 
                o."Nom_Empresa" AS "NombreEmpresaOrganizador",
                u."Nom_Usuario" AS "NombreProveedor",
                u."Ape_Usuario" AS "ApellidoProveedor",
                u."Correo_Usuario" AS "EmailProveedor"
            FROM "Eventos" e
            LEFT JOIN "Lugares" l ON e."Id_Lugar" = l."Id_Lugar" 
            JOIN "Organizadores" o ON e."Id_Organizador" = o."Id_Organizador"
            JOIN "Usuarios" u ON o."Id_Usuario" = u.id
            WHERE e."Estado" = 'pendiente'
            ORDER BY e."Fecha" ASC, e."Horario_Inicio" ASC;
        `;
        const result = await client.query(query);

        const eventsWithFullDetails = await Promise.all(result.rows.map(async (event) => {
            const categoriasDeEntradasResult = await client.query(
                `SELECT 
                    "Nom_Categoria", 
                    "Precio" AS "precioRegular", 
                    "Stock_Total" AS "precioPreventa", 
                    "Stock_Disponible" AS "precioConadis", 
                    "Stock_Disponible" AS "stockDisponible" 
                FROM "Categorías de entradas"
                WHERE "Id_Evento" = $1
                ORDER BY "Nom_Categoria" ASC;`,
                [event.Id_Evento]
            );

            const categoriasDeEntradas = categoriasDeEntradasResult.rows.map(cat => ({
                Nom_Categoria: cat.Nom_Categoria,
                precioRegular: parseFloat(cat.precioRegular || 0).toFixed(2),
                precioPreventa: parseFloat(cat.precioPreventa || 0).toFixed(2),
                precioConadis: parseFloat(cat.precioConadis || 0).toFixed(2),
                stockDisponible: parseInt(cat.stockDisponible || 0)
            }));

            return {
                ...event,
                Reglas: event.Reglas || [],
                CategoriasDeEntradas: categoriasDeEntradas // Añadir las categorías de entradas con stock
            };
        }));

        res.status(200).json({ events: eventsWithFullDetails });
    } catch (error) {
        console.error('Error al obtener eventos pendientes (admin):', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener solicitudes de eventos pendientes.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route GET /aprobados
 * @description Obtiene todos los eventos que están en estado 'aprobado' con su información de organizador y lugar.
 * @access Privado (Admin)
 */
router.get('/aprobados', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const query = `
            SELECT
                e."Id_Evento",
                e."Nom_Evento",
                e."Fecha",
                e."Horario_Inicio",
                e."Horario_Fin",
                e."Categoria",
                e."Id_Lugar", 
                e."Descripcion",
                e."PrecioGeneral",
                e."PrecioVIP",
                e."PrecioConadis",
                e."Estado",
                e."URL_Imagen_Evento", 
                e."URL_Mapa",
                e."Reglas",
                e."SolicitudDestacar",
                l."Nom_Lugar", 
                l."Ubicacion_Lugar" AS "Ubicacion", 
                o."Nom_Empresa" AS "NombreEmpresaOrganizador",
                u."Nom_Usuario" AS "NombreProveedor",
                u."Ape_Usuario" AS "ApellidoProveedor",
                u."Correo_Usuario" AS "EmailProveedor"
            FROM "Eventos" e
            LEFT JOIN "Lugares" l ON e."Id_Lugar" = l."Id_Lugar" 
            JOIN "Organizadores" o ON e."Id_Organizador" = o."Id_Organizador"
            JOIN "Usuarios" u ON o."Id_Usuario" = u.id
            WHERE e."Estado" = 'aprobado'
            ORDER BY e."Fecha" DESC, e."Horario_Inicio" DESC;
        `;
        const result = await client.query(query);

        const eventsWithFullDetails = await Promise.all(result.rows.map(async (event) => {
            const categoriasDeEntradasResult = await client.query(
                `SELECT 
                    "Nom_Categoria", 
                    "Precio" AS "precioRegular", 
                    "Stock_Total" AS "precioPreventa", 
                    "Stock_Disponible" AS "precioConadis", 
                    "Stock_Disponible" AS "stockDisponible" 
                FROM "Categorías de entradas"
                WHERE "Id_Evento" = $1
                ORDER BY "Nom_Categoria" ASC;`,
                [event.Id_Evento]
            );

            const categoriasDeEntradas = categoriasDeEntradasResult.rows.map(cat => ({
                Nom_Categoria: cat.Nom_Categoria,
                precioRegular: parseFloat(cat.precioRegular || 0).toFixed(2),
                precioPreventa: parseFloat(cat.precioPreventa || 0).toFixed(2),
                precioConadis: parseFloat(cat.precioConadis || 0).toFixed(2),
                stockDisponible: parseInt(cat.stockDisponible || 0)
            }));

            return {
                ...event,
                Reglas: event.Reglas || [],
                CategoriasDeEntradas: categoriasDeEntradas // Añadir las categorías de entradas con stock
            };
        }));

        res.status(200).json({ events: eventsWithFullDetails });
    } catch (error) {
        console.error('Error al obtener eventos aprobados para el administrador:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener eventos aprobados.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route DELETE /eliminar/:id
 * @description Elimina un evento (sin importar su estado). Elimina también la imagen asociada.
 * @access Privado (Admin)
 */
router.delete('/eliminar/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const eventIdToDelete = req.params.id;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const eventImageResult = await client.query(
            `SELECT "URL_Imagen_Evento" FROM "Eventos" WHERE "Id_Evento" = $1`, 
            [eventIdToDelete]
        );

        if (eventImageResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Evento no encontrado.' });
        }
        const imageUrlToDelete = eventImageResult.rows[0].URL_Imagen_Evento; 

        // --- Borrar primero las categorías de entradas asociadas a este evento ---
        await client.query(`DELETE FROM "Categorías de entradas" WHERE "Id_Evento" = $1;`, [eventIdToDelete]);

        const deleteResult = await client.query(
            `DELETE FROM "Eventos" WHERE "Id_Evento" = $1 RETURNING *`,
            [eventIdToDelete]
        );

        if (deleteResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Evento no encontrado o no se pudo eliminar.' });
        }

        if (imageUrlToDelete && imageUrlToDelete.includes('/img/event_images/')) {
            const imagePath = path.join(__dirname, '..', '..', 'Fronted', imageUrlToDelete);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
                console.log(`Imagen eliminada del disco: ${imagePath}`);
            } else {
                console.warn(`Intento de eliminar imagen que no existe: ${imagePath}`);
            }
        }

        await client.query('COMMIT');
        res.status(200).json({ message: `Evento con ID ${eventIdToDelete} eliminado exitosamente.`, event: deleteResult.rows[0] });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al eliminar evento:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al eliminar el evento.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route PUT /:id/aprobar
 * @description Aprueba un evento pendiente, cambiando su estado a 'aprobado'.
 * @access Privado (Admin)
 */
router.put('/:id/aprobar', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const eventIdToApprove = req.params.id;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE "Eventos" SET "Estado" = 'aprobado' WHERE "Id_Evento" = $1 AND "Estado" = 'pendiente' RETURNING *`,
            [eventIdToApprove]
        );

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Solicitud de evento pendiente no encontrada o ya ha sido procesada.' });
        }

        await client.query('COMMIT');
        res.status(200).json({ message: `Evento con ID ${eventIdToApprove} aprobado exitosamente.`, event: result.rows[0] });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al aprobar solicitud de evento:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al aprobar solicitud de evento.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route PUT /:id/rechazar
 * @description Rechaza un evento pendiente, cambiando su estado a 'rechazado'.
 * @access Privado (Admin)
 */
router.put('/:id/rechazar', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const eventIdToReject = req.params.id;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE "Eventos" SET "Estado" = 'rechazado' WHERE "Id_Evento" = $1 AND "Estado" = 'pendiente' RETURNING *`,
            [eventIdToReject]
        );

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Solicitud de evento pendiente no encontrada o ya ha sido procesada.' });
        }

        await client.query('COMMIT');
        res.status(200).json({ message: `Solicitud de evento con ID ${eventIdToReject} rechazada.` });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al rechazar solicitud de evento:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al rechazar solicitud de evento.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route PUT /:id/destacar
 * @description Permite al administrador destacar un evento aprobado, cambiando su SolicitudDestacar a 'aprobado'.
 * @access Privado (Admin)
 */
router.put('/:id/destacar', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const eventIdToHighlight = req.params.id;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Solo se puede destacar si el evento está 'aprobado' y su SolicitudDestacar no es ya 'aprobado'
        const result = await client.query(
            `UPDATE "Eventos" SET "SolicitudDestacar" = 'aprobado'
             WHERE "Id_Evento" = $1 AND "Estado" = 'aprobado' AND "SolicitudDestacar" != 'aprobado'
             RETURNING *`,
            [eventIdToHighlight]
        );

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            const eventCheck = await client.query(
                `SELECT "Nom_Evento", "Estado", "SolicitudDestacar" FROM "Eventos" WHERE "Id_Evento" = $1`,
                [eventIdToHighlight]
            );
            if (eventCheck.rows.length === 0) {
                return res.status(404).json({ message: 'Evento no encontrado.' });
            }
            const eventStatus = eventCheck.rows[0].Estado;
            const highlightStatus = eventCheck.rows[0].SolicitudDestacar;

            if (eventStatus !== 'aprobado') {
                return res.status(400).json({ message: `No se puede destacar el evento "${eventCheck.rows[0].Nom_Evento}". Su estado actual es "${eventStatus}". Solo eventos aprobados pueden destacarse.` });
            }
            if (highlightStatus === 'aprobado') {
                return res.status(400).json({ message: `El evento "${eventCheck.rows[0].Nom_Evento}" ya está destacado.` });
            }
            if (highlightStatus === 'pendiente') {
                return res.status(400).json({ message: `El evento "${eventCheck.rows[0].Nom_Evento}" ya tiene una solicitud para destacar pendiente.` });
            }
            return res.status(400).json({ message: 'No se pudo destacar el evento. Posiblemente no está aprobado o ya se encuentra destacado.' });
        }

        await client.query('COMMIT');
        res.status(200).json({ message: `Evento "${result.rows[0].Nom_Evento}" (ID: ${eventIdToHighlight}) destacado exitosamente.`, event: result.rows[0] });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al destacar evento:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al destacar el evento.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route PUT /destacar/:id/aprobar
 * @description Aprueba una solicitud de destacar para un evento, cambiando su SolicitudDestacar a 'aprobado'.
 * Esta ruta es específica para las solicitudes pendientes de destacar.
 * @access Privado (Admin)
 */
router.put('/destacar/:id/aprobar', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const eventIdToApproveHighlight = req.params.id;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE "Eventos" SET "SolicitudDestacar" = 'aprobado'
             WHERE "Id_Evento" = $1 AND "SolicitudDestacar" = 'pendiente'
             RETURNING *`,
            [eventIdToApproveHighlight]
        );

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Solicitud de destacar pendiente no encontrada o ya ha sido procesada.' });
        }

        await client.query('COMMIT');
        res.status(200).json({ message: `Solicitud para destacar el evento ID ${eventIdToApproveHighlight} ha sido aprobada correctamente.`, event: result.rows[0] });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al aprobar solicitud de destacar evento:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al aprobar la solicitud de destacar.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route PUT /destacar/:id/rechazar
 * @description Rechaza una solicitud de destacar para un evento, cambiando su SolicitudDestacar a 'rechazado'.
 * Esta ruta es específica para las solicitudes pendientes de destacar.
 * @access Privado (Admin)
 */
router.put('/destacar/:id/rechazar', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const eventIdToRejectHighlight = req.params.id;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE "Eventos" SET "SolicitudDestacar" = 'rechazado'
             WHERE "Id_Evento" = $1 AND "SolicitudDestacar" = 'pendiente'
             RETURNING *`,
            [eventIdToRejectHighlight]
        );

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Solicitud de destacar pendiente no encontrada o ya ha sido procesada.' });
        }

        await client.query('COMMIT');
        res.status(200).json({ message: `Solicitud para destacar el evento ID ${eventIdToRejectHighlight} ha sido rechazada.`, event: result.rows[0] });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al rechazar solicitud de destacar evento:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al rechazar la solicitud de destacar.' });
    } finally {
        if (client) client.release();
    }
});


/**
 * @route GET /destacar/pendientes
 * @description Obtiene todas las solicitudes de eventos para destacar que están en estado 'pendiente'.
 * @access Privado (Admin)
 */
router.get('/destacar/pendientes', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const query = `
            SELECT
                e."Id_Evento",
                e."Nom_Evento",
                e."Fecha",
                e."Horario_Inicio",
                e."Horario_Fin",
                e."Categoria",
                e."Id_Lugar", 
                e."Descripcion",
                e."PrecioGeneral",
                e."PrecioVIP",
                e."PrecioConadis",
                e."Estado",
                e."URL_Imagen_Evento", 
                e."URL_Mapa",
                e."Reglas",
                e."SolicitudDestacar",
                l."Nom_Lugar", 
                l."Ubicacion_Lugar" AS "Ubicacion", 
                o."Nom_Empresa" AS "NombreEmpresaOrganizador",
                u."Nom_Usuario" AS "NombreProveedor",
                u."Ape_Usuario" AS "ApellidoProveedor",
                u."Correo_Usuario" AS "EmailProveedor"
            FROM "Eventos" e
            LEFT JOIN "Lugares" l ON e."Id_Lugar" = l."Id_Lugar" 
            JOIN "Organizadores" o ON e."Id_Organizador" = o."Id_Organizador"
            JOIN "Usuarios" u ON o."Id_Usuario" = u.id
            WHERE e."SolicitudDestacar" = 'pendiente'
            ORDER BY e."Fecha" ASC, e."Horario_Inicio" ASC;
        `;
        const result = await client.query(query);

        const requestsWithFullDetails = await Promise.all(result.rows.map(async (request) => {
            const categoriasDeEntradasResult = await client.query(
                `SELECT 
                    "Nom_Categoria", 
                    "Precio" AS "precioRegular", 
                    "Stock_Total" AS "precioPreventa", 
                    "Stock_Disponible" AS "precioConadis", 
                    "Stock_Disponible" AS "stockDisponible" 
                FROM "Categorías de entradas"
                WHERE "Id_Evento" = $1
                ORDER BY "Nom_Categoria" ASC;`,
                [request.Id_Evento]
            );

            const categoriasDeEntradas = categoriasDeEntradasResult.rows.map(cat => ({
                Nom_Categoria: cat.Nom_Categoria,
                precioRegular: parseFloat(cat.precioRegular || 0).toFixed(2),
                precioPreventa: parseFloat(cat.precioPreventa || 0).toFixed(2),
                precioConadis: parseFloat(cat.precioConadis || 0).toFixed(2),
                stockDisponible: parseInt(cat.stockDisponible || 0)
            }));

            return {
                ...request,
                Reglas: request.Reglas || [],
                CategoriasDeEntradas: categoriasDeEntradas // Añadir las categorías de entradas con stock
            };
        }));

        res.status(200).json({ requests: requestsWithFullDetails });
    } catch (error) {
        console.error('Error al obtener solicitudes para destacar (admin):', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener solicitudes para destacar.' });
    } finally {
        if (client) client.release();
    }
});

module.exports = router;
