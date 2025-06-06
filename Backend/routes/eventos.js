const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/eventos
router.get('/', async (req, res) => {
    try {
    const result = await db.query('SELECT * FROM "Eventos" WHERE "Estado" = \'Activo\'');
    res.json(result.rows);
    } catch (error) {
    console.error('Error al obtener eventos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;
