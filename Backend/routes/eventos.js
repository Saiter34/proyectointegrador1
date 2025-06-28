// Backend/routes/eventos.js
// Este archivo ahora contiene rutas tanto para proveedores/organizadores como para administradores.
// Los middlewares de autenticación y autorización se aplicarán en index.js al montar estas rutas.

const express = require('express');
const router = express.Router();
const pool = require('../db');
// No importamos authenticateToken o authorizeRole aquí, se aplicarán en index.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Listas permitidas para validación
const CATEGORIAS_VALIDAS = ['Conciertos', 'Teatro', 'Deportes', 'Conferencias', 'Festivales', 'Exposiciones'];
const UBICACIONES_VALIDAS = ['San Marcos', 'Teatro Canut', 'Teatro Nacional', 'Estadio Nacional', 'Parque de la Exposición', 'Centro de Convenciones'];

// Middleware para procesar la imagen del evento
const uploadMiddleware = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const imagesDir = path.join(__dirname, '..', '..', 'Fronted', 'img', 'event_images');
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
// Estas rutas se montarán en index.js bajo '/api/proveedor' con el middleware de rol 'organizador'.

/**
 * @route POST /eventos/crear
 * @description Permite a un organizador crear un nuevo evento.
 * @access Privado (Organizador - middleware aplicado en index.js)
 */
router.post('/eventos/crear', uploadMiddleware, async (req, res) => {
    // req.user.id se obtiene del token gracias a authenticateToken en index.js
    const { Nom_Evento, Fecha, Horario_Inicio, Horario_Fin, Categoria, Ubicacion, Descripcion, PrecioGeneral, PrecioVIP, PrecioConadis } = req.body;
    const Id_Usuario_Organizador = req.user.id;

    if (!Nom_Evento || !Fecha || !Horario_Inicio || !Horario_Fin || !Categoria || !Ubicacion || !Descripcion || !PrecioGeneral || !req.file) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: 'Todos los campos obligatorios (nombre, fecha, horarios, categoría, ubicación, descripción, precio general, imagen) deben ser proporcionados.' });
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
                "PrecioConadis", "Estado", "URL_Imagen"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pendiente', $12) RETURNING *`,
            [
                Id_Organizador, Nom_Evento, Fecha, Horario_Inicio, Horario_Fin,
                Categoria, Ubicacion, Descripcion, PrecioGeneral,
                PrecioVIP === '' ? null : PrecioVIP,
                PrecioConadis === '' ? null : PrecioConadis,
                URL_Imagen
            ]
        );

        await client.query('COMMIT');
        res.status(201).json({ message: 'Evento creado exitosamente y pendiente de aprobación.', event: result.rows[0] });

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
 * @description Obtiene todos los eventos creados por el organizador autenticado.
 * @access Privado (Organizador - middleware aplicado en index.js)
 */
