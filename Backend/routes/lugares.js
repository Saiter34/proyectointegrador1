// Backend/routes/lugares.js
const express = require('express');
const router = express.Router();
const pool = require('../db'); // Importa el pool de conexión a la base de datos
const multer = require('multer'); // Importa multer para manejar la subida de archivos
const path = require('path'); // Para manejar rutas de archivos
const fs = require('fs'); // Para manejar operaciones de sistema de archivos

// Directorio donde se guardarán las imágenes de los lugares
const placeImagesDir = path.join(__dirname, '..', '..', 'Fronted', 'img', 'place_images');

// Configuración de Multer para la subida de imágenes de lugares
const uploadMiddleware = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            // Asegúrate de que el directorio exista
            if (!fs.existsSync(placeImagesDir)) {
                fs.mkdirSync(placeImagesDir, { recursive: true });
            }
            cb(null, placeImagesDir);
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
        }
    })
}).fields([ // Usamos .fields() porque tendremos dos campos de archivo
    { name: 'imagen_referencial', maxCount: 1 },
    { name: 'imagen_asientos', maxCount: 1 }
]);

/**
 * @route GET /api/lugares
 * @description Obtiene todos los lugares disponibles con detalles de capacidad e imágenes.
 * @access Admin (o Admin/Organizador, según la configuración en index.js)
 */
router.get('/', async (req, res) => {
    try {
        const query = `
            SELECT 
                "Id_Lugar", 
                "Nom_Lugar", 
                "Capacidad", 
                "Capacidad_Total", 
                "Cantidad_General", 
                "Cantidad_VIP", 
                "Cantidad_Conadis", 
                "Categoria_Lugar", 
                "Ubicacion_Lugar", 
                "URL_Imagen_Referencial", 
                "URL_Imagen_Asientos"    
            FROM "Lugares"
            ORDER BY "Nom_Lugar" ASC;
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error al obtener lugares:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener lugares.' });
    }
});

/**
 * @route GET /api/lugares/:id
 * @description Obtiene un lugar por su ID.
 * @access Public (o protegido si lo necesitas)
 */
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT 
                "Id_Lugar", 
                "Nom_Lugar", 
                "Capacidad", 
                "Capacidad_Total", 
                "Cantidad_General", 
                "Cantidad_VIP", 
                "Cantidad_Conadis", 
                "Categoria_Lugar", 
                "Ubicacion_Lugar", 
                "URL_Imagen_Referencial", 
                "URL_Imagen_Asientos"
            FROM "Lugares"
            WHERE "Id_Lugar" = $1;
        `;
        const result = await pool.query(query, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Lugar no encontrado.' });
        }
        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Error al obtener lugar por ID:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener lugar.' });
    }
});


/**
 * @route POST /api/lugares
 * @description Agrega un nuevo lugar con detalles de capacidad e imágenes subidas.
 * @access Admin
 */
