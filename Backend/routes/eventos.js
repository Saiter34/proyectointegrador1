// Backend/routes/eventos.js
// Este archivo ahora contiene rutas para administradores y rutas públicas para el cliente.

const express = require('express');
const router = express.Router();
const pool = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Directorio donde se guardarán las imágenes de los eventos
const eventImagesDir = path.join(__dirname, '..', '..', 'Fronted', 'img', 'event_images');

// Configuración de Multer para la subida de imágenes de eventos (usado en rutas de admin si aplican)
const uploadMiddleware = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            if (!fs.existsSync(eventImagesDir)) {
                fs.mkdirSync(eventImagesDir, { recursive: true });
            }
            cb(null, eventImagesDir);
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
        }
    })
}).single('imagenEvento');

// --- Listas permitidas para validación (Consistentes con eventosprov.js) ---
const CATEGORIAS_VALIDAS = [
    'Deportiva', 'Concierto', 'Teatro', 'Música', 'Arte', 'Educación', 
    'Tecnología', 'Comedia', 'Infantil', 'Festival', 'Conferencia', 'Exposición'
]; 
const UBICACIONES_VALIDAS = ['San Marcos', 'Teatro Canut', 'Teatro Nacional', 'Estadio Nacional', 'Parque de la Exposición', 'Centro de Convenciones'];


// --- RUTAS PARA ADMINISTRADORES ---
// Estas rutas se montarán en index.js bajo '/api/admin/eventos' con el middleware de rol 'admin'.

/**
 * @route GET /pendientes
 * @description Obtiene todos los eventos con estado 'pendiente' y su información de organizador y lugar.
 * @access Privado (Admin)
 */
router.get('/pendientes', async (req, res) => {
    try {
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
                e."URL_Imagen_Evento", -- Usar directamente el nombre de la columna
                e."URL_Mapa",
                e."Reglas",
                e."Asientos_General_Disp", 
                e."Asientos_VIP_Disp", 
                e."Asientos_Conadis_Disp", 
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
        const result = await pool.query(query);

        const eventsWithParsedData = result.rows.map(event => ({
            ...event,
            Reglas: event.Reglas || [] 
        }));

        res.status(200).json({ events: eventsWithParsedData });
    } catch (error) {
        console.error('Error al obtener eventos pendientes (admin):', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener solicitudes de eventos pendientes.' });
    }
});

/**
 * @route GET /aprobados
 * @description Obtiene todos los eventos que están en estado 'aprobado' con su información de organizador y lugar.
 * @access Privado (Admin)
 */
router.get('/aprobados', async (req, res) => {
    try {
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
                e."URL_Imagen_Evento", -- Usar directamente el nombre de la columna
                e."URL_Mapa",
                e."Reglas",
                e."Asientos_General_Disp", 
                e."Asientos_VIP_Disp", 
                e."Asientos_Conadis_Disp", 
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
        const result = await pool.query(query);

        const eventsWithParsedData = result.rows.map(event => ({
            ...event,
            Reglas: event.Reglas || [] 
        }));

        res.status(200).json({ events: eventsWithParsedData });
    } catch (error) {
        console.error('Error al obtener eventos aprobados para el administrador:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener eventos aprobados.' });
    }
});

/**
 * @route DELETE /eliminar/:id
 * @description Elimina un evento (sin importar su estado). Elimina también la imagen asociada.
 * @access Privado (Admin)
 */