router.get('/eventos', async (req, res) => {
    const Id_Usuario_Organizador = req.user.id;

    try {
        const orgResult = await pool.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            return res.status(404).json({ message: 'Organizador no encontrado para el usuario autenticado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;

        const result = await pool.query('SELECT * FROM "Eventos" WHERE "Id_Organizador" = $1 ORDER BY "Fecha" DESC', [Id_Organizador]);
        res.status(200).json({ message: 'Eventos obtenidos exitosamente.', events: result.rows });
    } catch (error) {
        console.error('Error al obtener eventos del proveedor:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener eventos.' });
    }
});

/**
 * @route GET /eventos/:id
 * @description Obtiene los detalles de un evento específico del organizador autenticado.
 * @access Privado (Organizador - middleware aplicado en index.js)
 */
router.get('/eventos/:id', async (req, res) => {
    const { id } = req.params;
    const Id_Usuario_Organizador = req.user.id;

    try {
        const orgResult = await pool.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            return res.status(404).json({ message: 'Organizador no encontrado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;

        const result = await pool.query('SELECT * FROM "Eventos" WHERE "Id_Evento" = $1 AND "Id_Organizador" = $2', [id, Id_Organizador]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Evento no encontrado o no pertenece a este organizador.' });
        }
        res.status(200).json(result.rows[0]);
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
    const { Nom_Evento, Fecha, Horario_Inicio, Horario_Fin, Categoria, Ubicacion, Descripcion, PrecioGeneral, PrecioVIP, PrecioConadis } = req.body;
    const Id_Usuario_Organizador = req.user.id;

    if (!CATEGORIAS_VALIDAS.includes(Categoria)) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: `Categoría inválida. Las categorías permitidas son: ${CATEGORIAS_VALIDAS.join(', ')}.` });
    }
    if (!UBICACIONES_VALIDAS.includes(Ubicacion)) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: `Ubicación inválida. Las ubicaciones permitidas son: ${UBICACIONES_VALIDAS.join(', ')}.` });
    }

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

        const checkEvent = await client.query('SELECT "URL_Imagen" FROM "Eventos" WHERE "Id_Evento" = $1 AND "Id_Organizador" = $2', [id, Id_Organizador]);
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
                "Estado" = 'pendiente'
            WHERE "Id_Evento" = $12 AND "Id_Organizador" = $13 RETURNING *`,
            [
                Nom_Evento, Fecha, Horario_Inicio, Horario_Fin, Categoria, Ubicacion, Descripcion,
                PrecioGeneral,
                PrecioVIP === '' ? null : PrecioVIP,
                PrecioConadis === '' ? null : PrecioConadis,
                URL_Imagen, id, Id_Organizador
            ]
        );

        await client.query('COMMIT');
        res.status(200).json({ message: 'Evento actualizado exitosamente y puesto en estado pendiente para revisión.', event: result.rows[0] });

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
            return res.status(404).json({ message: 'Organizador no encontrado.' });
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


// --- RUTAS PARA ADMINISTRADORES ---
// Estas rutas se montarán en index.js bajo '/api/admin/eventos' con el middleware de rol 'admin'.

/**
 * @route GET /pendientes
 * @description Obtiene todas las solicitudes de eventos que están en estado 'pendiente'.
 * @access Privado (Administrador - middleware aplicado en index.js)
 */
router.get('/pendientes', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                e."Id_Evento",
                e."Nom_Evento",
                e."Fecha",
                e."Horario_Inicio",
                e."Horario_Fin",
                e."Categoria",
                e."Ubicacion",
                e."Descripcion",
                e."PrecioGeneral",
                e."PrecioVIP",
                e."PrecioConadis",
                e."Estado",
                e."URL_Imagen",
                u."Nom_Usuario" AS "NombreProveedor",
                u."Ape_Usuario" AS "ApellidoProveedor",
                u."Correo_Usuario" AS "EmailProveedor"
            FROM "Eventos" e
            JOIN "Organizadores" o ON e."Id_Organizador" = o."Id_Organizador"
            JOIN "Usuarios" u ON o."Id_Usuario" = u.id
            WHERE e."Estado" = 'pendiente'
            ORDER BY e."Fecha" ASC;`
        );
        res.status(200).json({ events: result.rows });
    } catch (error) {
        console.error('Error al obtener solicitudes de eventos pendientes:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener solicitudes de eventos pendientes.' });
    }
});

/**
 * @route GET /aprobados
 * @description Obtiene todos los eventos que están en estado 'aprobado'.
 * @access Privado (Administrador - middleware aplicado en index.js)
 */
router.get('/aprobados', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                e."Id_Evento",
                e."Nom_Evento",
                e."Fecha",
                e."Horario_Inicio",
                e."Horario_Fin",
                e."Categoria",
                e."Ubicacion",
                e."Descripcion",
                e."PrecioGeneral",
                e."PrecioVIP",
                e."PrecioConadis",
                e."Estado",
                e."URL_Imagen",
                u."Nom_Usuario" AS "NombreProveedor",
                u."Ape_Usuario" AS "ApellidoProveedor",
                u."Correo_Usuario" AS "EmailProveedor"
            FROM "Eventos" e
            JOIN "Organizadores" o ON e."Id_Organizador" = o."Id_Organizador"
            JOIN "Usuarios" u ON o."Id_Usuario" = u.id
            WHERE e."Estado" = 'aprobado'
            ORDER BY e."Fecha" DESC;`
        );
        res.status(200).json({ events: result.rows });
    } catch (error) {
        console.error('Error al obtener eventos aprobados para el administrador:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener eventos aprobados.' });
    }
});

/**
 * @route DELETE /eliminar/:id
 * @description Elimina un evento (sin importar su estado).
 * @access Privado (Administrador - middleware aplicado en index.js)
 */
router.delete('/eliminar/:id', async (req, res) => {
    const eventIdToDelete = req.params.id;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Primero, obtener la URL de la imagen para eliminarla del disco
        const eventImageResult = await client.query(
            `SELECT "URL_Imagen" FROM "Eventos" WHERE "Id_Evento" = $1`,
            [eventIdToDelete]
        );

        if (eventImageResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Evento no encontrado.' });
        }
        const imageUrlToDelete = eventImageResult.rows[0].URL_Imagen;

        // Luego, eliminar el evento de la base de datos
        const deleteResult = await client.query(
            `DELETE FROM "Eventos" WHERE "Id_Evento" = $1 RETURNING *`,
            [eventIdToDelete]
        );

        if (deleteResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Evento no encontrado o no se pudo eliminar.' });
        }

        // Finalmente, eliminar el archivo de imagen del disco si existe
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
 * @description Aprueba una solicitud de evento, cambiando su estado a 'aprobado'.
 * @access Privado (Administrador - middleware aplicado en index.js)
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
 * @description Rechaza una solicitud de evento, cambiando su estado a 'rechazado'.
 * @access Privado (Administrador - middleware aplicado en index.js)
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

module.exports = router;
