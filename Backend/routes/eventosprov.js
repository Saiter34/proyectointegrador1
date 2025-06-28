// Backend/routes/eventosprov.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Listas permitidas para validación (Actualizadas para coincidir con el frontend)
const CATEGORIAS_VALIDAS = ['Conciertos', 'Teatro', 'Deportes'];
const UBICACIONES_VALIDAS = [
    'Gran Teatro Nacional (San Borja)',
    'Teatro Canout (Miraflores)',
    'Teatro Manuel Ascencio Segura (Centro de Lima)',
    'Estadio de San Marcos (UNMSM)',
    'Estadio Nacional (Lima)', // Para Conciertos
    'Anfiteatro del Parque de la Exposición',
    'Estadio Nacional', // Para Deportes (nombre diferente al de Conciertos en tu esquema)
    'Estadio Monumental (Ate, “Monumental U”)',
    'Estadio Alejandro Villanueva (Matute)'
];

// Configuración de Multer: Definida aquí, NO en index.js para estas rutas.
const uploadMiddleware = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const imagesDir = path.join(__dirname, '..', '..', 'Fronted', 'img', 'event_images');
            console.log(`[Multer Dest] Intentando guardar en: ${imagesDir}`); // LOG
            if (!fs.existsSync(imagesDir)) {
                console.log(`[Multer Dest] Directorio no existe, intentando crear: ${imagesDir}`); // LOG
                try {
                    fs.mkdirSync(imagesDir, { recursive: true });
                    console.log(`[Multer Dest] Directorio creado exitosamente: ${imagesDir}`); // LOG
                } catch (mkdirError) {
                    console.error(`[Multer Dest] Error al crear directorio: ${mkdirError.message}`); // LOG DE ERROR CRÍTICO
                    return cb(new Error('No se pudo crear el directorio de imágenes del evento.'), null);
                }
            }
            cb(null, imagesDir);
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const originalExtension = path.extname(file.originalname);
            const filename = `${file.fieldname}-${uniqueSuffix}${originalExtension}`;
            console.log(`[Multer File] Generando nombre de archivo: ${filename}`); // LOG
            cb(null, filename);
        }
    })
}).single('imagenEvento'); // El nombre del campo en el formulario es 'imagenEvento'

// Rutas para los proveedores (organizadores)

/**
 * @route POST /api/proveedor/eventos/crear
 * @description Permite a un organizador crear un nuevo evento.
 * Requiere autenticación y rol de 'organizador'.
 * Recibe stock de asientos y precios.
 * @access Privado (Organizador)
 */
