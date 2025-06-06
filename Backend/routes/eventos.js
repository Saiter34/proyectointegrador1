const express = require('express');
const router = express.Router();
const { pool } = require('../db');

router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM "Eventos" WHERE "Estado" = \'Activo\'');
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener eventos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;