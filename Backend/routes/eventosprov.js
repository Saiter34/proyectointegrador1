// Backend/routes/eventosprov.js
// Este archivo contiene rutas para los eventos manejadas por proveedores/organizadores.
// Los middlewares de autenticación y autorización se aplicarán en index.js al montar estas rutas.

const express = require('express');
const router = express.Router();
const pool = require('../db'); // Importa tu conexión a la base de datos
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Listas permitidas para validación (¡Asegúrate de que estas coincidan con tu frontend!)
const CATEGORIAS_VALIDAS = ['Conciertos', 'Teatro', 'Deportes', 'Conferencias', 'Festivales', 'Exposiciones'];
const UBICACIONES_VALIDAS = ['San Marcos', 'Teatro Canut', 'Teatro Nacional', 'Estadio Nacional', 'Parque de la Exposición', 'Centro de Convenciones'];

// Middleware para procesar la imagen del evento
const uploadMiddleware = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const imagesDir = path.join(__dirname, '..', '..', 'Fronted', 'img', 'event_images');
            // Asegúrate de que el directorio exista
            if (!fs.existsSync(imagesDir)) {
                fs.mkdirSync(imagesDir, { recursive: true });
            }
            cb(null, imagesDir);
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
        }
    })
}).single('imagenEvento');

// --- RUTAS PARA PROVEEDORES (ORGANIZADORES) ---

/**
 * @route POST /eventos/crear
 * @description Permite a un organizador crear un nuevo evento.
 * @access Privado (Organizador - middleware aplicado en index.js)
 */
