// Backend/routes/compras.js
// Este archivo maneja la lógica para procesar compras y crear tickets.

const express = require('express');
const router = express.Router();
const pool = require('../db'); // Importa tu conexión a la base de datos
const { authenticateToken } = require('../middleware/authMiddleware'); // Para proteger la ruta

/**
 * @route POST /api/compras
 * @description Procesa una nueva compra, crea registros en Compras y Tickets, y actualiza el stock.
 * @access Protegido (Usuario autenticado)
 */
router.post('/', authenticateToken, async (req, res) => {
    const { eventId, tickets, total, paymentMethod, appliedPromotions, pointsUsed } = req.body;
    const userId = req.user.id; // ID del usuario autenticado desde el token

    if (!eventId || !tickets || tickets.length === 0 || total === undefined || !paymentMethod) {
        return res.status(400).json({ message: 'Datos de compra incompletos.' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN'); // Iniciar transacción

        // 1. Verificar stock disponible para cada ticket
        for (const ticket of tickets) {
            const { id_categoria, cantidad } = ticket;
            const stockCheck = await client.query(
                `SELECT "Stock_Disponible" FROM "Categorías de entradas" WHERE "Id_Categoria" = $1 AND "Id_Evento" = $2 FOR UPDATE`,
                [id_categoria, eventId]
            );

            if (stockCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: `Categoría de entrada con ID ${id_categoria} no encontrada para este evento.` });
            }

            const currentStock = stockCheck.rows[0].Stock_Disponible;
            if (currentStock < cantidad) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: `No hay suficiente stock para la zona con ID ${id_categoria}. Disponible: ${currentStock}, Solicitado: ${cantidad}.` });
            }
        }

        // 2. Crear registro en la tabla "Compras"
        const compraResult = await client.query(
            `INSERT INTO "Compras" ("Id_Usuario", "Fecha_Compra", "Total", "Estado")
             VALUES ($1, CURRENT_TIMESTAMP, $2, 'completada') RETURNING "Id_Compra"`,
            [userId, total]
        );
        const Id_Compra = compraResult.rows[0].Id_Compra;

        // 3. Crear registros en la tabla "Tickets" y actualizar stock en "Categorías de entradas"
        for (const ticket of tickets) {
            const { id_categoria, cantidad, precioUnitario, zona } = ticket;

            // Generar un código de ticket único (puedes usar UUID o una lógica más compleja)
            const codigoTicket = `TICKET-${Id_Compra}-${id_categoria}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

            await client.query(
                `INSERT INTO "Tickets" ("Id_Categoria", "Id_Compra", "Codigo_Ticket", "Estado", "Fecha_Emision", "Id_Evento", "Cantidad", "PrecioUnitario", "Tipo_Ticket")
                 VALUES ($1, $2, $3, 'válido', CURRENT_TIMESTAMP, $4, $5, $6, $7)`,
                [id_categoria, Id_Compra, codigoTicket, eventId, cantidad, precioUnitario, zona]
            );

            // Actualizar stock disponible
            await client.query(
                `UPDATE "Categorías de entradas" SET "Stock_Disponible" = "Stock_Disponible" - $1 WHERE "Id_Categoria" = $2`,
                [cantidad, id_categoria]
            );
        }

        // 4. Lógica para puntos Teycketan (si se usaron)
        if (pointsUsed) {
            // Aquí deberías deducir los puntos del usuario en tu tabla "Usuarios"
            // Por ejemplo:
            // await client.query(
            //     `UPDATE "Usuarios" SET "Puntos_Teycketan" = "Puntos_Teycketan" - $1 WHERE "id" = $2`,
            //     [puntosADeducir, userId]
            // );
            // Necesitarías saber cuántos puntos se usaron (ej. si 20 soles = 2000 puntos)
            // Esto se pasaría desde el frontend o se calcularía en el backend.
            console.log(`Usuario ${userId} usó puntos en la compra ${Id_Compra}`);
        }

        // 5. Lógica para registrar promociones aplicadas (opcional, si quieres un registro detallado)
        if (appliedPromotions && appliedPromotions.length > 0) {
            for (const promo of appliedPromotions) {
                // Podrías tener una tabla "Compras_Promociones" para registrar esto
                // INSERT INTO "Compras_Promociones" ("Id_Compra", "Id_Promocion", "Descuento_Aplicado") VALUES (...)
                console.log(`Promoción aplicada a compra ${Id_Compra}: ${promo.Nom_Promocion}`);
            }
        }

        await client.query('COMMIT'); // Confirmar transacción
        res.status(201).json({ message: 'Compra realizada y tickets generados exitosamente.', Id_Compra: Id_Compra });

    } catch (error) {
        if (client) await client.query('ROLLBACK'); // Revertir transacción en caso de error
        console.error('Error al procesar la compra:', error.message);
        res.status(500).json({ message: 'Error interno del servidor al procesar la compra.' });
    } finally {
        if (client) client.release();
    }
});

module.exports = router;