router.post('/', uploadMiddleware, async (req, res) => {
    const { 
        nombre, 
        capacidad, 
        capacidad_total, 
        cantidad_general, 
        cantidad_vip, 
        cantidad_conadis, 
        categoria, 
        ubicacion     
    } = req.body;

    // Obtener las rutas de las imágenes subidas por Multer
    const imagen_referencial_path = req.files && req.files['imagen_referencial'] ? `/img/place_images/${req.files['imagen_referencial'][0].filename}` : null;
    const imagen_asientos_path = req.files && req.files['imagen_asientos'] ? `/img/place_images/${req.files['imagen_asientos'][0].filename}` : null;

    // Validar que las imágenes requeridas estén presentes
    if (!imagen_referencial_path || !imagen_asientos_path) {
        // Si falta alguna imagen, eliminar las que se hayan subido para evitar basura
        if (req.files && req.files['imagen_referencial'] && fs.existsSync(req.files['imagen_referencial'][0].path)) {
            fs.unlinkSync(req.files['imagen_referencial'][0].path);
        }
        if (req.files && req.files['imagen_asientos'] && fs.existsSync(req.files['imagen_asientos'][0].path)) {
            fs.unlinkSync(req.files['imagen_asientos'][0].path);
        }
        return res.status(400).json({ message: 'Debes subir una imagen referencial y una imagen de asientos.' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN'); // Iniciar transacción

        const query = `
            INSERT INTO "Lugares" (
                "Nom_Lugar", 
                "Capacidad", 
                "Capacidad_Total", 
                "Cantidad_General", 
                "Cantidad_VIP", 
                "Cantidad_Conadis", 
                "Categoria_Lugar", 
                "Ubicacion_Lugar", 
                "URL_Imagen_Referencial", 
                "URL_Imagen_Asientos"
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *;
        `;
        const result = await client.query(query, [
            nombre, 
            capacidad ? parseInt(capacidad) : null, // Convertir a número o null
            parseInt(capacidad_total), 
            parseInt(cantidad_general), 
            parseInt(cantidad_vip), 
            parseInt(cantidad_conadis), 
            categoria, 
            ubicacion, 
            imagen_referencial_path, 
            imagen_asientos_path
        ]);

        await client.query('COMMIT'); // Confirmar transacción
        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (client) await client.query('ROLLBACK'); // Revertir transacción en caso de error
        console.error('Error al agregar lugar:', error.message);
        // Si hay un error, eliminar los archivos subidos para evitar basura
        if (imagen_referencial_path && fs.existsSync(path.join(__dirname, '..', '..', 'Fronted', imagen_referencial_path))) {
            fs.unlinkSync(path.join(__dirname, '..', '..', 'Fronted', imagen_referencial_path));
        }
        if (imagen_asientos_path && fs.existsSync(path.join(__dirname, '..', '..', 'Fronted', imagen_asientos_path))) {
            fs.unlinkSync(path.join(__dirname, '..', '..', 'Fronted', imagen_asientos_path));
        }
        res.status(500).json({ message: 'Error interno del servidor al agregar lugar.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route DELETE /api/lugares/:id
 * @description Elimina un lugar por su ID y sus imágenes asociadas.
 * @access Admin
 */
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN'); // Iniciar transacción

        // Obtener las URLs de las imágenes antes de eliminar el registro
        const imagePathsResult = await client.query(
            'SELECT "URL_Imagen_Referencial", "URL_Imagen_Asientos" FROM "Lugares" WHERE "Id_Lugar" = $1',
            [id]
        );

        const result = await client.query('DELETE FROM "Lugares" WHERE "Id_Lugar" = $1 RETURNING *;', [id]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Lugar no encontrado.' });
        }

        // Eliminar los archivos de imagen del sistema de archivos
        if (imagePathsResult.rows.length > 0) {
            const { URL_Imagen_Referencial, URL_Imagen_Asientos } = imagePathsResult.rows[0];
            
            if (URL_Imagen_Referencial && URL_Imagen_Referencial.includes('/img/place_images/')) {
                const imagePath = path.join(__dirname, '..', '..', 'Fronted', URL_Imagen_Referencial);
                if (fs.existsSync(imagePath)) {
                    fs.unlinkSync(imagePath);
                }
            }
            if (URL_Imagen_Asientos && URL_Imagen_Asientos.includes('/img/place_images/')) {
                const imagePath = path.join(__dirname, '..', '..', 'Fronted', URL_Imagen_Asientos);
                if (fs.existsSync(imagePath)) {
                    fs.unlinkSync(imagePath);
                }
            }
        }

        await client.query('COMMIT'); // Confirmar transacción
        res.status(200).json({ message: 'Lugar eliminado correctamente.', deletedLugar: result.rows[0] });
    } catch (error) {
        if (client) await client.query('ROLLBACK'); // Revertir transacción en caso de error
        console.error('Error al eliminar lugar:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al eliminar lugar.' });
    } finally {
        if (client) client.release();
    }
});

module.exports = router;