router.post('/eventos/crear', authenticateToken, authorizeRole(['organizador']), uploadMiddleware, async (req, res) => {
    console.log('[Route Handler] Solicitud recibida en /api/proveedor/eventos/crear'); 

    const { 
        Nom_Evento, Fecha, Horario_Inicio, Horario_Fin, Categoria, Ubicacion, 
        Descripcion, AsientosGeneral, AsientosVIP, CostoGeneral, CostoVIP, CostoConadis 
    } = req.body;
    const Id_Usuario_Organizador = req.user.id;

    console.log('[Route Handler] req.body datos:', { Nom_Evento, Fecha, Categoria, Ubicacion, AsientosGeneral, CostoGeneral }); 
    console.log('[Route Handler] req.file:', req.file); 

    // Convertir Asientos a números enteros y Precios a flotantes, asegurando que los opcionales sean null o 0
    const parsedAsientosGeneral = parseInt(AsientosGeneral, 10);
    const parsedAsientosVIP = AsientosVIP ? parseInt(AsientosVIP, 10) : 0; 
    const parsedCostoGeneral = parseFloat(CostoGeneral);
    const parsedCostoVIP = CostoVIP ? parseFloat(CostoVIP) : null; 
    const parsedCostoConadis = parseFloat(CostoConadis);

    // Validaciones de campos obligatorios y la imagen
    if (!Nom_Evento || !Fecha || !Horario_Inicio || !Horario_Fin || !Categoria || !Ubicacion || !Descripcion || 
        isNaN(parsedAsientosGeneral) || parsedAsientosGeneral < 1 || 
        isNaN(parsedCostoGeneral) || parsedCostoGeneral < 1.00 || 
        !req.file) {
        
        if (req.file && fs.existsSync(req.file.path)) {
            console.log('[Route Handler] Eliminando archivo subido temporalmente debido a validación fallida:', req.file.path);
            fs.unlinkSync(req.file.path);
        }
        console.log('[Route Handler] Validación fallida: Faltan campos o son inválidos.');
        return res.status(400).json({ message: 'Todos los campos obligatorios (nombre, fecha, horarios, categoría, ubicación, descripción, asientos general, precio general, imagen) deben ser proporcionados y válidos.' });
    }

    if (AsientosVIP && (isNaN(parsedAsientosVIP) || parsedAsientosVIP < 0)) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.log('[Route Handler] Validación fallida: Asientos VIP inválidos.');
        return res.status(400).json({ message: 'Los asientos VIP deben ser un número válido mayor o igual a cero.' });
    }

    if (CostoVIP && (isNaN(parsedCostoVIP) || parsedCostoVIP < 1.00)) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.log('[Route Handler] Validación fallida: Precio VIP inválido.');
        return res.status(400).json({ message: 'El precio VIP debe ser un número válido mayor o igual a 1.00.' });
    }
    
    if (!CATEGORIAS_VALIDAS.includes(Categoria)) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.log('[Route Handler] Validación fallida: Categoría inválida.');
        return res.status(400).json({ message: `Categoría inválida. Las categorías permitidas son: ${CATEGORIAS_VALIDAS.join(', ')}.` });
    }

    if (!UBICACIONES_VALIDAS.includes(Ubicacion)) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.log('[Route Handler] Validación fallida: Ubicación inválida.');
        return res.status(400).json({ message: `Ubicación inválida. Las ubicaciones permitidas son: ${UBICACIONES_VALIDAS.join(', ')}.` });
    }

    const URL_Imagen = `/img/event_images/${req.file.filename}`;
    console.log('[Route Handler] URL_Imagen final:', URL_Imagen); 

    let client;
    try {
        console.log('[Route Handler] Intentando conectar a la base de datos...'); 
        client = await pool.connect();
        console.log('[Route Handler] Conexión a DB exitosa. Iniciando transacción...'); 
        await client.query('BEGIN');

        console.log('[Route Handler] Buscando Id_Organizador para usuario:', Id_Usuario_Organizador); 
        const orgResult = await client.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            console.log('[Route Handler] Organizador no encontrado.');
            return res.status(404).json({ message: 'Organizador no encontrado para el usuario autenticado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;
        console.log('[Route Handler] Id_Organizador encontrado:', Id_Organizador); 

        // --- INSERT USANDO 'fecha_creacion_evento' (nombre seguro sin comillas) ---
        const insertQuery = `INSERT INTO "Eventos" (
                "Id_Organizador", "Nom_Evento", "Fecha", "Horario_Inicio", "Horario_Fin",
                "Categoria", "Ubicacion", "Descripcion", 
                "Asientos_General_Disponibles", "Asientos_VIP_Disponibles", "Asientos_CONADIS_Disponibles",
                "PrecioGeneral", "PrecioVIP", "PrecioConadis", 
                "Estado", "URL_Imagen", fecha_creacion_evento 
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`;
        
        const insertValues = [
            Id_Organizador,             // $1
            Nom_Evento,                 // $2
            Fecha,                      // $3
            Horario_Inicio,             // $4
            Horario_Fin,                // $5
            Categoria,                  // $6
            Ubicacion,                  // $7
            Descripcion,                // $8
            parsedAsientosGeneral,      // $9 (INTEGER)
            parsedAsientosVIP,          // $10 (INTEGER, 0 si estaba vacío)
            0,                          // $11 (Asientos_CONADIS_Disponibles - Fijo a 0 por defecto)
            parsedCostoGeneral,         // $12 (NUMERIC)
            parsedCostoVIP,             // $13 (NUMERIC, NULL si estaba vacío)
            parseFloat(parsedCostoConadis.toFixed(2)), // $14 (NUMERIC)
            'pendiente',                // $15 (Literal para "Estado")
            URL_Imagen,                 // $16 (VARCHAR)
            new Date()                  // $17 (TIMESTAMP - Valor explícito para 'fecha_creacion_evento')
        ];
        
        console.log('[Route Handler] Ejecutando INSERT con query:', insertQuery); 
        console.log('[Route Handler] INSERT valores:', insertValues); 
        
        const result = await client.query(insertQuery, insertValues);

        console.log('[Route Handler] INSERT ejecutado exitosamente. Commiteando transacción...'); 
        await client.query('COMMIT');
        console.log('[Route Handler] Transacción commiteada. Evento creado.'); 
        res.status(201).json({ message: 'Evento creado exitosamente y pendiente de aprobación.', event: result.rows[0] });

    } catch (error) {
        if (client) {
            console.log('[Route Handler] Error en la transacción, intentando ROLLBACK...');
            await client.query('ROLLBACK');
            console.log('[Route Handler] ROLLBACK completado.');
        }
        console.error('Error al crear evento:', error.message); 
        console.error('Stack trace del error:', error.stack); 
        if (req.file && fs.existsSync(req.file.path)) {
            console.log('[Route Handler] Eliminando archivo subido en caso de error:', req.file.path);
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ message: 'Error interno del servidor al crear el evento.' });
    } finally {
        if (client) client.release();
        console.log('[Route Handler] Cliente de DB liberado.');
    }
});

