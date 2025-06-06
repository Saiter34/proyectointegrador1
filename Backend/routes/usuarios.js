const express = require('express');
const router = express.Router();
const pool = require('../db');

// Ruta para registrar un nuevo usuario
router.post('/registro', async (req, res) => {
    try {
    const {
        Nom_Usuario,
        Ape_Usuario,
        Correo_Usuario,
        Contra_Usuario,
        Tlf_Usuario
    } = req.body;

    const result = await pool.query(
        `INSERT INTO "Usuarios" (
            "Nom_Usuario",
            "Ape_Usuario",
            "Correo_Usuario",
            "Contra_Usuario",
            "Tlf_Usuario",
            "Fecha_Reg",
            "ES_Organizador",
            "Autenticacion_2fa"
        ) VALUES ($1, $2, $3, $4, $5, NOW(), false, false)
        RETURNING *`,
        [Nom_Usuario, Ape_Usuario, Correo_Usuario, Contra_Usuario, Tlf_Usuario]
        );

    res.status(201).json({ mensaje: 'Usuario registrado exitosamente', usuario: result.rows[0] });
    } catch (error) {
    console.error('Error al registrar usuario:', error);
    res.status(500).json({ mensaje: 'Error en el servidor' });
    }
});

module.exports = router;
