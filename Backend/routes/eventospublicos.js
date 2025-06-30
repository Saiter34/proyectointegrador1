// Backend/routes/eventospublicos.js
// Este archivo manejará las rutas para obtener eventos públicos, accesibles sin autenticación.

const express = require('express');
const router = express.Router();
const pool = require('../db'); // Importa el pool de conexión a la base de datos

/**
 * @route GET /destacados
 * @description Obtiene todos los eventos aprobados que están marcados como destacados para el carrusel y la sección de destacados.
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
                e."Ubicacion",
                e."Descripcion",
                e."PrecioGeneral",
                e."PrecioVIP",
                e."PrecioConadis",
                e."Estado",
                e."URL_Imagen",
                e."URL_Mapa",
                e."Reglas",
                e."SolicitudDestacar",
                o."Nom_Empresa" AS "NombreEmpresaOrganizador"
            FROM "Eventos" e
            JOIN "Organizadores" o ON e."Id_Organizador" = o."Id_Organizador"
            WHERE e."Estado" = 'aprobado' AND e."SolicitudDestacar" = 'aprobado'
            ORDER BY e."Fecha" ASC, e."Horario_Inicio" ASC;
        `;
        const result = await pool.query(query);

        const eventsWithParsedData = result.rows.map(event => ({
            ...event,
            Reglas: event.Reglas || [] // Si es JSONB, node-pg ya lo parsea, solo aseguramos que sea array
        }));

        res.status(200).json({ events: eventsWithParsedData }); // Envía los eventos dentro de un objeto con la clave 'events'
    } catch (error) {
        console.error('Error al obtener eventos destacados para el cliente:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener eventos destacados.' });
    }
});

/**
 * @route GET /aprobados-para-cliente
 * @description Obtiene todos los eventos cuyo estado es 'aprobado'.
 * Esta ruta es específica para ser consumida por las páginas del cliente (principal.html, cliente.html).
 * NO REQUIERE AUTENTICACIÓN.
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
                e."Ubicacion",
                e."Descripcion",
                e."PrecioGeneral",
                e."PrecioVIP",
                e."PrecioConadis",
                e."Estado",
                e."URL_Imagen",
                e."URL_Mapa",
                e."Reglas",
                e."SolicitudDestacar",
                o."Nom_Empresa" AS "NombreEmpresaOrganizador"
            FROM "Eventos" e
            JOIN "Organizadores" o ON e."Id_Organizador" = o."Id_Organizador"
            WHERE e."Estado" = 'aprobado'
            ORDER BY e."Fecha" ASC, e."Horario_Inicio" ASC;
        `;
        const result = await pool.query(query);

        const eventsWithParsedData = result.rows.map(event => ({
            ...event,
            Reglas: event.Reglas || [] // Si es JSONB, node-pg ya lo parsea, solo aseguramos que sea array
        }));

        res.status(200).json({ events: eventsWithParsedData }); // Envía los eventos dentro de un objeto con la clave 'events'
    } catch (error) {
        console.error('Error al obtener eventos aprobados para el cliente:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener eventos aprobados.' });
    }
});

/**
 * @route GET /:id
 * @description Obtiene los detalles completos de un evento específico por su ID.
 * Esta ruta es consumida por detalles.html para mostrar la información detallada de un evento.
 * NO REQUIERE AUTENTICACIÓN.
 * @access Público
 */
router.get('/:id', async (req, res) => {
    const { id } = req.params; // Captura el ID del evento de la URL

    try {
        const query = `
            SELECT
                "Id_Evento",
                "Nom_Evento",
                "Fecha",
                "Horario_Inicio",
                "Horario_Fin",
                "Categoria",
                "Ubicacion",
                "Descripcion",
                "PrecioGeneral",
                "PrecioVIP",
                "PrecioConadis",
                "URL_Imagen",
                "URL_Mapa",
                "Reglas"
            FROM "Eventos"
            WHERE "Id_Evento" = $1 AND "Estado" = 'aprobado';
        `;
        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Evento no encontrado o no está aprobado.' });
        }

        const event = result.rows[0];

        // --- TRANSFORMAR DATOS PARA EL FRONTEND (detalles.html) ---
        // Construir el array de precios como lo espera el frontend.
        const precios = [];
        // Solo agregar si el precio existe y es un número válido
        if (event.PrecioVIP !== null && !isNaN(parseFloat(event.PrecioVIP))) {
            const precioVipRegular = parseFloat(event.PrecioVIP);
            precios.push({
                zona: "VIP",
                regular: precioVipRegular.toFixed(2),
                conadis: (precioVipRegular * 0.5).toFixed(2), // 50% de descuento para CONADIS
                preventa: (precioVipRegular * 0.8).toFixed(2) // 20% de descuento por preventa
            });
        }
        if (event.PrecioGeneral !== null && !isNaN(parseFloat(event.PrecioGeneral))) {
            const precioGeneralRegular = parseFloat(event.PrecioGeneral);
            precios.push({
                zona: "General",
                regular: precioGeneralRegular.toFixed(2),
                conadis: (precioGeneralRegular * 0.5).toFixed(2),
                preventa: (precioGeneralRegular * 0.8).toFixed(2)
            });
        }
        // Si hay otras zonas de precios, se añadirían aquí

        // Obtener URL_Mapa directamente de la base de datos o usar un fallback
        const URL_Mapa = event.URL_Mapa || '/img/default_map.jpg';

        // Obtener Reglas directamente de la base de datos (ya es un array si es JSONB) o usar un fallback
        const reglas = event.Reglas || []; // Asegúrate de que siempre sea un array.

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
            URL_Imagen: event.URL_Imagen,
            URL_Mapa: URL_Mapa, // Usar el valor de la BD o el fallback
            Precios: precios,
            Reglas: reglas // Usar el valor de la BD o el fallback
        };

        res.status(200).json(responseEvent);

    } catch (error) {
        console.error('Error al obtener detalles del evento (ruta pública GET /:id):', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener el evento.' });
    }
});


module.exports = router;