/**
 * @route GET /api/proveedor/eventos
 * @description Obtiene todos los eventos creados por el organizador autenticado.
 * Incluye los nuevos campos de stock.
 * @access Privado (Organizador)
 */
router.get('/eventos', authenticateToken, authorizeRole(['organizador']), async (req, res) => {
    const Id_Usuario_Organizador = req.user.id;
    console.log('[Route GET /eventos] Solicitud recibida para usuario:', Id_Usuario_Organizador);

    try {
        const orgResult = await pool.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            console.log('[Route GET /eventos] Organizador no encontrado.');
            return res.status(404).json({ message: 'Organizador no encontrado para el usuario autenticado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;
        console.log('[Route GET /eventos] Id_Organizador encontrado:', Id_Organizador);

        // --- SELECT USANDO 'fecha_creacion_evento' (nombre seguro sin comillas) ---
        const result = await pool.query(
            `SELECT 
                "Id_Evento", "Nom_Evento", "Fecha", "Horario_Inicio", "Horario_Fin", 
                "Categoria", "Ubicacion", "Descripcion", 
                "PrecioGeneral", "PrecioVIP", "PrecioConadis", 
                "Asientos_General_Disponibles", "Asientos_VIP_Disponibles", "Asientos_CONADIS_Disponibles",
                "Estado", "URL_Imagen", fecha_creacion_evento 
            FROM "Eventos" 
            WHERE "Id_Organizador" = $1 
            ORDER BY "Fecha" DESC`, 
            [Id_Organizador]
        );
        // --- FIN DEL SELECT ---
        console.log('[Route GET /eventos] Eventos obtenidos exitosamente:', result.rows.length);
        res.status(200).json({ message: 'Eventos obtenidos exitosamente.', events: result.rows });
    } catch (error) {
        console.error('Error al obtener eventos del proveedor:', error.message);
        console.error('Stack trace del error:', error.stack);
        res.status(500).json({ message: 'Error interno del servidor al obtener eventos.' });
    }
});

/**
 * @route GET /api/proveedor/eventos/:id
 * @description Obtiene los detalles de un evento específico del organizador autenticado.
 * Incluye los nuevos campos de stock.
 * @access Privado (Organizador)
 */
router.get('/eventos/:id', authenticateToken, authorizeRole(['organizador']), async (req, res) => {
    const { id } = req.params;
    const Id_Usuario_Organizador = req.user.id;
    console.log('[Route GET /eventos/:id] Solicitud recibida para evento ID:', id, 'usuario:', Id_Usuario_Organizador);

    try {
        const orgResult = await pool.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            console.log('[Route GET /eventos/:id] Organizador no encontrado.');
            return res.status(404).json({ message: 'Organizador no encontrado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador;
        console.log('[Route GET /eventos/:id] Id_Organizador encontrado:', Id_Organizador);

        // --- SELECT USANDO 'fecha_creacion_evento' (nombre seguro sin comillas) ---
        const result = await pool.query(
            `SELECT 
                "Id_Evento", "Nom_Evento", "Fecha", "Horario_Inicio", "Horario_Fin", 
                "Categoria", "Ubicacion", "Descripcion", 
                "PrecioGeneral", "PrecioVIP", "PrecioConadis", 
                "Asientos_General_Disponibles", "Asientos_VIP_Disponibles", "Asientos_CONADIS_Disponibles",
                "Estado", "URL_Imagen", fecha_creacion_evento 
            FROM "Eventos" 
            WHERE "Id_Evento" = $1 AND "Id_Organizador" = $2`, 
            [id, Id_Organizador]
        );
        // --- FIN DEL SELECT ---
        if (result.rows.length === 0) {
            console.log('[Route GET /eventos/:id] Evento no encontrado o no pertenece a este organizador.');
            return res.status(404).json({ message: 'Evento no encontrado o no pertenece a este organizador.' });
        }
        console.log('[Route GET /eventos/:id] Evento encontrado:', result.rows[0].Nom_Evento);
        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Error al obtener evento por ID para el proveedor:', error.message);
        console.error('Stack trace del error:', error.stack);
        res.status(500).json({ message: 'Error interno del servidor al obtener evento.' });
    }
});

/**
 * @route PUT /api/proveedor/eventos/:id
 * @description Actualiza un evento existente del organizador autenticado.
 * Permite subir una nueva imagen si se proporciona y actualiza los campos de stock.
 * @access Privado (Organizador)
 */
router.put('/eventos/:id', authenticateToken, authorizeRole(['organizador']), uploadMiddleware, async (req, res) => {
    const { id } = req.params;
    const { 
        Nom_Evento, Fecha, Horario_Inicio, Horario_Fin, Categoria, Ubicacion, 
        Descripcion, AsientosGeneral, AsientosVIP, CostoGeneral, CostoVIP, CostoConadis 
    } = req.body;
    const Id_Usuario_Organizador = req.user.id;
    console.log('[Route PUT /eventos/:id] Solicitud recibida para evento ID:', id, 'usuario:', Id_Usuario_Organizador);

    // Convertir a números
    const parsedAsientosGeneral = parseInt(AsientosGeneral, 10);
    const parsedAsientosVIP = AsientosVIP ? parseInt(AsientosVIP, 10) : 0;
    const parsedCostoGeneral = parseFloat(CostoGeneral);
    const parsedCostoVIP = CostoVIP ? parseFloat(CostoVIP) : null;
    const parsedCostoConadis = parseFloat(CostoConadis);

    // Validaciones de campos (igual que en crear)
    if (!Nom_Evento || !Fecha || !Horario_Inicio || !Horario_Fin || !Categoria || !Ubicacion || !Descripcion || 
        isNaN(parsedAsientosGeneral) || parsedAsientosGeneral < 1 || 
        isNaN(parsedCostoGeneral) || parsedCostoGeneral < 1.00) {
        
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        console.log('[Route PUT /eventos/:id] Validación fallida: Faltan campos o son inválidos.');
        return res.status(400).json({ message: 'Todos los campos obligatorios (nombre, fecha, horarios, categoría, ubicación, descripción, asientos general, precio general) deben ser proporcionados y válidos.' });
    }

    if (AsientosVIP && (isNaN(parsedAsientosVIP) || parsedAsientosVIP < 0)) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.log('[Route PUT /eventos/:id] Validación fallida: Asientos VIP inválidos.');
        return res.status(400).json({ message: 'Los asientos VIP deben ser un número válido mayor o igual a cero.' });
    }
    if (CostoVIP && (isNaN(parsedCostoVIP) || parsedCostoVIP < 1.00)) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.log('[Route PUT /eventos/:id] Validación fallida: Precio VIP inválido.');
        return res.status(400).json({ message: 'El precio VIP debe ser un número válido mayor o igual a 1.00.' });
    }

    if (!CATEGORIAS_VALIDAS.includes(Categoria)) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.log('[Route PUT /eventos/:id] Validación fallida: Categoría inválida.');
        return res.status(400).json({ message: `Categoría inválida. Las categorías permitidas son: ${CATEGORIAS_VALIDAS.join(', ')}.` });
    }
    if (!UBICACIONES_VALIDAS.includes(Ubicacion)) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.log('[Route PUT /eventos/:id] Validación fallida: Ubicación inválida.');
        return res.status(400).json({ message: `Ubicación inválida. Las ubicaciones permitidas son: ${UBICACIONES_VALIDAS.join(', ')}.` });
    }

    let client;
    try {
        console.log('[Route PUT /eventos/:id] Intentando conectar a la base de datos...');
        client = await pool.connect();
        console.log('[Route PUT /eventos/:id] Conexión a DB exitosa. Iniciando transacción...');
        await client.query('BEGIN');

        console.log('[Route PUT /eventos/:id] Verificando evento existente...');
        const checkEvent = await client.query('SELECT "URL_Imagen" FROM "Eventos" WHERE "Id_Evento" = $1 AND "Id_Organizador" = $2', [id, Id_Organizador]);
        if (checkEvent.rows.length === 0) {
            await client.query('ROLLBACK');
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            console.log('[Route PUT /eventos/:id] Evento no encontrado o no pertenece al organizador.');
            return res.status(404).json({ message: 'Evento no encontrado o no pertenece a este organizador.' });
        }

        let URL_Imagen = checkEvent.rows[0].URL_Imagen; 
        console.log('[Route PUT /eventos/:id] URL_Imagen actual:', URL_Imagen);

        if (req.file) { 
            console.log('[Route PUT /eventos/:id] Nueva imagen detectada. Eliminando antigua si existe...');
            const oldImagePath = path.join(__dirname, '..', '..', 'Fronted', URL_Imagen);
            if (fs.existsSync(oldImagePath) && oldImagePath.includes('/img/event_images/')) {
                fs.unlinkSync(oldImagePath);
                console.log('[Route PUT /eventos/:id] Imagen antigua eliminada:', oldImagePath);
            }
            URL_Imagen = `/img/event_images/${req.file.filename}`; 
            console.log('[Route PUT /eventos/:id] Nueva URL_Imagen:', URL_Imagen);
        }

        // --- UPDATE USANDO 'fecha_creacion_evento' (nombre seguro sin comillas) ---
        const updateQuery = `UPDATE "Eventos" SET
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
                "Asientos_General_Disponibles" = $11,
                "Asientos_VIP_Disponibles" = $12,
                "Asientos_CONADIS_Disponibles" = $13, 
                "URL_Imagen" = $14,
                fecha_creacion_evento = $15,  
                "Estado" = 'pendiente'   
            WHERE "Id_Evento" = $16 AND "Id_Organizador" = $17 RETURNING *`;
        
        const updateValues = [
            Nom_Evento,                 // $1
            Fecha,                      // $2
            Horario_Inicio,             // $3
            Horario_Fin,                // $4
            Categoria,                  // $5
            Ubicacion,                  // $6
            Descripcion,                // $7
            parsedCostoGeneral,         // $8
            parsedCostoVIP,             // $9
            parseFloat(parsedCostoConadis.toFixed(2)), // $10
            parsedAsientosGeneral,      // $11
            parsedAsientosVIP,          // $12
            0,                          // $13 (Asientos_CONADIS_Disponibles - Fijo a 0 por ahora)
            URL_Imagen,                 // $14
            new Date(),                 // $15 (fecha_creacion_evento: Se actualiza a la fecha/hora actual de edición)
            id,                         // $16 (WHERE clause)
            Id_Organizador              // $17 (WHERE clause)
        ];

        console.log('[Route PUT /eventos/:id] Ejecutando UPDATE con query:', updateQuery); 
        console.log('[Route PUT /eventos/:id] UPDATE valores:', updateValues); 
        
        const result = await client.query(updateQuery, updateValues);

        console.log('[Route PUT /eventos/:id] UPDATE ejecutado exitosamente. Commiteando transacción...');
        await client.query('COMMIT');
        console.log('[Route PUT /eventos/:id] Transacción commiteada. Evento actualizado.');
        res.status(200).json({ message: 'Evento actualizado exitosamente y puesto en estado pendiente para revisión.', event: result.rows[0] });

    } catch (error) {
        if (client) {
            console.log('[Route PUT /eventos/:id] Error en la transacción, intentando ROLLBACK...');
            await client.query('ROLLBACK');
            console.log('[Route PUT /eventos/:id] ROLLBACK completado.');
        }
        console.error('Error al actualizar evento:', error.message); 
        console.error('Stack trace del error:', error.stack); 
        if (req.file && fs.existsSync(req.file.path)) {
            console.log('[Route PUT /eventos/:id] Eliminando archivo subido en caso de error:', req.file.path);
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ message: 'Error interno del servidor al actualizar el evento.' });
    } finally {
        if (client) client.release();
        console.log('[Route PUT /eventos/:id] Cliente de DB liberado.');
    }
});