router.post('/eventos/crear', uploadMiddleware, async (req, res) => {
    // req.user.id se obtiene del token gracias a authenticateToken en index.js
    const { Nom_Evento, Fecha, Horario_Inicio, Horario_Fin, Categoria, Ubicacion, Descripcion, PrecioGeneral, PrecioVIP, PrecioConadis, Asientos_General_Disponibles, Asientos_VIP_Disponibles, Asientos_CONADIS_Disponibles, Reglas } = req.body;
    const Id_Usuario_Organizador = req.user.id;

    if (!Nom_Evento || !Fecha || !Horario_Inicio || !Horario_Fin || !Categoria || !Ubicacion || !Descripcion || !PrecioGeneral || !req.file || !Asientos_General_Disponibles) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: 'Todos los campos obligatorios (nombre, fecha, horarios, categoría, ubicación, descripción, precio general, asientos generales, imagen) deben ser proporcionados.' });
    }

    if (!CATEGORIAS_VALIDAS.includes(Categoria)) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: `Categoría inválida. Las categorías permitidas son: ${CATEGORIAS_VALIDAS.join(', ')}.` });
    }
    if (!UBICACIONES_VALIDAS.includes(Ubicacion)) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: `Ubicación inválida. Las ubicaciones permitidas son: ${UBICACIONES_VALIDAS.join(', ')}.` });
    }

    const URL_Imagen = `/img/event_images/${req.file.filename}`;
    const URL_Mapa = req.body.URL_Mapa || '/img/default_map.jpg'; // Podrías tener un campo para esto en el frontend
    const reglasParsed = Reglas ? JSON.stringify(Reglas) : '[]'; // Guardar como JSON string para JSONB

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const orgResult = await client.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(404).json({ message: 'Organizador no encontrado para el usuario autenticado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;

        const result = await client.query(
            `INSERT INTO "Eventos" (
                "Id_Organizador", "Nom_Evento", "Fecha", "Horario_Inicio", "Horario_Fin",
                "Categoria", "Ubicacion", "Descripcion", "PrecioGeneral", "PrecioVIP",
                "PrecioConadis", "Estado", "URL_Imagen", "URL_Mapa", "Reglas",
                "Asientos_General_Disponibles", "Asientos_VIP_Disponibles", "Asientos_CONADIS_Disponibles"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pendiente', $12, $13, $14, $15, $16, $17) RETURNING *`,
            [
                Id_Organizador, Nom_Evento, Fecha, Horario_Inicio, Horario_Fin,
                Categoria, Ubicacion, Descripcion, parseFloat(PrecioGeneral),
                PrecioVIP ? parseFloat(PrecioVIP) : null,
                PrecioConadis ? parseFloat(PrecioConadis) : null,
                URL_Imagen, URL_Mapa, reglasParsed, // Guardar el JSON string
                parseInt(Asientos_General_Disponibles),
                Asientos_VIP_Disponibles ? parseInt(Asientos_VIP_Disponibles) : null,
                Asientos_CONADIS_Disponibles ? parseInt(Asientos_CONADIS_Disponibles) : null
            ]
        );

        await client.query('COMMIT');
        res.status(201).json({ message: 'Evento creado exitosamente y pendiente de aprobación.', event: { ...result.rows[0], Reglas: JSON.parse(result.rows[0].Reglas || '[]') } }); // Parsear de vuelta para la respuesta

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al crear evento:', error.message);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ message: 'Error interno del servidor al crear el evento.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route GET /eventos
 * @description Obtiene todos los eventos creados por el organizador autenticado (sin filtrar por estado).
 * @access Privado (Organizador - middleware aplicado en index.js)
 */
router.get('/eventos', async (req, res) => {
    const Id_Usuario_Organizador = req.user.id; // Del token

    try {
        const orgResult = await pool.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            return res.status(404).json({ message: 'Organizador no encontrado para el usuario autenticado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;

        const result = await pool.query(
            `SELECT
                "Id_Evento", "Nom_Evento", "Fecha", "Horario_Inicio", "Horario_Fin", "Categoria", "Ubicacion", "Descripcion",
                "PrecioGeneral", "PrecioVIP", "PrecioConadis", "Estado", "URL_Imagen", "URL_Mapa", "Reglas",
                "Asientos_General_Disponibles", "Asientos_VIP_Disponibles", "Asientos_CONADIS_Disponibles",
                "SolicitudDestacar"
            FROM "Eventos" WHERE "Id_Organizador" = $1 ORDER BY "Fecha" DESC`,
            [Id_Organizador]
        );

        // Mapear y parsear las reglas para cada evento
        const eventsWithParsedRules = result.rows.map(event => ({
            ...event,
            Reglas: event.Reglas ? event.Reglas : [] // Si es JSONB, ya viene parseado, solo asegurar que es array
        }));

        res.status(200).json({ message: 'Eventos obtenidos exitosamente.', events: eventsWithParsedRules });
    } catch (error) {
        console.error('Error al obtener eventos del proveedor:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener eventos.' });
    }
});

/**
 * @route GET /eventos-aprobados
 * @description Obtiene solo los eventos creados por el organizador autenticado que están 'aprobados'.
 * @access Privado (Organizador - middleware aplicado en index.js)
 */
router.get('/eventos-aprobados', async (req, res) => {
    const Id_Usuario_Organizador = req.user.id; // Del token

    try {
        const orgResult = await pool.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            return res.status(404).json({ message: 'Organizador no encontrado para el usuario autenticado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;

        const result = await pool.query(
            `SELECT
                "Id_Evento", "Nom_Evento", "Fecha", "Horario_Inicio", "Horario_Fin", "Categoria", "Ubicacion", "Descripcion",
                "PrecioGeneral", "PrecioVIP", "PrecioConadis", "Estado", "URL_Imagen", "URL_Mapa", "Reglas",
                "Asientos_General_Disponibles", "Asientos_VIP_Disponibles", "Asientos_CONADIS_Disponibles",
                "SolicitudDestacar"
            FROM "Eventos"
            WHERE "Id_Organizador" = $1 AND "Estado" = 'aprobado'
            ORDER BY "Fecha" DESC`,
            [Id_Organizador]
        );

        // Mapear y parsear las reglas para cada evento
        const eventsWithParsedRules = result.rows.map(event => ({
            ...event,
            Reglas: event.Reglas ? event.Reglas : [] // Si es JSONB, ya viene parseado, solo asegurar que es array
        }));

        res.status(200).json({ message: 'Eventos aprobados obtenidos exitosamente.', events: eventsWithParsedRules });
    } catch (error) {
        console.error('Error al obtener eventos aprobados del proveedor:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener eventos aprobados.' });
    }
});

/**
 * @route GET /eventos/:id
 * @description Obtiene los detalles de un evento específico del organizador autenticado.
 * @access Privado (Organizador - middleware aplicado en index.js)
 */
router.get('/eventos/:id', async (req, res) => {
    const { id } = req.params;
    const Id_Usuario_Organizador = req.user.id; // Del token

    try {
        const orgResult = await pool.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            return res.status(404).json({ message: 'Organizador no encontrado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;

        const result = await pool.query(
            `SELECT
                "Id_Evento", "Nom_Evento", "Fecha", "Horario_Inicio", "Horario_Fin", "Categoria", "Ubicacion", "Descripcion",
                "PrecioGeneral", "PrecioVIP", "PrecioConadis", "Estado", "URL_Imagen", "URL_Mapa", "Reglas",
                "Asientos_General_Disponibles", "Asientos_VIP_Disponibles", "Asientos_CONADIS_Disponibles",
                "SolicitudDestacar"
            FROM "Eventos" WHERE "Id_Evento" = $1 AND "Id_Organizador" = $2`,
            [id, Id_Organizador]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Evento no encontrado o no pertenece a este organizador.' });
        }

        const event = result.rows[0];
        // Parsear las reglas si existen
        event.Reglas = event.Reglas ? event.Reglas : [];

        res.status(200).json(event);
    } catch (error) {
        console.error('Error al obtener evento por ID para el proveedor:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener evento.' });
    }
});

/**
 * @route PUT /eventos/:id
 * @description Actualiza un evento existente del organizador autenticado.
 * @access Privado (Organizador - middleware aplicado en index.js)
 */
router.put('/eventos/:id', uploadMiddleware, async (req, res) => {
    const { id } = req.params;
    const { Nom_Evento, Fecha, Horario_Inicio, Horario_Fin, Categoria, Ubicacion, Descripcion, PrecioGeneral, PrecioVIP, PrecioConadis, Asientos_General_Disponibles, Asientos_VIP_Disponibles, Asientos_CONADIS_Disponibles, Reglas } = req.body;
    const Id_Usuario_Organizador = req.user.id;

    if (!Nom_Evento || !Fecha || !Horario_Inicio || !Horario_Fin || !Categoria || !Ubicacion || !Descripcion || !PrecioGeneral || !Asientos_General_Disponibles) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: 'Todos los campos obligatorios deben ser proporcionados para la actualización.' });
    }

    if (!CATEGORIAS_VALIDAS.includes(Categoria)) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: `Categoría inválida. Las categorías permitidas son: ${CATEGORIAS_VALIDAS.join(', ')}.` });
    }
    if (!UBICACIONES_VALIDAS.includes(Ubicacion)) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: `Ubicación inválida. Las ubicaciones permitidas son: ${UBICACIONES_VALIDAS.join(', ')}.` });
    }

    const reglasParsed = Reglas ? JSON.stringify(Reglas) : '[]';

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const orgResult = await client.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(404).json({ message: 'Organizador no encontrado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;

        const checkEvent = await client.query('SELECT "URL_Imagen", "URL_Mapa" FROM "Eventos" WHERE "Id_Evento" = $1 AND "Id_Organizador" = $2', [id, Id_Organizador]);
        if (checkEvent.rows.length === 0) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(404).json({ message: 'Evento no encontrado o no pertenece a este organizador.' });
        }

        let URL_Imagen = checkEvent.rows[0].URL_Imagen;
        if (req.file) {
            const oldImagePath = path.join(__dirname, '..', '..', 'Fronted', URL_Imagen);
            if (fs.existsSync(oldImagePath) && oldImagePath.includes('/img/event_images/')) {
                fs.unlinkSync(oldImagePath);
            }
            URL_Imagen = `/img/event_images/${req.file.filename}`;
        }

        const URL_Mapa = req.body.URL_Mapa || checkEvent.rows[0].URL_Mapa || '/img/default_map.jpg'; // Mantener el existente si no se proporciona uno nuevo

        const result = await client.query(
            `UPDATE "Eventos" SET
                "Nom_Evento" = $1,
                "Fecha" = $2,
                "Horario_Inicio" = $3,
                "Horario_Fin" = $4,
                "Categoria" = $5,
                "Ubicacion" = $6,
                "Descripcion" = $7,
                "PrecioGeneral" = $8,
                "PrecioVIP" = $9,
                "PrecioConadis" = $10,
                "URL_Imagen" = $11,
                "URL_Mapa" = $12,
                "Reglas" = $13,
                "Asientos_General_Disponibles" = $14,
                "Asientos_VIP_Disponibles" = $15,
                "Asientos_CONADIS_Disponibles" = $16,
                "Estado" = 'pendiente' -- Se restablece a pendiente al actualizar
            WHERE "Id_Evento" = $17 AND "Id_Organizador" = $18 RETURNING *`,
            [
                Nom_Evento, Fecha, Horario_Inicio, Horario_Fin, Categoria, Ubicacion, Descripcion,
                parseFloat(PrecioGeneral),
                PrecioVIP ? parseFloat(PrecioVIP) : null,
                PrecioConadis ? parseFloat(PrecioConadis) : null,
                URL_Imagen, URL_Mapa, reglasParsed, // Guardar el JSON string
                parseInt(Asientos_General_Disponibles),
                Asientos_VIP_Disponibles ? parseInt(Asientos_VIP_Disponibles) : null,
                Asientos_CONADIS_Disponibles ? parseInt(Asientos_CONADIS_Disponibles) : null,
                id, Id_Organizador
            ]
        );

        await client.query('COMMIT');
        res.status(200).json({ message: 'Evento actualizado exitosamente y puesto en estado pendiente para revisión.', event: { ...result.rows[0], Reglas: JSON.parse(result.rows[0].Reglas || '[]') } });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al actualizar evento:', error.message);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ message: 'Error interno del servidor al actualizar el evento.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route DELETE /eventos/:id
 * @description Elimina un evento del organizador autenticado.
 * @access Privado (Organizador - middleware aplicado en index.js)
 */
router.delete('/eventos/:id', async (req, res) => {
    const { id } = req.params;
    const Id_Usuario_Organizador = req.user.id;

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const orgResult = await client.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Organizador no encontrado para el usuario autenticado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;

        const eventImageResult = await client.query('SELECT "URL_Imagen" FROM "Eventos" WHERE "Id_Evento" = $1 AND "Id_Organizador" = $2', [id, Id_Organizador]);
        if (eventImageResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Evento no encontrado o no pertenece a este organizador.' });
        }
        const imageUrlToDelete = eventImageResult.rows[0].URL_Imagen;

        const result = await client.query('DELETE FROM "Eventos" WHERE "Id_Evento" = $1 AND "Id_Organizador" = $2 RETURNING *', [id, Id_Organizador]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Evento no encontrado o no autorizado para eliminar.' });
        }

        if (imageUrlToDelete && imageUrlToDelete.includes('/img/event_images/')) {
            const imagePath = path.join(__dirname, '..', '..', 'Fronted', imageUrlToDelete);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'Evento eliminado exitosamente.', event: result.rows[0] });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al eliminar evento:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al eliminar el evento.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route POST /eventos/:id/solicitar-destacar
 * @description Permite a un organizador solicitar que su evento aprobado sea destacado.
 * Requiere que el evento esté en estado 'aprobado'.
 * @access Privado (Organizador - middleware aplicado en index.js)
 */
router.post('/eventos/:id/solicitar-destacar', async (req, res) => {
    const { id } = req.params;
    const Id_Usuario_Organizador = req.user.id; // Del token

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const orgResult = await client.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Organizador no encontrado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;

        const result = await client.query(
            `UPDATE "Eventos" SET "SolicitudDestacar" = 'pendiente'
             WHERE "Id_Evento" = $1 AND "Id_Organizador" = $2 AND "Estado" = 'aprobado'
             RETURNING "Id_Evento", "Nom_Evento", "SolicitudDestacar"`,
            [id, Id_Organizador]
        );

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            // Aquí se añade más detalle al mensaje si ya hay una solicitud pendiente
            const existingEvent = await client.query(
                `SELECT "SolicitudDestacar" FROM "Eventos" WHERE "Id_Evento" = $1 AND "Id_Organizador" = $2`,
                [id, Id_Organizador]
            );
            if (existingEvent.rows.length > 0 && existingEvent.rows[0].SolicitudDestacar === 'pendiente') {
                return res.status(400).json({ message: 'Ya existe una solicitud pendiente para destacar este evento.' });
            }
            if (existingEvent.rows.length > 0 && existingEvent.rows[0].SolicitudDestacar === 'aprobado') {
                return res.status(400).json({ message: 'Este evento ya está destacado.' });
            }
            return res.status(400).json({ message: 'Evento no encontrado, no está aprobado, o no pertenece a tu organización.' });
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'Solicitud para destacar enviada y pendiente de revisión.', event: result.rows[0] });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al solicitar destacar evento:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al solicitar destacar el evento.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route GET /eventos/:id/stats
 * @description Obtiene las estadísticas de venta para un evento específico del organizador.
 * @access Privado (Organizador - middleware aplicado en index.js)
 */
router.get('/eventos/:id/stats', async (req, res) => {
    const { id } = req.params; // Id_Evento
    const Id_Usuario_Organizador = req.user.id;

    let client;
    try {
        client = await pool.connect();

        const eventDetailsResult = await client.query(
            `SELECT
                "Id_Organizador", "Nom_Evento", "PrecioGeneral", "PrecioVIP", "PrecioConadis"
             FROM "Eventos"
             WHERE "Id_Evento" = $1`,
            [id]
        );
        if (eventDetailsResult.rows.length === 0) {
            return res.status(404).json({ message: 'Evento no encontrado.' });
        }
        const eventDetails = eventDetailsResult.rows[0];

        const orgResult = await client.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            return res.status(404).json({ message: 'Organizador no encontrado para el usuario autenticado.' });
        }
        const Id_Organizador_Auth = orgResult.rows[0].Id_Organizador;

        if (eventDetails.Id_Organizador !== Id_Organizador_Auth) {
            return res.status(403).json({ message: 'Acceso denegado. Este evento no pertenece a tu organización.' });
        }

        const ticketsSoldResult = await client.query(
            `SELECT
                ce."Nom_Categoria",
                COUNT(t."Id_Ticket") AS total_tickets_vendidos
             FROM "Tickets" t
             JOIN "Categorías de entradas" ce ON t."Id_Categoria" = ce."Id_Categoria"
             WHERE ce."Id_Evento" = $1
             GROUP BY ce."Nom_Categoria"`,
            [id]
        );

        let general_vendidos = 0;
        let vip_vendidos = 0;
        let conadis_vendidos = 0;
        let ganancias_estimadas = 0;

        ticketsSoldResult.rows.forEach(row => {
            const cantidad = parseInt(row.total_tickets_vendidos, 10);
            if (row.Nom_Categoria === 'General') {
                general_vendidos = cantidad;
                ganancias_estimadas += cantidad * parseFloat(eventDetails.PrecioGeneral || 0);
            } else if (row.Nom_Categoria === 'VIP') {
                vip_vendidos = cantidad;
                ganancias_estimadas += cantidad * parseFloat(eventDetails.PrecioVIP || 0);
            } else if (row.Nom_Categoria === 'Conadis') {
                conadis_vendidos = cantidad;
                ganancias_estimadas += cantidad * parseFloat(eventDetails.PrecioConadis || 0);
            }
        });

        const total_vendidos = general_vendidos + vip_vendidos + conadis_vendidos;

        res.status(200).json({
            message: 'Estadísticas obtenidas exitosamente.',
            statistics: {
                general_vendidos: general_vendidos,
                vip_vendidos: vip_vendidos,
                conadis_vendidos: conadis_vendidos,
                total_vendidos: total_vendidos,
                ganancias_estimadas: ganancias_estimadas.toFixed(2)
            }
        });

    } catch (error) {
        console.error('Error al obtener estadísticas del evento:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener estadísticas del evento.' });
    } finally {
        if (client) client.release();
    }
});

module.exports = router;
