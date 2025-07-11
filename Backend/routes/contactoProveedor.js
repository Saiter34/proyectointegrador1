// Backend/routes/contactoProveedor.js
const express = require('express');
const router = express.Router();
const pool = require('../db'); // Importa el pool de conexión a la base de datos
const multer = require('multer'); // Importa multer para manejar la subida de archivos
const path = require('path'); // Para manejar rutas de archivos
const fs = require('fs'); // Para manejar operaciones de sistema de archivos
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware'); 

// Directorio donde se guardarán los archivos adjuntos de los mensajes de contacto
const attachmentsDir = path.join(__dirname, '..', '..', 'Fronted', 'attachments', 'contacto');

// Configuración de Multer para la subida de archivos adjuntos
const uploadMiddleware = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            // Asegúrate de que el directorio exista
            if (!fs.existsSync(attachmentsDir)) {
                fs.mkdirSync(attachmentsDir, { recursive: true });
            }
            cb(null, attachmentsDir);
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // Límite de 5MB por archivo
    fileFilter: (req, file, cb) => {
        // Permitir solo imágenes y PDFs
        if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Tipo de archivo no permitido. Solo se aceptan imágenes y PDFs.'), false);
        }
    }
}).single('archivo'); // Asume un solo campo de archivo llamado 'archivo'

/**
 * @route POST /api/contactoProveedor
 * @description Permite a un proveedor enviar un mensaje de contacto a la empresa.
 * @access Privado (Organizador - requiere autenticación)
 */
router.post('/', authenticateToken, authorizeRole(['organizador']), uploadMiddleware, async (req, res) => {
    const Id_Usuario_Organizador = req.user.id; 
    const { problema, asunto } = req.body;
    const archivoPath = req.file ? `/attachments/contacto/${req.file.filename}` : null;

    if (!problema || !asunto) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({ message: 'Por favor, selecciona un tipo de problema y describe tu asunto.' });
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

        const insertQuery = `
            INSERT INTO "ContactoProveedor" (
                "Id_Organizador", 
                "Tipo_Problema", 
                "Descripcion", 
                "URL_Archivo_Adjunto", 
                "Fecha_Envio", 
                "Estado"
            )
            VALUES ($1, $2, $3, $4, NOW(), 'pendiente')
            RETURNING *;
        `;
        const result = await client.query(insertQuery, [
            Id_Organizador,
            problema,
            asunto,
            archivoPath
        ]);

        await client.query('COMMIT');
        res.status(201).json({ message: 'Mensaje de contacto enviado exitosamente. Nos pondremos en contacto contigo pronto.', mensajeContacto: result.rows[0] });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Error al enviar mensaje de contacto:', error.message);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Error al eliminar archivo subido tras un error:', err);
            });
        }
        res.status(500).json({ message: 'Error interno del servidor al enviar el mensaje de contacto.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route GET /api/contactoProveedor
 * @description Obtiene todos los mensajes de contacto para el administrador.
 * @access Privado (Admin - requiere autenticación)
 */
router.get('/', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const query = `
            SELECT 
                cp."Id_Contacto",
                cp."Tipo_Problema",
                cp."Descripcion",
                cp."URL_Archivo_Adjunto",
                cp."Fecha_Envio",
                cp."Estado",
                o."Nom_Empresa" AS "Nombre_Empresa_Organizador",
                u."Correo_Usuario" AS "Email_Organizador"  -- ¡CORRECCIÓN FINAL AQUÍ!
            FROM "ContactoProveedor" cp
            JOIN "Organizadores" o ON cp."Id_Organizador" = o."Id_Organizador"
            JOIN "Usuarios" u ON o."Id_Usuario" = u.id  -- ¡ID DE USUARIOS ES 'id'!
            ORDER BY cp."Fecha_Envio" DESC;
        `;
        const result = await client.query(query);
        res.status(200).json({ message: 'Mensajes de contacto obtenidos exitosamente.', mensajesContacto: result.rows });
    } catch (error) {
        console.error('Error al obtener mensajes de contacto para el administrador:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener mensajes de contacto.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * @route PUT /api/contactoProveedor/:id/estado
 * @description Actualiza el estado de un mensaje de contacto (ej. a 'leido' o 'resuelto').
 * @access Privado (Admin - requiere autenticación)
 */
router.put('/:id/estado', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;

    if (!estado || !['leido', 'resuelto'].includes(estado)) {
        return res.status(400).json({ message: 'Estado inválido proporcionado. Debe ser "leido" o "resuelto".' });
    }

    let client;
    try {
        client = await pool.connect();
        const updateQuery = `
            UPDATE "ContactoProveedor"
            SET "Estado" = $1
            WHERE "Id_Contacto" = $2
            RETURNING *;
        `;
        const result = await client.query(updateQuery, [estado, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Mensaje de contacto no encontrado.' });
        }

        res.status(200).json({ message: `Estado del mensaje de contacto ${id} actualizado a '${estado}'.`, mensajeContacto: result.rows[0] });
    } catch (error) {
        console.error('Error al actualizar estado del mensaje de contacto:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al actualizar el estado del mensaje de contacto.' });
    } finally {
        if (client) client.release();
    }
});

module.exports = router;