/**
 * @route DELETE /api/proveedor/eventos/:id
 * @description Elimina un evento del organizador autenticado.
 * RUTA RENOMBRADA DE /eventos/eliminar/:id a /eventos/:id para estandarizar.
 * @access Privado (Organizador)
 */
router.delete('/eventos/:id', authenticateToken, authorizeRole(['organizador']), async (req, res) => {
    const { id } = req.params;
    const Id_Usuario_Organizador = req.user.id; // Ya está definido aquí
    console.log('[Route DELETE /eventos/:id] Solicitud recibida para evento ID:', id, 'usuario:', Id_Usuario_Organizador);

    let client;
    try {
        console.log('[Route DELETE /eventos/:id] Intentando conectar a la base de datos...');
        client = await pool.connect();
        console.log('[Route DELETE /eventos/:id] Conexión a DB exitosa. Iniciando transacción...');
        await client.query('BEGIN');

        // *** FIX: Obtener Id_Organizador aquí ***
        const orgResult = await client.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            await client.query('ROLLBACK');
            console.log('[Route DELETE /eventos/:id] Organizador no encontrado.');
            return res.status(404).json({ message: 'Organizador no encontrado para el usuario autenticado.' });
        }
        const Id_Organizador = orgResult.rows[0].Id_Organizador; // Id_Organizador ahora está definido
        console.log('[Route DELETE /eventos/:id] Id_Organizador encontrado:', Id_Organizador);
        // *** FIN FIX ***

        console.log('[Route DELETE /eventos/:id] Buscando imagen del evento para eliminar...');
        // Usar Id_Organizador que ya está definido
        const eventImageResult = await client.query('SELECT "URL_Imagen" FROM "Eventos" WHERE "Id_Evento" = $1 AND "Id_Organizador" = $2', [id, Id_Organizador]);
        if (eventImageResult.rows.length === 0) {
            await client.query('ROLLBACK');
            console.log('[Route DELETE /eventos/:id] Evento no encontrado o no pertenece al organizador.');
            return res.status(404).json({ message: 'Evento no encontrado o no pertenece a este organizador.' });
        }
        const imageUrlToDelete = eventImageResult.rows[0].URL_Imagen;
        console.log('[Route DELETE /eventos/:id] URL_Imagen a eliminar:', imageUrlToDelete);

        console.log('[Route DELETE /eventos/:id] Ejecutando DELETE del evento...');
        // Usar Id_Organizador que ya está definido
        const result = await client.query('DELETE FROM "Eventos" WHERE "Id_Evento" = $1 AND "Id_Organizador" = $2 RETURNING *', [id, Id_Organizador]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            console.log('[Route DELETE /eventos/:id] Evento no encontrado o no autorizado para eliminar (después del DELETE).');
            return res.status(404).json({ message: 'Evento no encontrado o no autorizado para eliminar.' });
        }

        if (imageUrlToDelete && imageUrlToDelete.includes('/img/event_images/')) {
            console.log('[Route DELETE /eventos/:id] Intentando eliminar archivo de imagen del sistema de archivos...');
            const imagePath = path.join(__dirname, '..', '..', 'Fronted', imageUrlToDelete);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
                console.log('[Route DELETE /eventos/:id] Imagen eliminada del sistema de archivos:', imagePath);
            } else {
                console.log('[Route DELETE /eventos/:id] Archivo de imagen no encontrado en la ruta esperada:', imagePath);
            }
        }

        console.log('[Route DELETE /eventos/:id] DELETE ejecutado exitosamente. Commiteando transacción...');
        await client.query('COMMIT');
        console.log('[Route DELETE /eventos/:id] Transacción commiteada. Evento eliminado.');
        res.status(200).json({ message: 'Evento eliminado exitosamente.', event: result.rows[0] });

    } catch (error) {
        if (client) {
            console.log('[Route DELETE /eventos/:id] Error en la transacción, intentando ROLLBACK...');
            await client.query('ROLLBACK');
            console.log('[Route DELETE /eventos/:id] ROLLBACK completado.');
        }
        console.error('Error al eliminar evento:', error.message);
        console.error('Stack trace del error:', error.stack);
        res.status(500).json({ message: 'Error interno del servidor al eliminar el evento.' });
    } finally {
        if (client) client.release();
        console.log('[Route DELETE /eventos/:id] Cliente de DB liberado.');
    }
});


