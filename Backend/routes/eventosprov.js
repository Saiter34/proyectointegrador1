// Backend/routes/eventosprov.js
// Este archivo contiene rutas para los eventos manejadas por proveedores/organizadores.
// Los middlewares de autenticación y autorización se aplicarán en index.js al montar estas rutas.

const express = require('express');
const router = express.Router();
const pool = require('../db'); // Importa tu conexión a la base de datos
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Directorio donde se guardarán las imágenes de los eventos
const eventImagesDir = path.join(__dirname, '..', '..', 'Fronted', 'img', 'event_images');

// Configuración de Multer para la subida de imágenes de eventos
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

// --- Listas permitidas para validación ---
const CATEGORIAS_VALIDAS = [
    'Deportiva', 'Concierto', 'Teatro', 'Música', 'Arte', 'Educación', 
    'Tecnología', 'Comedia', 'Infantil', 'Festival', 'Conferencia', 'Exposición'
]; 


// --- RUTAS PARA PROVEEDORES (ORGANIZADORES) ---


/**
 * @route POST /crear
 * @description Permite a un organizador crear un nuevo evento.
 * @access Privado (Organizador - middleware aplicado en index.js)
 */
router.post('/crear', uploadMiddleware, async (req, res) => {
    const { 
        Nom_Evento, Fecha, Horario_Inicio, Horario_Fin, Categoria, 
        Id_Lugar, 
        Descripcion, 
        AsientosGeneral, AsientosVIP, AsientosConadis, 
        CostoGeneral, CostoVIP, CostoConadis, Reglas 
    } = req.body;
    const Id_Usuario_Organizador = req.user.id; 

    if (!Nom_Evento || !Fecha || !Horario_Inicio || !Horario_Fin || !Categoria || !Id_Lugar || !Descripcion || !CostoGeneral || !AsientosGeneral) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: 'Todos los campos obligatorios deben ser proporcionados.' });
    }

    if (!req.file) {
        return res.status(400).json({ message: 'Se requiere una imagen para el evento.' });
    }

    if (!CATEGORIAS_VALIDAS.includes(Categoria)) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: `Categoría inválida. Las categorías permitidas son: ${CATEGORIAS_VALIDAS.join(', ')}.` });
    }

    const URL_Imagen_Evento = `/img/event_images/${req.file.filename}`;
    // URL_Mapa en la tabla Eventos no se usa para la imagen de asientos del lugar.
    // La imagen de asientos del lugar se obtiene de la tabla Lugares.
    // Por lo tanto, no necesitamos un URL_Mapa aquí.
    const URL_Mapa_Eventos = null; // Se deja como null o se elimina de la tabla si no tiene uso.
    let reglasParsed = '[]';
    try {
        if (Reglas) {
            reglasParsed = JSON.stringify(JSON.parse(Reglas));
        }
    } catch (e) {
        console.warn('Advertencia: Reglas no es un JSON válido, se guardará como array vacío.', e);
        reglasParsed = '[]';
    }

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

        const lugarCheck = await client.query(
            'SELECT "Capacidad_Total", "Cantidad_General", "Cantidad_VIP", "Cantidad_Conadis" FROM "Lugares" WHERE "Id_Lugar" = $1', 
            [Id_Lugar]
        );
        if (lugarCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'El lugar seleccionado no existe.' });
        }
        const capacidadesRealesLugar = lugarCheck.rows[0];

        const requestedAsientosGeneral = parseInt(AsientosGeneral);
        const requestedAsientosVIP = AsientosVIP ? parseInt(AsientosVIP) : 0; 
        const requestedAsientosConadis = AsientosConadis ? parseInt(AsientosConadis) : 0; 

        if (requestedAsientosGeneral > capacidadesRealesLugar.Cantidad_General) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: `La cantidad de asientos GENERAL (${requestedAsientosGeneral}) excede la capacidad disponible del lugar (${capacidadesRealesLugar.Cantidad_General}).` });
        }
        if (requestedAsientosVIP > capacidadesRealesLugar.Cantidad_VIP) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: `La cantidad de asientos VIP (${requestedAsientosVIP}) excede la capacidad disponible del lugar (${capacidadesRealesLugar.Cantidad_VIP}).` });
        }
        if (requestedAsientosConadis > capacidadesRealesLugar.Cantidad_Conadis) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: `La cantidad de asientos CONADIS (${requestedAsientosConadis}) excede la capacidad disponible del lugar (${capacidadesRealesLugar.Cantidad_Conadis}).` });
        }

        const Estado_Evento = 'pendiente'; 

        const query = `
            INSERT INTO "Eventos" (
                "Id_Organizador", "Nom_Evento", "Fecha", "Horario_Inicio", "Horario_Fin",
                "Categoria", "Id_Lugar", "Descripcion", "URL_Imagen_Evento", "URL_Mapa", "Reglas",
                "Asientos_General_Disp", "Asientos_VIP_Disp", "Asientos_Conadis_Disp", 
                "PrecioGeneral", "PrecioVIP", "PrecioConadis", "Estado" 
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            RETURNING *;
        `;

        const costoVIPValue = CostoVIP ? parseFloat(CostoVIP) : null;
        const costoConadisValue = CostoConadis ? parseFloat(CostoConadis) : null;

        const result = await pool.query(query, [
            Id_Organizador, Nom_Evento, Fecha, Horario_Inicio, Horario_Fin,
            Categoria, Id_Lugar, Descripcion, URL_Imagen_Evento, URL_Mapa_Eventos, reglasParsed, 
            requestedAsientosGeneral, requestedAsientosVIP, requestedAsientosConadis, 
            parseFloat(CostoGeneral), costoVIPValue, costoConadisValue, Estado_Evento 
        ]);

        await client.query('COMMIT'); 
        res.status(201).json({ message: 'Evento creado exitosamente y pendiente de aprobación.', event: result.rows[0] });

    } catch (error) {
        if (client) await client.query('ROLLBACK'); 
        console.error('Error al crear evento:', error.message);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Error al eliminar archivo subido tras un error:', err);
            });
        }
        res.status(500).json({ message: 'Error interno del servidor al crear evento.' });
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
    const Id_Usuario_Organizador = req.user.id; 

    try {
        const orgResult = await pool.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            return res.status(404).json({ message: 'Organizador no encontrado para el usuario autenticado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;

        const result = await pool.query(
            `SELECT
                e."Id_Evento", e."Nom_Evento", e."Fecha", e."Horario_Inicio", e."Horario_Fin", e."Categoria",
                e."Descripcion", e."PrecioGeneral", e."PrecioVIP", e."PrecioConadis", e."Estado", 
                e."URL_Imagen_Evento", 
                l."URL_Imagen_Asientos", -- OBTENEMOS URL_Imagen_Asientos DEL LUGAR
                e."Reglas",
                e."Asientos_General_Disp", e."Asientos_VIP_Disp", e."Asientos_Conadis_Disp",
                e."SolicitudDestacar",
                l."Nom_Lugar", 
                l."Ubicacion_Lugar" AS "Ubicacion_Lugar" 
            FROM "Eventos" e
            LEFT JOIN "Lugares" l ON e."Id_Lugar" = l."Id_Lugar" 
            WHERE e."Id_Organizador" = $1
            ORDER BY e."Fecha" DESC`,
            [Id_Organizador]
        );

        const eventsWithParsedRules = result.rows.map(event => ({
            ...event,
            Reglas: event.Reglas || [] 
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
    const Id_Usuario_Organizador = req.user.id; 

    try {
        const orgResult = await pool.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            return res.status(404).json({ message: 'Organizador no encontrado para el usuario autenticado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;

        const result = await pool.query(
            `SELECT
                e."Id_Evento", e."Nom_Evento", e."Fecha", e."Horario_Inicio", e."Horario_Fin", e."Categoria",
                e."Descripcion", e."PrecioGeneral", e."PrecioVIP", e."PrecioConadis", e."Estado", 
                e."URL_Imagen_Evento", 
                l."URL_Imagen_Asientos", -- OBTENEMOS URL_Imagen_Asientos DEL LUGAR
                e."Reglas",
                e."Asientos_General_Disp", e."Asientos_VIP_Disp", e."Asientos_Conadis_Disp",
                e."SolicitudDestacar",
                l."Nom_Lugar", 
                l."Ubicacion_Lugar" AS "Ubicacion_Lugar" 
            FROM "Eventos" e
            LEFT JOIN "Lugares" l ON e."Id_Lugar" = l."Id_Lugar" 
            WHERE e."Id_Organizador" = $1 AND e."Estado" = 'aprobado'
            ORDER BY e."Fecha" DESC`,
            [Id_Organizador]
        );

        const eventsWithParsedRules = result.rows.map(event => ({
            ...event,
            Reglas: event.Reglas || [] 
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
    const Id_Usuario_Organizador = req.user.id; 

    let client; 
    try {
        client = await pool.connect(); 
        const orgResult = await client.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            await client.query('ROLLBACK'); 
            return res.status(404).json({ message: 'Organizador no encontrado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;

        const eventResult = await client.query(
            `SELECT
                e."Id_Evento", e."Nom_Evento", e."Fecha", e."Horario_Inicio", e."Horario_Fin", e."Categoria",
                e."Descripcion", e."Estado", 
                e."URL_Imagen_Evento", 
                l."URL_Imagen_Asientos", -- OBTENEMOS URL_Imagen_Asientos DEL LUGAR
                e."Reglas",
                e."Asientos_General_Disp", e."Asientos_VIP_Disp", "Asientos_Conadis_Disp",
                e."SolicitudDestacar",
                l."Nom_Lugar", l."Ubicacion_Lugar" AS "Ubicacion_Lugar", 
                l."Capacidad_Total", l."Cantidad_General", l."Cantidad_VIP", l."Cantidad_Conadis", l."URL_Imagen_Referencial"
            FROM "Eventos" e
            LEFT JOIN "Lugares" l ON e."Id_Lugar" = l."Id_Lugar" 
            WHERE e."Id_Evento" = $1 AND e."Id_Organizador" = $2`,
            [id, Id_Organizador]
        );
        if (eventResult.rows.length === 0) {
            await client.query('ROLLBACK'); 
            return res.status(404).json({ message: 'Evento no encontrado o no pertenece a este organizador.' });
        }

        const event = eventResult.rows[0];

        // --- Manejo de Precios desde Categorías de Entradas ---
        // Asumiendo que 'Categorías de entradas' es una tabla separada que define los precios por zona para un evento.
        // Los nombres de las columnas en tu tabla "Categorías de entradas" son:
        // "Id_Categoria", "Id_Evento", "Nom_Categoria", "Precio", "Stock_Total", "Stock_Disponible"
        // Basado en tu log de consola, parece que "Precio" es el precio "regular", "Stock_Total" es "preventa" y "Stock_Disponible" es "conadis".
        // Confirmar estos mapeos con tu base de datos real.
        const preciosResult = await client.query(
            `SELECT 
                "Nom_Categoria" AS "zona", 
                "Precio" AS "regular", 
                "Stock_Total" AS "preventa", 
                "Stock_Disponible" AS "conadis" 
             FROM "Categorías de entradas"
             WHERE "Id_Evento" = $1`,
            [id]
        );
        event.Precios = preciosResult.rows; // Añadir el array de precios al objeto del evento

        event.Reglas = event.Reglas || [];

        res.status(200).json(event);
    } catch (error) {
        console.error('Error al obtener evento por ID para el proveedor:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener evento.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route PUT /eventos/:id
 * @description Actualiza un evento existente del organizador autenticado.
 * @access Privado (Organizador - middleware aplicado en index.js)
 */
router.put('/eventos/:id', uploadMiddleware, async (req, res) => {
    const { id } = req.params;
    const { 
        Nom_Evento, Fecha, Horario_Inicio, Horario_Fin, Categoria, 
        Id_Lugar, 
        Descripcion, 
        AsientosGeneral, AsientosVIP, AsientosConadis, 
        CostoGeneral, CostoVIP, CostoConadis, Reglas 
    } = req.body;
    const Id_Usuario_Organizador = req.user.id;

    if (!Nom_Evento || !Fecha || !Horario_Inicio || !Horario_Fin || !Categoria || !Id_Lugar || !Descripcion || !CostoGeneral || !AsientosGeneral) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: 'Todos los campos obligatorios deben ser proporcionados para la actualización.' });
    }

    if (!CATEGORIAS_VALIDAS.includes(Categoria)) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: `Categoría inválida. Las categorías permitidas son: ${CATEGORIAS_VALIDAS.join(', ')}.` });
    }

    let reglasParsed = '[]';
    try {
        if (Reglas) {
            reglasParsed = JSON.stringify(JSON.parse(Reglas));
        }
    } catch (e) {
        console.warn('Advertencia: Reglas no es un JSON válido en PUT, se guardará como array vacío.', e);
        reglasParsed = '[]';
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

        let oldImageUrl = null;
        if (req.file) { 
            const oldImageResult = await client.query(
                `SELECT "URL_Imagen_Evento" FROM "Eventos" WHERE "Id_Evento" = $1 AND "Id_Organizador" = $2`,
                [id, Id_Organizador]
            );
            if (oldImageResult.rows.length > 0) {
                oldImageUrl = oldImageResult.rows[0].URL_Imagen_Evento;
            }
        }

        const lugarCheck = await client.query(
            'SELECT "Capacidad_Total", "Cantidad_General", "Cantidad_VIP", "Cantidad_Conadis" FROM "Lugares" WHERE "Id_Lugar" = $1', 
            [Id_Lugar]
        );
        if (lugarCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'El lugar seleccionado no existe.' });
        }
        const capacidadesRealesLugar = lugarCheck.rows[0];

        const requestedAsientosGeneral = parseInt(AsientosGeneral);
        const requestedAsientosVIP = AsientosVIP ? parseInt(AsientosVIP) : 0;
        const requestedAsientosConadis = AsientosConadis ? parseInt(AsientosConadis) : 0;

        if (requestedAsientosGeneral > capacidadesRealesLugar.Cantidad_General) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: `La cantidad de asientos GENERAL (${requestedAsientosGeneral}) excede la capacidad disponible del lugar (${capacidadesRealesLugar.Cantidad_General}).` });
        }
        if (requestedAsientosVIP > capacidadesRealesLugar.Cantidad_VIP) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: `La cantidad de asientos VIP (${requestedAsientosVIP}) excede la capacidad disponible del lugar (${capacidadesRealesLugar.Cantidad_VIP}).` });
        }
        if (requestedAsientosConadis > capacidadesRealesLugar.Cantidad_Conadis) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: `La cantidad de asientos CONADIS (${requestedAsientosConadis}) excede la capacidad disponible del lugar (${capacidadesRealesLugar.Cantidad_Conadis}).` });
        }

        const finalImageUrl = req.file ? `/img/event_images/${req.file.filename}` : oldImageUrl; 
        const URL_Mapa_Eventos = null; // No usamos URL_Mapa en Eventos para la imagen de asientos

        const costoVIPValue = CostoVIP ? parseFloat(CostoVIP) : null;
        const costoConadisValue = CostoConadis ? parseFloat(CostoConadis) : null;

        const query = `
            UPDATE "Eventos" SET
                "Nom_Evento" = $1,
                "Fecha" = $2,
                "Horario_Inicio" = $3,
                "Horario_Fin" = $4,
                "Categoria" = $5,
                "Id_Lugar" = $6,
                "Descripcion" = $7,
                "PrecioGeneral" = $8,
                "PrecioVIP" = $9,
                "PrecioConadis" = $10,
                "URL_Imagen_Evento" = $11, 
                "URL_Mapa" = $12, 
                "Reglas" = $13,
                "Asientos_General_Disp" = $14,
                "Asientos_VIP_Disp" = $15,
                "Asientos_Conadis_Disp" = $16,
                "Estado" = 'pendiente' 
            WHERE "Id_Evento" = $17 AND "Id_Organizador" = $18
            RETURNING *;
        `;

        const result = await client.query(query, [
            Nom_Evento, Fecha, Horario_Inicio, Horario_Fin, Categoria, Id_Lugar, Descripcion, 
            parseFloat(CostoGeneral), costoVIPValue, costoConadisValue,
            finalImageUrl, URL_Mapa_Eventos, reglasParsed, 
            requestedAsientosGeneral, requestedAsientosVIP, requestedAsientosConadis, 
            id, Id_Organizador
        ]);

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(404).json({ message: 'Evento no encontrado o no pertenece a este organizador.' });
        }

        if (req.file && oldImageUrl && oldImageUrl.includes('/img/event_images/')) {
            const oldImagePath = path.join(__dirname, '..', '..', 'Fronted', oldImageUrl);
            if (fs.existsSync(oldImagePath)) {
                fs.unlinkSync(oldImagePath);
                console.log(`Imagen antigua eliminada del disco: ${oldImagePath}`);
            } else {
                console.warn(`Intento de eliminar imagen antigua que no existe: ${oldImagePath}`);
            }
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'Evento actualizado exitosamente y puesto en estado pendiente para revisión.', event: result.rows[0] });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al actualizar evento:', error.message);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Error al eliminar archivo subido tras un error:', err);
            });
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

        const eventImageResult = await client.query('SELECT "URL_Imagen_Evento" FROM "Eventos" WHERE "Id_Evento" = $1 AND "Id_Organizador" = $2', [id, Id_Organizador]);
        if (eventImageResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Evento no encontrado o no pertenece a este organizador.' });
        }
        const imageUrlToDelete = eventImageResult.rows[0].URL_Imagen_Evento;

        const deleteResult = await client.query('DELETE FROM "Eventos" WHERE "Id_Evento" = $1 AND "Id_Organizador" = $2 RETURNING *', [id, Id_Organizador]);

        if (deleteResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Evento no encontrado o no autorizado para eliminar.' });
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
        res.status(200).json({ message: `Evento con ID ${id} eliminado exitosamente.`, event: deleteResult.rows[0] });

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

        const result = await client.query(
            `UPDATE "Eventos" SET "SolicitudDestacar" = 'pendiente'
             WHERE "Id_Evento" = $1 AND "Id_Organizador" = $2 AND "Estado" = 'aprobado'
             RETURNING "Id_Evento", "Nom_Evento", "SolicitudDestacar"`,
            [id, Id_Organizador]
        );

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
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
    const { id } = req.params; 
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
                "Tipo_Ticket", 
                COUNT("Id_Ticket") AS total_tickets_vendidos
            FROM "Tickets"
            WHERE "Id_Evento" = $1
            GROUP BY "Tipo_Ticket"`, 
            [id]
        );

        let general_vendidos = 0;
        let vip_vendidos = 0;
        let conadis_vendidos = 0;
        let ganancias_estimadas = 0;

        ticketsSoldResult.rows.forEach(row => {
            const cantidad = parseInt(row.total_tickets_vendidos, 10);
            if (row.Tipo_Ticket === 'General') { 
                general_vendidos = cantidad;
                ganancias_estimadas += cantidad * parseFloat(eventDetails.PrecioGeneral || 0);
            } else if (row.Tipo_Ticket === 'VIP') { 
                vip_vendidos = cantidad;
                ganancias_estimadas += cantidad * parseFloat(eventDetails.PrecioVIP || 0);
            } else if (row.Tipo_Ticket === 'CONADIS') { 
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
                ganancias_estimadas: parseFloat(ganancias_estimadas).toFixed(2) 
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