router.delete('/eliminar/:id', async (req, res) => {
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
router.put('/:id/aprobar', async (req, res) => {
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
router.put('/:id/rechazar', async (req, res) => {
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
router.put('/:id/destacar', async (req, res) => {
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
 * @route GET /destacar/pendientes
 * @description Obtiene todas las solicitudes de eventos para destacar que están en estado 'pendiente'.
 * @access Privado (Admin)
 */
router.get('/destacar/pendientes', async (req, res) => {
    try {
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
                e."URL_Imagen_Evento", -- Usar directamente el nombre de la columna
                e."URL_Mapa",
                e."Reglas",
                e."Asientos_General_Disp", 
                e."Asientos_VIP_Disp", 
                e."Asientos_Conadis_Disp", 
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
        const result = await pool.query(query);

        const requestsWithParsedData = result.rows.map(request => ({
            ...request,
            Reglas: request.Reglas || [] 
        }));

        res.status(200).json({ requests: requestsWithParsedData });
    } catch (error) {
        console.error('Error al obtener solicitudes para destacar (admin):', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener solicitudes para destacar.' });
    }
});

/**
 * @route PUT /destacar/:id/aprobar
 * @description Aprueba una solicitud para destacar un evento, cambiando su SolicitudDestacar a 'aprobado'.
 * @access Privado (Admin)
 */
router.put('/destacar/:id/aprobar', async (req, res) => {
    const eventIdToApprove = req.params.id;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE "Eventos" SET "SolicitudDestacar" = 'aprobado' WHERE "Id_Evento" = $1 AND "SolicitudDestacar" = 'pendiente' RETURNING *`,
            [eventIdToApprove]
        );

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Solicitud para destacar pendiente no encontrada o ya ha sido procesada.' });
        }

        await client.query('COMMIT');
        res.status(200).json({ message: `Solicitud para destacar el evento con ID ${eventIdToApprove} aprobada exitosamente.`, event: result.rows[0] });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al aprobar solicitud para destacar evento:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al aprobar solicitud para destacar evento.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route PUT /destacar/:id/rechazar
 * @description Rechaza una solicitud para destacar un evento, cambiando su SolicitudDestacar a 'rechazado'.
 * @access Privado (Admin)
 */
router.put('/destacar/:id/rechazar', async (req, res) => {
    const eventIdToReject = req.params.id;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE "Eventos" SET "SolicitudDestacar" = 'rechazado' WHERE "Id_Evento" = $1 AND "SolicitudDestacar" = 'pendiente' RETURNING *`,
            [eventIdToReject]
        );

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Solicitud para destacar pendiente no encontrada o ya ha sido procesada.' });
        }

        await client.query('COMMIT');
        res.status(200).json({ message: `Solicitud para destacar el evento con ID ${eventIdToReject} rechazada.` });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al rechazar solicitud para destacar evento:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al rechazar solicitud para destacar evento.' });
    } finally {
        if (client) client.release();
    }
});


/**
 * @route GET /categorias
 * @description Obtiene una lista de todas las categorías únicas de eventos aprobados.
 * @access Privado (Admin)
 */
router.get('/categorias', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT "Categoria" FROM "Eventos" WHERE "Estado" = 'aprobado' AND "Categoria" IS NOT NULL ORDER BY "Categoria" ASC;`
        );
        const categories = result.rows.map(row => row.Categoria);
        res.status(200).json({ categories: categories });
    } catch (error) {
        console.error('Error al obtener categorías de eventos:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener categorías.' });
    }
});

/**
 * @route GET /por-categoria/:categoryName
 * @description Obtiene todos los eventos aprobados de una categoría específica con su información de organizador y lugar.
 * @access Privado (Admin)
 */
router.get('/por-categoria/:categoryName', async (req, res) => {
    const { categoryName } = req.params;
    try {
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
                e."URL_Imagen_Evento", -- Usar directamente el nombre de la columna
                e."URL_Mapa",
                e."Reglas",
                e."Asientos_General_Disp", 
                e."Asientos_VIP_Disp", 
                e."Asientos_Conadis_Disp", 
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
            WHERE e."Estado" = 'aprobado' AND e."Categoria" = $1
            ORDER BY e."Fecha" ASC, e."Horario_Inicio" ASC;
        `;
        const result = await pool.query(query, [categoryName]);

        const eventsWithParsedData = result.rows.map(event => ({
            ...event,
            Reglas: event.Reglas || []
        }));

        res.status(200).json({ events: eventsWithParsedData });
    } catch (error) {
        console.error(`Error al obtener eventos para la categoría ${categoryName}:`, error.message);
        res.status(500).json({ message: `Error interno del servidor al obtener eventos para la categoría ${categoryName}.` });
    }
});

/* --- RUTAS PÚBLICAS PARA EL CLIENTE --- */
// Estas rutas se montarán en index.js bajo '/api/eventos'

/**
 * @route GET /aprobados-para-cliente
 * @description Obtiene todos los eventos aprobados para mostrar en la interfaz del cliente.
 * Incluye información del lugar para la ubicación.
 * @access Público
 */
router.get('/aprobados-para-cliente', async (req, res) => {
    try {
        const query = `
            SELECT
                e."Id_Evento",
                e."Nom_Evento",
                e."Fecha",
                e."Horario_Inicio",
                e."Horario_Fin",
                e."Categoria",
                e."Descripcion",
                e."PrecioGeneral",
                e."PrecioVIP",
                e."PrecioConadis",
                e."Estado",
                e."URL_Imagen_Evento", -- Usar directamente el nombre de la columna
                e."URL_Mapa",
                e."Reglas",
                l."Nom_Lugar", 
                l."Ubicacion_Lugar" AS "Ubicacion" 
            FROM "Eventos" e
            LEFT JOIN "Lugares" l ON e."Id_Lugar" = l."Id_Lugar"
            WHERE e."Estado" = 'aprobado'
            ORDER BY e."Fecha" ASC, e."Horario_Inicio" ASC;
        `;
        const result = await pool.query(query);

        const eventsWithParsedData = result.rows.map(event => ({
            ...event,
            Reglas: event.Reglas || []
        }));

        res.status(200).json({ events: eventsWithParsedData });
    } catch (error) {
        console.error('Error al obtener eventos aprobados para el cliente:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener eventos aprobados para el cliente.' });
    }
});

/**
 * @route GET /destacados
 * @description Obtiene eventos aprobados que han sido marcados como 'destacado' para el carrusel principal.
 * @access Público
 */
router.get('/destacados', async (req, res) => {
    try {
        const query = `
            SELECT
                e."Id_Evento",
                e."Nom_Evento",
                e."Fecha",
                e."Horario_Inicio",
                e."Horario_Fin",
                e."Categoria",
                e."Descripcion",
                e."PrecioGeneral",
                e."PrecioVIP",
                e."PrecioConadis",
                e."Estado",
                e."URL_Imagen_Evento", -- Usar directamente el nombre de la columna
                e."URL_Mapa",
                e."Reglas",
                l."Nom_Lugar", 
                l."Ubicacion_Lugar" AS "Ubicacion" 
            FROM "Eventos" e
            LEFT JOIN "Lugares" l ON e."Id_Lugar" = l."Id_Lugar"
            WHERE e."Estado" = 'aprobado' AND e."SolicitudDestacar" = 'aprobado'
            ORDER BY e."Fecha" ASC, e."Horario_Inicio" ASC;
        `;
        const result = await pool.query(query);

        const eventsWithParsedData = result.rows.map(event => ({
            ...event,
            Reglas: event.Reglas || []
        }));

        res.status(200).json({ events: eventsWithParsedData });
    } catch (error) {
        console.error('Error al obtener eventos destacados para el cliente:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener eventos destacados.' });
    }
});


module.exports = router;
