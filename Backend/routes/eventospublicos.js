// Backend/routes/public_events.js
// Este archivo manejará las rutas para obtener eventos públicos, accesibles sin autenticación.

const express = require('express');
const router = express.Router();
const pool = require('../db'); // Importa el pool de conexión a la base de datos

/**
 * @route GET /api/eventos/aprobados-para-cliente
 * @description Obtiene todos los eventos cuyo estado es 'aprobado'.
 * Esta ruta es específica para ser consumida por las páginas del cliente (principal.html, cliente.html).
 * NO REQUIERE AUTENTICACIÓN.
 * @access Público
 */
router.get('/aprobados-para-cliente', async (req, res) => {
    try {
        const query = `
            SELECT 
                E."Id_Evento", 
                E."Nom_Evento", 
                E."Fecha", 
                E."Horario_Inicio", 
                E."Horario_Fin", 
                E."Ubicacion", 
                E."Descripcion", 
                E."PrecioGeneral", 
                E."PrecioVIP", 
                E."PrecioConadis", 
                E."Estado", 
                E."URL_Imagen", 
                U."Nom_Usuario" AS "NombreProveedor",
                U."Ape_Usuario" AS "ApellidoProveedor"
            FROM "Eventos" E
            JOIN "Organizadores" O ON E."Id_Organizador" = O."Id_Organizador"
            JOIN "Usuarios" U ON O."Id_Usuario" = U.id
            WHERE E."Estado" = 'aprobado' 
            ORDER BY E."Fecha" ASC, E."Horario_Inicio" ASC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener eventos aprobados para cliente (ruta pública):', error.message);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

module.exports = router;
