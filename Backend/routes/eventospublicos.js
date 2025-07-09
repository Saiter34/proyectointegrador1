// Backend/routes/eventospublicos.js
// Este archivo manejará las rutas para obtener eventos públicos, accesibles sin autenticación.

const express = require('express');
const router = express.Router();
const pool = require('../db'); // Importa el pool de conexión a la base de datos

/**
 * @route GET /categorias
 * @description Obtiene una lista de todas las categorías únicas de eventos aprobados.
 * Es crucial que esta ruta vaya ANTES de /:id para evitar conflictos.
 * @access Público
 */
router.get('/categorias', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT "Categoria" FROM "Eventos" WHERE "Estado" = 'aprobado' AND "Categoria" IS NOT NULL ORDER BY "Categoria" ASC;`
        );
        const categories = result.rows.map(row => row.Categoria);
        res.status(200).json({ categories: categories });
    } catch (error) {
        console.error('Error al obtener categorías de eventos (público):', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener categorías.' });
    }
});

/**
 * @route GET /por-categoria/:categoryName
 * @description Obtiene todos los eventos aprobados de una categoría específica con su información de lugar.
 * Es crucial que esta ruta vaya ANTES de /:id para evitar conflictos.
 * @access Público
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
                e."Descripcion",
                e."PrecioGeneral",
                e."PrecioVIP",
                e."PrecioConadis",
                e."Estado",
                e."URL_Imagen_Evento", 
                e."URL_Mapa",
                e."Reglas",
                l."Nom_Lugar", 
                l."Ubicacion_Lugar" AS "Ubicacion" 
            FROM "Eventos" e
            LEFT JOIN "Lugares" l ON e."Id_Lugar" = l."Id_Lugar"
            WHERE e."Estado" = 'aprobado' AND e."Categoria" ILIKE $1 -- ILIKE para búsqueda insensible a mayúsculas/minúsculas
            ORDER BY e."Fecha" ASC, e."Horario_Inicio" ASC;
        `;
        const result = await pool.query(query, [categoryName]);

        const eventsWithFullDetails = await Promise.all(result.rows.map(async (event) => {
            const categoriasDeEntradasResult = await pool.query(
                `SELECT 
                    "Id_Categoria" AS id_categoria,
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
                id_categoria: cat.id_categoria,
                Nom_Categoria: cat.Nom_Categoria,
                precioRegular: parseFloat(cat.precioRegular || 0),
                precioPreventa: parseFloat(cat.precioPreventa || 0),
                precioConadis: parseFloat(cat.precioConadis || 0),
                stockDisponible: parseInt(cat.stockDisponible || 0)
            }));

            return {
                ...event,
                Reglas: event.Reglas || [],
                CategoriasDeEntradas: categoriasDeEntradas
            };
        }));

        res.status(200).json({ events: eventsWithFullDetails });
    } catch (error) {
        console.error(`Error al obtener eventos para la categoría ${categoryName} (público):`, error.message);
        res.status(500).json({ message: `Error interno del servidor al obtener eventos para la categoría ${categoryName}.` });
    }
});

/**
 * @route GET /aprobados-para-cliente
 * @description Obtiene todos los eventos aprobados para mostrar en la interfaz del cliente.
 * Incluye información del lugar para la ubicación y categorías de entradas.
 * Esta ruta puede ir en cualquier orden respecto a las otras rutas públicas,
 * ya que no tiene parámetros de ruta que puedan confundirse.
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
                e."URL_Imagen_Evento", 
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

        // Para cada evento, obtener sus categorías de entradas y stock
        const eventsWithFullDetails = await Promise.all(result.rows.map(async (event) => {
            const categoriasDeEntradasResult = await pool.query(
                `SELECT 
                    "Id_Categoria" AS id_categoria,
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
                id_categoria: cat.id_categoria,
                Nom_Categoria: cat.Nom_Categoria,
                precioRegular: parseFloat(cat.precioRegular || 0),
                precioPreventa: parseFloat(cat.precioPreventa || 0),
                precioConadis: parseFloat(cat.precioConadis || 0),
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
        console.error('Error al obtener eventos aprobados para el cliente:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener eventos aprobados para el cliente.' });
    }
});

/**
 * @route GET /destacados
 * @description Obtiene eventos aprobados que han sido marcados como 'destacado' para el carrusel principal.
 * Esta ruta puede ir en cualquier orden respecto a las otras rutas públicas,
 * ya que no tiene parámetros de ruta que puedan confundirse.
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
                l."Ubicacion_Lugar" AS "Ubicacion", -- Obtener Ubicacion desde Lugares
                e."Descripcion",
                e."PrecioGeneral",
                e."PrecioVIP",
                e."PrecioConadis",
                e."Estado",
                e."URL_Imagen_Evento", 
                l."URL_Imagen_Asientos", -- AHORA SELECCIONAMOS LA IMAGEN DE ASIENTOS DEL LUGAR
                e."Reglas",
                e."SolicitudDestacar",
                o."Nom_Empresa" AS "NombreEmpresaOrganizador"
            FROM "Eventos" e
            LEFT JOIN "Lugares" l ON e."Id_Lugar" = l."Id_Lugar" -- Unir con la tabla Lugares
            JOIN "Organizadores" o ON e."Id_Organizador" = o."Id_Organizador"
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
        console.error('Error al obtener eventos destacados públicos:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener eventos destacados.' });
    }
});

/**
 * @route GET /:id
 * @description Obtiene los detalles completos de un evento específico por su ID, incluyendo sus categorías de entradas y stock.
 * Esta ruta es consumida por detalles.html y pago1.html.
 * DEBE IR AL FINAL de las rutas públicas con parámetros que puedan ser confundidos con un ID.
 * NO REQUIERE AUTENTICACIÓN.
 * @access Público
 */
router.get('/:id', async (req, res) => {
    const { id } = req.params; // Captura el ID del evento de la URL
    let client;

    try {
        client = await pool.connect();

        // 1. Obtener detalles del evento principal
        const eventResult = await client.query(
            `SELECT 
                e."Id_Evento", 
                e."Nom_Evento", 
                e."Descripcion", 
                e."Fecha", 
                e."Horario_Inicio", 
                e."Horario_Fin",
                e."Categoria",
                l."Ubicacion_Lugar" AS "Ubicacion", 
                e."URL_Imagen_Evento", 
                l."URL_Imagen_Asientos", -- IMAGEN DE ASIENTOS DEL LUGAR
                e."Reglas"
            FROM "Eventos" e
            LEFT JOIN "Lugares" l ON e."Id_Lugar" = l."Id_Lugar" 
            WHERE e."Id_Evento" = $1 AND e."Estado" = 'aprobado';`,
            [id]
        );

        const event = eventResult.rows[0];

        if (!event) {
            return res.status(404).json({ message: 'Evento no encontrado o no está aprobado.' });
        }

        // 2. Obtener las categorías de entradas y su stock desde la tabla "Categorías de entradas"
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
             ORDER BY "Nom_Categoria" ASC;`, // Ordenar para una visualización consistente
            [id]
        );

        // Mapear los nombres de columnas para que coincidan con el frontend
        const categoriasDeEntradas = categoriasDeEntradasResult.rows.map(cat => ({
            id_categoria: cat.Id_Categoria,
            Nom_Categoria: cat.Nom_Categoria,
            precioRegular: parseFloat(cat.precioRegular || 0).toFixed(2),
            precioPreventa: parseFloat(cat.precioPreventa || 0).toFixed(2),
            precioConadis: parseFloat(cat.precioConadis || 0).toFixed(2),
            stockDisponible: parseInt(cat.stockDisponible || 0) // Asegurarse de que sea un entero
        }));

        // Asegúrate de que Reglas sea un array, si se almacena como JSON string en la DB, parsearlo
        const parsedReglas = (typeof event.Reglas === 'string' && event.Reglas.startsWith('[')) ? JSON.parse(event.Reglas) : (event.Reglas || []);

        // Construir el objeto de respuesta final con el formato esperado por el frontend
        const responseEvent = {
            Id_Evento: event.Id_Evento,
            Nom_Evento: event.Nom_Evento,
            Fecha: event.Fecha,
            Horario_Inicio: event.Horario_Inicio,
            Horario_Fin: event.Horario_Fin,
            Categoria: event.Categoria,
            Ubicacion: event.Ubicacion,
            Descripcion: event.Descripcion,
            URL_Imagen_Evento: event.URL_Imagen_Evento, 
            URL_Imagen_Asientos: event.URL_Imagen_Asientos, 
            Reglas: parsedReglas,
            CategoriasDeEntradas: categoriasDeEntradas // ¡AHORA SE OBTIENE DE LA TABLA DE CATEGORÍAS DE ENTRADAS!
        };

        res.status(200).json(responseEvent);

    } catch (error) {
        console.error('Error al obtener detalles del evento (ruta pública GET /:id):', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener el evento.' });
    } finally {
        if (client) {
            client.release();
        }
    }
});


module.exports = router;
