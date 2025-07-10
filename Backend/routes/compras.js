// Backend/routes/compras.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

/**
 * @brief Endpoint to get a user's purchase history.
 * Requires authentication. Only the user themselves or an admin can view the history.
 * Joins with Events table to get event name and counts tickets per purchase.
 */
router.get('/usuario/:userId', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    const requestingUserId = req.user.id; // ID of the user making the request

    // Security: Ensure only the user themselves or an admin can view the history
    if (userId != requestingUserId && req.user.rol !== 'admin') {
        return res.status(403).json({ message: 'Acceso denegado. No tienes permiso para ver el historial de este usuario.' });
    }

    try {
        // Join with Eventos table to get the event name
        const result = await pool.query(
            `SELECT
                c."Id_Compra",
                c."Fecha_Compra",
                c."Total" AS "Precio_Total",
                c."Estado",
                c."Puntos_Ganados",
                e."Nom_Evento",
                COUNT(t."Id_Ticket") AS "Cantidad_Tickets"
            FROM "Compras" c
            JOIN "Tickets" t ON c."Id_Compra" = t."Id_Compra"
            JOIN "Categorías de entradas" ce ON t."Id_Categoria" = ce."Id_Categoria"
            JOIN "Eventos" e ON ce."Id_Evento" = e."Id_Evento"
            WHERE c."Id_Usuario" = $1
            GROUP BY c."Id_Compra", e."Nom_Evento"
            ORDER BY c."Fecha_Compra" DESC`,
            [userId]
        );

        res.status(200).json({ purchases: result.rows });
    } catch (error) {
        console.error('Error al obtener el historial de compras:', error);
        res.status(500).json({ message: 'Error interno del servidor al obtener el historial de compras.' });
    }
});

/**
 * @brief Endpoint to process a new purchase.
 * Handles ticket creation, stock update, user points update, first purchase discount,
 * and notification creation. Returns details of individual tickets generated.
 * Requires authentication.
 */
