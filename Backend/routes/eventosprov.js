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
        AsientosGeneral, AsientosVIP, AsientosConadis, // Estos son los campos de stock del formulario
        CostoGeneral, CostoVIP, CostoConadis, Reglas 
    } = req.body;
    const Id_Usuario_Organizador = req.user.id; 

    console.log('--- Iniciando creación de evento ---');
    console.log('Datos recibidos:', { Nom_Evento, Fecha, Horario_Inicio, Horario_Fin, Categoria, Id_Lugar, Descripcion, AsientosGeneral, AsientosVIP, AsientosConadis, CostoGeneral, CostoVIP, CostoConadis });
    console.log('ID de Usuario Organizador:', Id_Usuario_Organizador);

    if (!Nom_Evento || !Fecha || !Horario_Inicio || !Horario_Fin || !Categoria || !Id_Lugar || !Descripcion || !CostoGeneral || !AsientosGeneral) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error('Error 400: Faltan campos obligatorios.');
        return res.status(400).json({ message: 'Todos los campos obligatorios deben ser proporcionados.' });
    }

    if (!req.file) {
        console.error('Error 400: No se proporcionó imagen.');
        return res.status(400).json({ message: 'Se requiere una imagen para el evento.' });
    }

    if (!CATEGORIAS_VALIDAS.includes(Categoria)) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error('Error 400: Categoría inválida.');
        return res.status(400).json({ message: `Categoría inválida. Las categorías permitidas son: ${CATEGORIAS_VALIDAS.join(', ')}.` });
    }

    const URL_Imagen_Evento = `/img/event_images/${req.file.filename}`;
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
        console.log('Transacción iniciada.');

        const orgResult = await client.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            console.error('Error 404: Organizador no encontrado.');
            return res.status(404).json({ message: 'Organizador no encontrado para el usuario autenticado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;
        console.log('Id_Organizador:', Id_Organizador);

        const lugarCheck = await client.query(
            'SELECT "Capacidad_Total", "Cantidad_General", "Cantidad_VIP", "Cantidad_Conadis" FROM "Lugares" WHERE "Id_Lugar" = $1', 
            [Id_Lugar]
        );
        if (lugarCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            console.error('Error 404: Lugar no existe.');
            return res.status(404).json({ error: 'El lugar seleccionado no existe.' });
        }
        const capacidadesRealesLugar = lugarCheck.rows[0];
        console.log('Capacidades del lugar:', capacidadesRealesLugar);

        // Parsear los asientos solicitados, si no se proporcionan, se asume 0.
        const requestedAsientosGeneral = parseInt(AsientosGeneral || 0); 
        const requestedAsientosVIP = parseInt(AsientosVIP || 0); 
        const requestedAsientosConadis = parseInt(AsientosConadis || 0); 

        // Validaciones de capacidad contra el lugar
        if (requestedAsientosGeneral > capacidadesRealesLugar.Cantidad_General) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            console.error('Error 400: Asientos GENERAL exceden capacidad.');
            return res.status(400).json({ error: `La cantidad de asientos GENERAL (${requestedAsientosGeneral}) excede la capacidad disponible del lugar (${capacidadesRealesLugar.Cantidad_General}).` });
        }
        if (requestedAsientosVIP > capacidadesRealesLugar.Cantidad_VIP) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            console.error('Error 400: Asientos VIP exceden capacidad.');
            return res.status(400).json({ error: `La cantidad de asientos VIP (${requestedAsientosVIP}) excede la capacidad disponible del lugar (${capacidadesRealesLugar.Cantidad_VIP}).` });
        }
        if (requestedAsientosConadis > capacidadesRealesLugar.Cantidad_Conadis) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            console.error('Error 400: Asientos CONADIS exceden capacidad.');
            return res.status(400).json({ error: `La cantidad de asientos CONADIS (${requestedAsientosConadis}) excede la capacidad disponible del lugar (${capacidadesRealesLugar.Cantidad_Conadis}).` });
        }

        const Estado_Evento = 'pendiente'; 

        const insertEventQuery = `
            INSERT INTO "Eventos" (
                "Id_Organizador", "Nom_Evento", "Fecha", "Horario_Inicio", "Horario_Fin",
                "Categoria", "Id_Lugar", "Descripcion", "URL_Imagen_Evento", "URL_Mapa", "Reglas",
                "PrecioGeneral", "PrecioVIP", "PrecioConadis", "Estado" 
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING "Id_Evento"; 
        `;

        const costoVIPValue = CostoVIP ? parseFloat(CostoVIP) : null;
        const costoConadisValue = CostoConadis ? parseFloat(CostoConadis) : null;

        console.log('Intentando insertar en Eventos...');
        const eventInsertResult = await client.query(insertEventQuery, [
            Id_Organizador, Nom_Evento, Fecha, Horario_Inicio, Horario_Fin,
            Categoria, Id_Lugar, Descripcion, URL_Imagen_Evento, URL_Mapa_Eventos, reglasParsed, 
            parseFloat(CostoGeneral), costoVIPValue, costoConadisValue, Estado_Evento 
        ]);

        const newEventId = eventInsertResult.rows[0].Id_Evento;
        console.log('Evento insertado. Nuevo Id_Evento:', newEventId);

        // --- Insertar las categorías de entradas y su stock en "Categorías de entradas" ---
        console.log('Intentando insertar ZONA GENERAL en Categorías de entradas para Evento ID:', newEventId);
        await client.query(
            `INSERT INTO "Categorías de entradas" ("Id_Evento", "Nom_Categoria", "Precio", "Stock_Total", "Stock_Disponible")
             VALUES ($1, 'ZONA GENERAL', $2, $3, $3) -- Stock_Total y Stock_Disponible son iguales al inicio
             ON CONFLICT ("Id_Evento", "Nom_Categoria") DO UPDATE
             SET "Precio" = EXCLUDED."Precio",
                 "Stock_Total" = EXCLUDED."Stock_Total",
                 "Stock_Disponible" = EXCLUDED."Stock_Disponible";`,
            [newEventId, parseFloat(CostoGeneral), requestedAsientosGeneral]
        );
        console.log('ZONA GENERAL insertada/actualizada para Evento ID:', newEventId);

        if (requestedAsientosVIP > 0 && CostoVIP) {
            console.log('Intentando insertar ZONA VIP en Categorías de entradas para Evento ID:', newEventId);
            await client.query(
                `INSERT INTO "Categorías de entradas" ("Id_Evento", "Nom_Categoria", "Precio", "Stock_Total", "Stock_Disponible")
                 VALUES ($1, 'ZONA VIP', $2, $3, $3)
                 ON CONFLICT ("Id_Evento", "Nom_Categoria") DO UPDATE
                 SET "Precio" = EXCLUDED."Precio",
                     "Stock_Total" = EXCLUDED."Stock_Total",
                     "Stock_Disponible" = EXCLUDED."Stock_Disponible";`,
                [newEventId, parseFloat(CostoVIP), requestedAsientosVIP]
            );
            console.log('ZONA VIP insertada/actualizada para Evento ID:', newEventId);
        }

        if (requestedAsientosConadis > 0 && CostoConadis) {
            console.log('Intentando insertar ZONA CONADIS en Categorías de entradas para Evento ID:', newEventId);
             await client.query(
                `INSERT INTO "Categorías de entradas" ("Id_Evento", "Nom_Categoria", "Precio", "Stock_Total", "Stock_Disponible")
                 VALUES ($1, 'ZONA CONADIS', $2, $3, $3)
                 ON CONFLICT ("Id_Evento", "Nom_Categoria") DO UPDATE
                 SET "Precio" = EXCLUDED."Precio",
                     "Stock_Total" = EXCLUDED."Stock_Total",
                     "Stock_Disponible" = EXCLUDED."Stock_Disponible";`,
                [newEventId, parseFloat(CostoConadis), requestedAsientosConadis]
            );
            console.log('ZONA CONADIS insertada/actualizada para Evento ID:', newEventId);
        }


        await client.query('COMMIT'); 
        console.log('Transacción completada exitosamente.');
        res.status(201).json({ message: 'Evento creado exitosamente y pendiente de aprobación.', eventId: newEventId });

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK'); 
            console.error('Transacción revertida debido a un error.');
        }
        console.error('Error al crear evento:', error.message);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Error al eliminar archivo subido tras un error:', err);
            });
        }
        res.status(500).json({ message: 'Error interno del servidor al crear evento.' });
    } finally {
        if (client) client.release();
        console.log('Conexión a la base de datos liberada.');
    }
});