/**
 * @route GET /api/proveedor/eventos/:id/stats
 * @description Obtiene estadísticas de venta para un evento específico.
 * Calcula tickets vendidos por tipo y ganancias estimadas.
 * @access Privado (Organizador)
 *
 * ASUNCIONES IMPORTANTES BASADAS EN TU ESQUEMA:
 * - Tabla "Categorías de entradas" tiene: "Id_Categoria", "Id_Evento", "Nom_Categoria" (e.g., 'General', 'VIP', 'Conadis'), "Precio".
 * - Tabla "Tickets" tiene: "Id_Ticket", "Id_Categoria", "Id_Compra".
 * - Cada registro en "Tickets" representa UN ticket vendido. No hay una columna "Cantidad" en "Tickets".
 * - La "Cantidad" de tickets se puede deducir de cuántos "Tickets" están asociados a una "Id_Categoria" y un "Id_Evento".
 * - Los precios para el cálculo de ganancias se obtienen de la tabla "Eventos" directamente ("PrecioGeneral", "PrecioVIP", "PrecioConadis").
 */
router.get('/eventos/:id/stats', authenticateToken, authorizeRole(['organizador']), async (req, res) => {
    const { id } = req.params; // Id_Evento
    const Id_Usuario_Organizador = req.user.id;
    console.log(`[Route GET /eventos/:id/stats] Solicitud de estadísticas para evento ID: ${id} por usuario: ${Id_Usuario_Organizador}`);

    let client;
    try {
        client = await pool.connect();
        
        // 1. Verificar que el evento existe y obtener sus detalles de precio
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

        // 2. Obtener el Id_Organizador del usuario autenticado
        const orgResult = await client.query('SELECT "Id_Organizador" FROM "Organizadores" WHERE "Id_Usuario" = $1', [Id_Usuario_Organizador]);
        if (orgResult.rows.length === 0) {
            return res.status(404).json({ message: 'Organizador no encontrado para el usuario autenticado.' });
        }
        const Id_Organizador_Auth = orgResult.rows[0].Id_Organizador;

        // 3. Asegurarse de que el evento realmente pertenezca a este organizador autenticado
        if (eventDetails.Id_Organizador !== Id_Organizador_Auth) {
            return res.status(403).json({ message: 'Acceso denegado. Este evento no pertenece a tu organización.' });
        }

        // 4. Consultar la tabla "Tickets" y "Categorías de entradas" para el conteo de tickets vendidos
        // Agrupamos por Nom_Categoria para obtener el conteo por tipo de ticket
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
            // Asegúrate que estos nombres ('General', 'VIP', 'Conadis') coincidan exactamente con los valores en tu columna "Nom_Categoria"
            if (row.Nom_Categoria === 'General') { 
                general_vendidos = cantidad;
                ganancias_estimadas += cantidad * parseFloat(eventDetails.PrecioGeneral);
            } else if (row.Nom_Categoria === 'VIP') {
                vip_vendidos = cantidad;
                ganancias_estimadas += cantidad * parseFloat(eventDetails.PrecioVIP || 0); // Usar 0 si PrecioVIP es NULL
            } else if (row.Nom_Categoria === 'Conadis') { 
                conadis_vendidos = cantidad;
                ganancias_estimadas += cantidad * parseFloat(eventDetails.PrecioConadis);
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
        console.error('Stack trace del error de estadísticas:', error.stack);
        res.status(500).json({ message: 'Error interno del servidor al obtener estadísticas del evento.' });
    } finally {
        if (client) client.release();
    }
});

module.exports = router;