router.post('/procesar-compra', authenticateToken, async (req, res) => {
    // `tickets` expects an array of objects with { categoriaId, cantidad, nombresTitulares: [] }
    const { tickets, totalCompra, eventoId } = req.body;
    const userId = req.user.id;
    let client;

    try {
        client = await pool.connect();
        await client.query('BEGIN'); // Start transaction

        // Validate that totalCompra is a valid number
        if (typeof totalCompra !== 'number' || isNaN(totalCompra) || totalCompra < 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'El total de la compra es inválido. Debe ser un número positivo.' });
        }

        // Validate that tickets and holder names are consistent
        if (!tickets || !Array.isArray(tickets) || tickets.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'No se han proporcionado tickets para la compra.' });
        }

        for (const ticketInfo of tickets) {
            if (!ticketInfo.categoriaId || typeof ticketInfo.cantidad !== 'number' || ticketInfo.cantidad <= 0 ||
                !Array.isArray(ticketInfo.nombresTitulares) || ticketInfo.nombresTitulares.length !== ticketInfo.cantidad) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Datos de tickets inválidos. Asegúrese de que la cantidad de nombres de titulares coincida con la cantidad de tickets.' });
            }
        }

        // 1. Get user information to check points and first purchase discount
        const userRes = await client.query(
            `SELECT "Puntos_Teycketan", "Usado_Primera_Compra" FROM "Usuarios" WHERE "id" = $1`,
            [userId]
        );
        const user = userRes.rows[0];
        if (!user) {
            throw new Error('Usuario no encontrado.');
        }

        let finalTotal = totalCompra;
        let puntosGanados = 0;
        const PUNTOS_POR_SOLES = 10; // Example: 10 points for every S/100 of purchase

        // Logic for 15% discount on first purchase
        if (user.Usado_Primera_Compra === false) {
            const descuentoMonto = totalCompra * 0.15; // 15% discount
            finalTotal = totalCompra - descuentoMonto; // Corrected: use totalCompra here
        }

        // Calculate points earned (example: 1 point for every 10 soles spent)
        puntosGanados = Math.floor(finalTotal / 10); // Adjust points logic according to your model

        // 2. Insert the new purchase into the "Compras" table
        const compraResult = await client.query(
            `INSERT INTO "Compras" ("Id_Usuario", "Fecha_Compra", "Total", "Estado", "Puntos_Ganados")
             VALUES ($1, NOW(), $2, 'Completada', $3) RETURNING "Id_Compra"`,
            [userId, finalTotal, puntosGanados]
        );
        const newCompraId = compraResult.rows[0].Id_Compra;

        // Array to store details of generated tickets to send back to frontend
        const generatedTickets = []; 

        // 3. Update stock of ticket categories and create tickets
        for (const ticketInfo of tickets) { // tickets = [{ categoriaId, cantidad, nombresTitulares }]
            // Check availability and update stock
            const stockCheck = await client.query(
                `SELECT "Stock_Disponible", "Precio", "Nom_Categoria" FROM "Categorías de entradas" WHERE "Id_Categoria" = $1 AND "Id_Evento" = $2 FOR UPDATE`, // FOR UPDATE to prevent race conditions
                [ticketInfo.categoriaId, eventoId]
            );

            if (stockCheck.rows.length === 0 || stockCheck.rows[0].Stock_Disponible < ticketInfo.cantidad) {
                throw new Error(`Stock insuficiente para la categoría ${ticketInfo.categoriaId}.`);
            }

            await client.query(
                `UPDATE "Categorías de entradas" SET "Stock_Disponible" = "Stock_Disponible" - $1 WHERE "Id_Categoria" = $2`,
                [ticketInfo.cantidad, ticketInfo.categoriaId]
            );

            // Create individual tickets with holder's name
            const precioUnitario = stockCheck.rows[0].Precio;
            const tipoTicket = stockCheck.rows[0].Nom_Categoria;

            for (let i = 0; i < ticketInfo.cantidad; i++) {
                const codigoTicket = Math.random().toString(36).substring(2, 10).toUpperCase(); // Generate a unique code
                const nombreTitular = ticketInfo.nombresTitulares[i] || 'Sin Nombre'; // Assign name or default value

                const ticketInsertResult = await client.query(
                    `INSERT INTO "Tickets" ("Id_Categoria", "Id_Compra", "Codigo_Ticket", "Estado", "Fecha_Emision", "Id_Evento", "Cantidad", "PrecioUnitario", "Tipo_Ticket", "Nombre_Titular")
                     VALUES ($1, $2, $3, 'Válido', NOW(), $4, 1, $5, $6, $7) RETURNING "Id_Ticket"`, // RETURNING Id_Ticket if needed later
                    [ticketInfo.categoriaId, newCompraId, codigoTicket, eventoId, precioUnitario, tipoTicket, nombreTitular]
                );

                // Add details of the generated ticket to the array
                generatedTickets.push({
                    Id_Ticket: ticketInsertResult.rows[0].Id_Ticket, // Assuming you want the ticket ID
                    Codigo_Ticket: codigoTicket,
                    Categoria_Nombre: tipoTicket, // The category name (zone name)
                    Precio_Unitario: precioUnitario,
                    Nombre_Titular: nombreTitular
                });
            }
        }

        // 4. Update user points and mark first purchase if applicable
        await client.query(
            `UPDATE "Usuarios" SET "Puntos_Teycketan" = "Puntos_Teycketan" + $1 WHERE "id" = $2`,
            [puntosGanados, userId]
        );

        if (user.Usado_Primera_Compra === false) {
            await client.query(
                `UPDATE "Usuarios" SET "Usado_Primera_Compra" = TRUE WHERE "id" = $1`,
                [userId]
            );
        }

        // 5. Insert a notification for the user
        // First, get the event name
        const eventNameResult = await client.query('SELECT "Nom_Evento" FROM "Eventos" WHERE "Id_Evento" = $1', [eventoId]);
        const eventName = eventNameResult.rows[0] ? eventNameResult.rows[0].Nom_Evento : 'un evento';

        const notificationMessage = `¡Tu compra de tickets para "${eventName}" ha sido confirmada! Has ganado ${puntosGanados} puntos Teycketan.`;

        await client.query(
            `INSERT INTO "Notificaciones" ("Id_Usuario", "Mensaje", "Fecha_Creacion", "Leida") VALUES ($1, $2, NOW(), FALSE)`,
            [userId, notificationMessage]
        );

        await client.query('COMMIT'); // Confirm transaction

        // SUCCESS RESPONSE: Now includes the generatedTickets array
        res.status(201).json({ 
            message: 'Compra realizada y puntos asignados exitosamente.', 
            compraId: newCompraId, 
            puntosAsignados: puntosGanados,
            tickets: generatedTickets // THIS IS THE KEY ADDITION
        });

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK'); // Revert transaction in case of error
        }
        console.error('Error al procesar la compra:', error.message);
        res.status(500).json({ message: `Error al procesar la compra: ${error.message}` });
    } finally {
        if (client) {
            client.release();
        }
    }
});

module.exports = router;