/**
 * @route GET /eventos
 * @description Obtiene todos los eventos creados por el organizador autenticado (sin filtrar por estado).
 * @access Privado (Organizador - middleware aplicado en index.js)
 */
router.get('/eventos', async (req, res) => {
    const Id_Usuario_Organizador = req.user.id; 

    let client; // Declarar client aquí
    try {
        client = await pool.connect(); // Asignar client aquí

        const orgResult = await client.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            return res.status(404).json({ message: 'Organizador no encontrado para el usuario autenticado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;

        const result = await client.query(
            `SELECT
                e."Id_Evento", e."Nom_Evento", e."Fecha", e."Horario_Inicio", e."Horario_Fin", e."Categoria",
                e."Descripcion", e."PrecioGeneral", e."PrecioVIP", e."PrecioConadis", e."Estado", 
                e."URL_Imagen_Evento", 
                l."URL_Imagen_Asientos", -- OBTENEMOS URL_Imagen_Asientos DEL LUGAR
                e."Reglas",
                e."SolicitudDestacar",
                l."Nom_Lugar", 
                l."Ubicacion_Lugar" AS "Ubicacion_Lugar" 
            FROM "Eventos" e
            LEFT JOIN "Lugares" l ON e."Id_Lugar" = l."Id_Lugar" 
            WHERE e."Id_Organizador" = $1
            ORDER BY e."Fecha" DESC`,
            [Id_Organizador]
        );

        // Para cada evento, obtener sus categorías de entradas y stock
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

        res.status(200).json({ message: 'Eventos obtenidos exitosamente.', events: eventsWithFullDetails });
    } catch (error) {
        console.error('Error al obtener eventos del proveedor:', error.message);
        // Asegurarse de liberar el cliente en caso de error
        if (client) client.release(); 
        res.status(500).json({ message: 'Error interno del servidor al obtener eventos.' });
    } finally {
        // Asegurarse de liberar el cliente si no se ha hecho en el catch
        if (client) client.release();
    }
});

/**
 * @route GET /eventos-aprobados
 * @description Obtiene solo los eventos creados por el organizador autenticado que están 'aprobados'.
 * @access Privado (Organizador - middleware aplicado en index.js)
 */
router.get('/eventos-aprobados', async (req, res) => {
    const Id_Usuario_Organizador = req.user.id; 

    let client; // Declarar client aquí
    try {
        client = await pool.connect(); // Asignar client aquí

        const orgResult = await client.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            return res.status(404).json({ message: 'Organizador no encontrado para el usuario autenticado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;

        const result = await client.query(
            `SELECT
                e."Id_Evento", e."Nom_Evento", e."Fecha", e."Horario_Inicio", e."Horario_Fin", e."Categoria",
                e."Descripcion", e."PrecioGeneral", e."PrecioVIP", e."PrecioConadis", e."Estado", 
                e."URL_Imagen_Evento", 
                l."URL_Imagen_Asientos", -- OBTENEMOS URL_Imagen_Asientos DEL LUGAR
                e."Reglas",
                e."SolicitudDestacar",
                l."Nom_Lugar", 
                l."Ubicacion_Lugar" AS "Ubicacion_Lugar" 
            FROM "Eventos" e
            LEFT JOIN "Lugares" l ON e."Id_Lugar" = l."Id_Lugar" 
            WHERE e."Id_Organizador" = $1 AND e."Estado" = 'aprobado'
            ORDER BY e."Fecha" DESC`,
            [Id_Organizador]
        );

        // Para cada evento, obtener sus categorías de entradas y stock
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

        res.status(200).json({ message: 'Eventos aprobados obtenidos exitosamente.', events: eventsWithFullDetails });
    } catch (error) {
        console.error('Error al obtener eventos aprobados del proveedor:', error.message);
        // Asegurarse de liberar el cliente en caso de error
        if (client) client.release();
        res.status(500).json({ message: 'Error interno del servidor al obtener eventos aprobados.' });
    } finally {
        // Asegurarse de liberar el cliente si no se ha hecho en el catch
        if (client) client.release();
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

    let client; // Declarar client aquí
    try {
        client = await pool.connect(); // Asignar client aquí
        const orgResult = await client.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            // No hay necesidad de rollback si no se inició una transacción
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
                e."SolicitudDestacar",
                l."Nom_Lugar", l."Ubicacion_Lugar" AS "Ubicacion_Lugar", 
                l."Capacidad_Total", l."Cantidad_General", l."Cantidad_VIP", l."Cantidad_Conadis", l."URL_Imagen_Referencial"
            FROM "Eventos" e
            LEFT JOIN "Lugares" l ON e."Id_Lugar" = l."Id_Lugar" 
            WHERE e."Id_Evento" = $1 AND e."Id_Organizador" = $2`,
            [id, Id_Organizador]
        );
        if (eventResult.rows.length === 0) {
            // No hay necesidad de rollback si no se inició una transacción
            return res.status(404).json({ message: 'Evento no encontrado o no pertenece a este organizador.' });
        }

        const event = eventResult.rows[0];

        // --- Obtener las categorías de entradas y su stock desde la tabla "Categorías de entradas" ---
        const categoriasDeEntradasResult = await client.query(
            `SELECT 
                "Id_Categoria", 
                "Nom_Categoria", 
                "Precio" AS "precioRegular", 
                "Stock_Total" AS "precioPreventa", -- Asumiendo que Stock_Total es el precio de preventa
                "Stock_Disponible" AS "precioConadis", -- Asumiendo que Stock_Disponible es el precio CONADIS
                "Stock_Disponible" AS "stockDisponible" -- Obtener el stock disponible real
             FROM "Categorías de entradas"
             WHERE "Id_Evento" = $1
             ORDER BY "Nom_Categoria" ASC;`,
            [id]
        );

        const categoriasDeEntradas = categoriasDeEntradasResult.rows.map(cat => ({
            id_categoria: cat.Id_Categoria,
            Nom_Categoria: cat.Nom_Categoria,
            precioRegular: parseFloat(cat.precioRegular || 0).toFixed(2),
            precioPreventa: parseFloat(cat.precioPreventa || 0).toFixed(2),
            precioConadis: parseFloat(cat.precioConadis || 0).toFixed(2),
            stockDisponible: parseInt(cat.stockDisponible || 0)
        }));

        event.CategoriasDeEntradas = categoriasDeEntradas; // Añadir el array de categorías al objeto del evento

        event.Reglas = event.Reglas || [];

        res.status(200).json(event);
    } catch (error) {
        console.error('Error al obtener evento por ID para el proveedor:', error.message);
        // Asegurarse de liberar el cliente en caso de error
        if (client) client.release();
        res.status(500).json({ message: 'Error interno del servidor al obtener evento.' });
    } finally {
        // Asegurarse de liberar el cliente si no se ha hecho en el catch
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
        AsientosGeneral, AsientosVIP, AsientosConadis, // Campos de stock para actualizar
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

    let client; // Declarar client aquí
    try {
        client = await pool.connect(); // Asignar client aquí
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

        // Parsear los asientos solicitados, si no se proporcionan, se asume 0.
        const requestedAsientosGeneral = parseInt(AsientosGeneral || 0);
        const requestedAsientosVIP = parseInt(AsientosVIP || 0);
        const requestedAsientosConadis = parseInt(AsientosConadis || 0);

        // Validaciones de capacidad contra el lugar
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

        // --- CAMBIO CLAVE AQUÍ: Eliminar las columnas de stock de la actualización en "Eventos" ---
        const updateEventQuery = `
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
                "Estado" = 'pendiente' 
            WHERE "Id_Evento" = $14 AND "Id_Organizador" = $15
            RETURNING "Id_Evento";
        `;

        const eventUpdateResult = await client.query(updateEventQuery, [
            Nom_Evento, Fecha, Horario_Inicio, Horario_Fin, Categoria, Id_Lugar, Descripcion, 
            parseFloat(CostoGeneral), costoVIPValue, costoConadisValue,
            finalImageUrl, URL_Mapa_Eventos, reglasParsed, 
            id, Id_Organizador
        ]);

        if (eventUpdateResult.rowCount === 0) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(404).json({ message: 'Evento no encontrado o no pertenece a este organizador.' });
        }

        const updatedEventId = eventUpdateResult.rows[0].Id_Evento;

        // --- NUEVO: Actualizar las categorías de entradas y su stock en "Categorías de entradas" ---
        // Actualizar General
        await client.query(
            `INSERT INTO "Categorías de entradas" ("Id_Evento", "Nom_Categoria", "Precio", "Stock_Total", "Stock_Disponible")
             VALUES ($1, 'ZONA GENERAL', $2, $3, $3)
             ON CONFLICT ("Id_Evento", "Nom_Categoria") DO UPDATE
             SET "Precio" = EXCLUDED."Precio",
                 "Stock_Total" = EXCLUDED."Stock_Total",
                 "Stock_Disponible" = EXCLUDED."Stock_Disponible";`,
            [updatedEventId, parseFloat(CostoGeneral), requestedAsientosGeneral]
        );

        // Actualizar VIP (si se proporcionó)
        if (requestedAsientosVIP > 0 && CostoVIP) {
            await client.query(
                `INSERT INTO "Categorías de entradas" ("Id_Evento", "Nom_Categoria", "Precio", "Stock_Total", "Stock_Disponible")
                 VALUES ($1, 'ZONA VIP', $2, $3, $3)
                 ON CONFLICT ("Id_Evento", "Nom_Categoria") DO UPDATE
                 SET "Precio" = EXCLUDED."Precio",
                     "Stock_Total" = EXCLUDED."Stock_Total",
                     "Stock_Disponible" = EXCLUDED."Stock_Disponible";`,
                [updatedEventId, parseFloat(CostoVIP), requestedAsientosVIP]
            );
        } else {
            // Si VIP es 0 o no se proporcionó, podríamos eliminar la categoría si existe
            await client.query(
                `DELETE FROM "Categorías de entradas" WHERE "Id_Evento" = $1 AND "Nom_Categoria" = 'ZONA VIP';`,
                [updatedEventId]
            );
        }

        // Actualizar CONADIS (si se proporcionó)
        if (requestedAsientosConadis > 0 && CostoConadis) {
             await client.query(
                `INSERT INTO "Categorías de entradas" ("Id_Evento", "Nom_Categoria", "Precio", "Stock_Total", "Stock_Disponible")
                 VALUES ($1, 'ZONA CONADIS', $2, $3, $3)
                 ON CONFLICT ("Id_Evento", "Nom_Categoria") DO UPDATE
                 SET "Precio" = EXCLUDED."Precio",
                     "Stock_Total" = EXCLUDED."Stock_Total",
                     "Stock_Disponible" = EXCLUDED."Stock_Disponible";`,
                [updatedEventId, parseFloat(CostoConadis), requestedAsientosConadis]
            );
        } else {
            // Si CONADIS es 0 o no se proporcionó, podríamos eliminar la categoría si existe
            await client.query(
                `DELETE FROM "Categorías de entradas" WHERE "Id_Evento" = $1 AND "Nom_Categoria" = 'ZONA CONADIS';`,
                [updatedEventId]
            );
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
        res.status(200).json({ message: 'Evento actualizado exitosamente y puesto en estado pendiente para revisión.', eventId: updatedEventId });

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

    let client; // Declarar client aquí
    try {
        client = await pool.connect(); // Asignar client aquí
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

        // --- Borrar primero las categorías de entradas asociadas a este evento ---
        await client.query(`DELETE FROM "Categorías de entradas" WHERE "Id_Evento" = $1;`, [id]);

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
        // Asegurarse de liberar el cliente en caso de error
        if (client) client.release();
        res.status(500).json({ message: 'Error interno del servidor al eliminar el evento.' });
    } finally {
        // Asegurarse de liberar el cliente si no se ha hecho en el catch
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

    let client; // Declarar client aquí
    try {
        client = await pool.connect(); // Asignar client aquí
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
        // Asegurarse de liberar el cliente en caso de error
        if (client) client.release();
        res.status(500).json({ message: 'Error interno del servidor al solicitar destacar el evento.' });
    } finally {
        // Asegurarse de liberar el cliente si no se ha hecho en el catch
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

    let client; // Declarar client aquí
    try {
        client = await pool.connect(); // Asignar client aquí

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
        // Asegurarse de liberar el cliente en caso de error
        if (client) client.release();
        res.status(500).json({ message: 'Error interno del servidor al obtener estadísticas del evento.' });
    } finally {
        // Asegurarse de liberar el cliente si no se ha hecho en el catch
        if (client) client.release();
    }
});


module.exports = router;
