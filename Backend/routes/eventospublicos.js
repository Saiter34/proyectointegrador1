// Backend/routes/eventospublicos.js
// Este archivo manejará las rutas para obtener eventos públicos, accesibles sin autenticación.

const express = require('express');
const router = express.Router();
const pool = require('../db'); // Importa el pool de conexión a la base de datos

/**
 * @route GET /eventospublicos/destacados
 * @description Obtiene un número limitado de eventos 'aprobados' ordenados por fecha para el carrusel.
 * @access Público
 */
router.get('/destacados', async (req, res) => {
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
                "URL_Imagen"
            FROM "Eventos"
            WHERE "Estado" = 'aprobado'
            ORDER BY "Fecha" ASC
            LIMIT 5; -- Limita el número de eventos destacados para el carrusel
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error al obtener eventos destacados públicos:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener eventos destacados.' });
    }
});

/**
 * @route GET /eventospublicos/aprobados-para-cliente
 * @description Obtiene todos los eventos cuyo estado es 'aprobado'.
 * Esta ruta es específica para ser consumida por las páginas del cliente (principal.html, cliente.html).
 * NO REQUIERE AUTENTICACIÓN.
 * @access Público
 */
router.get('/aprobados-para-cliente', async (req, res) => {
    try {
        const query = `
            SELECT
                "Id_Evento",
                "Nom_Evento",
                "Fecha",
                "Ubicacion",
                "URL_Imagen"
            FROM "Eventos"
            WHERE "Estado" = 'aprobado'
            ORDER BY "Fecha" ASC, "Horario_Inicio" ASC;
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error al obtener eventos aprobados para cliente (ruta pública):', error.message);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

/**
 * @route GET /eventospublicos/:id
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
                "URL_Imagen"
                -- Si tuvieras columnas para URL_Mapa o Reglas en tu tabla "Eventos",
                -- las seleccionarías aquí. Por ejemplo:
                -- , "URL_Mapa", "Reglas"
            FROM "Eventos"
            WHERE "Id_Evento" = $1 AND "Estado" = 'aprobado'; -- Solo eventos aprobados
        `;
        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Evento no encontrado o no está aprobado.' });
        }

        const event = result.rows[0];

        // --- TRANSFORMAR DATOS PARA EL FRONTEND (detalles.html) ---
        // Construir el array de precios como lo espera el frontend.
        // Asume que los precios CONADIS y Preventa se calculan como un porcentaje de Regular si no están explícitamente en la BD.
        const precios = [];
        if (event.PrecioVIP !== null) {
            const precioVipRegular = parseFloat(event.PrecioVIP);
            precios.push({
                zona: "VIP",
                regular: precioVipRegular.toFixed(2),
                conadis: (precioVipRegular * 0.5).toFixed(2), // 50% de descuento para CONADIS
                preventa: (precioVipRegular * 0.8).toFixed(2) // 20% de descuento por preventa
            });
        }
        if (event.PrecioGeneral !== null) {
            const precioGeneralRegular = parseFloat(event.PrecioGeneral);
            precios.push({
                zona: "General",
                regular: precioGeneralRegular.toFixed(2),
                conadis: (precioGeneralRegular * 0.5).toFixed(2),
                preventa: (precioGeneralRegular * 0.8).toFixed(2)
            });
        }
        if (event.PrecioConadis !== null && event.PrecioConadis !== 0 && !precios.some(p => p.zona === "Conadis")) {
            // Si hay una columna PrecioConadis pero no se mapea a una zona específica
            // y no se ha cubierto ya con VIP/General. Esto puede requerir un ajuste
            // si Conadis es una zona independiente o un descuento sobre otras zonas.
            // Para este ejemplo, lo dejaremos como un descuento sobre Regular.
        }


        // Simular URL_Mapa ya que no está en tu esquema de la tabla Eventos.
        // **ACTUALIZAR:** Si tienes una columna "URL_Mapa" en tu BD, usa `event.URL_Mapa` aquí.
        // Ejemplo: const URL_Mapa = event.URL_Mapa ? event.URL_Mapa : '/img/default_map.jpg';
        const URL_Mapa_Simulada = '/img/default_map.jpg'; // Asegúrate de tener esta imagen en Fronted/img/

        // Simular reglas ya que no están en tu esquema de la tabla Eventos.
        // **ACTUALIZAR:** Si tienes una columna "Reglas" (ej. TEXT o JSONB) en tu BD, úsala.
        // Si es TEXT, haz `event.Reglas.split('\n')`. Si es JSONB, haz `JSON.parse(event.Reglas)`.
        const reglas_simuladas = [
            "Prohibido el ingreso con objetos punzocortantes.",
            "Menores de 18 años deben estar acompañados por un adulto y presentar identificación.",
            "No se permite el ingreso con alimentos ni bebidas externas.",
            "Respetar las indicaciones del personal de seguridad en todo momento.",
            "El incumplimiento de las reglas puede resultar en la expulsión sin reembolso.",
            "Las entradas no son reembolsables ni transferibles."
        ];

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
            URL_Mapa: URL_Mapa_Simulada, // Usar la simulada o la real de la BD
            Precios: precios, // El array de precios que construimos
            Reglas: reglas_simuladas // El array de reglas (simulado o de la BD)
        };

        res.status(200).json(responseEvent);

    } catch (error) {
        console.error('Error al obtener detalles del evento (ruta pública GET /:id):', error.message);
        res.status(500).json({ message: 'Error interno del servidor al obtener el evento.' });
    }
});


module.exports = router;
