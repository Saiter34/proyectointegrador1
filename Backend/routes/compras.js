// Backend/routes/compras.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, authorizeRole } = require('../middleware/authMiddleware');

// Endpoint para obtener el historial de compras de un usuario
router.get('/usuario/:userId', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    const requestingUserId = req.user.id; // ID del usuario que hace la solicitud

    // Seguridad: Asegurar que solo el propio usuario o un admin pueda ver el historial
    if (userId != requestingUserId && req.user.rol !== 'admin') {
        return res.status(403).json({ message: 'Acceso denegado. No tienes permiso para ver el historial de este usuario.' });
    }

    try {
        // Unir con la tabla Eventos para obtener el nombre del evento
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

// Endpoint para procesar una nueva compra (ejemplo de cómo integrar puntos y descuento de primera compra)
// ESTO ASUME QUE YA TIENES UN ENDPOINT PARA CREAR COMPRAS, AJÚSTALO AL TUYO.
router.post('/procesar-compra', authenticateToken, async (req, res) => {
    const { tickets, totalCompra, eventoId } = req.body; // `tickets` podría ser un array de { id_categoria, cantidad }
    const userId = req.user.id;
    let client;

    try {
        client = await pool.connect();
        await client.query('BEGIN'); // Iniciar transacción

        // 1. Obtener información del usuario para verificar puntos y descuento de primera compra
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
        const PUNTOS_POR_SOLES = 10; // Ejemplo: 10 puntos por cada S/100 de compra

        // Lógica para el 15% de descuento en la primera compra
        if (user.Usado_Primera_Compra === false) {
            const descuentoMonto = totalCompra * 0.15; // 15% de descuento
            finalTotal = totalCompra - descuentoMonto;
            // Opcional: Podrías actualizar Usado_Primera_Compra aquí o en un paso posterior si quieres confirmación de pago
            // Para este ejemplo, lo marcaremos como usado al procesar la compra si aplica.
        }

        // Calcular puntos ganados (ejemplo: 1 punto por cada 10 soles gastados)
        puntosGanados = Math.floor(finalTotal / 10); // Ajusta la lógica de puntos según tu modelo

        // 2. Insertar la nueva compra en la tabla "Compras"
        const compraResult = await client.query(
            `INSERT INTO "Compras" ("Id_Usuario", "Fecha_Compra", "Total", "Estado", "Puntos_Ganados")
             VALUES ($1, NOW(), $2, 'Completada', $3) RETURNING "Id_Compra"`,
            [userId, finalTotal, puntosGanados]
        );
        const newCompraId = compraResult.rows[0].Id_Compra;

        // 3. Actualizar el stock de las categorías de entradas y crear tickets
        for (const ticketInfo of tickets) { // tickets = [{ categoriaId, cantidad }]
            // Verificar disponibilidad y actualizar stock
            const stockCheck = await client.query(
                `SELECT "Stock_Disponible" FROM "Categorías de entradas" WHERE "Id_Categoria" = $1 AND "Id_Evento" = $2 FOR UPDATE`, // FOR UPDATE para evitar race conditions
                [ticketInfo.categoriaId, eventoId]
            );

            if (stockCheck.rows.length === 0 || stockCheck.rows[0].Stock_Disponible < ticketInfo.cantidad) {
                throw new Error(`Stock insuficiente para la categoría ${ticketInfo.categoriaId}.`);
            }

            await client.query(
                `UPDATE "Categorías de entradas" SET "Stock_Disponible" = "Stock_Disponible" - $1 WHERE "Id_Categoria" = $2`,
                [ticketInfo.cantidad, ticketInfo.categoriaId]
            );

            // Crear tickets individuales (si aplica, tu esquema de Tickets sugiere esto)
            for (let i = 0; i < ticketInfo.cantidad; i++) {
                const codigoTicket = Math.random().toString(36).substring(2, 10).toUpperCase(); // Genera un código único
                await client.query(
                    `INSERT INTO "Tickets" ("Id_Categoria", "Id_Compra", "Codigo_Ticket", "Estado", "Fecha_Emision", "Id_Evento", "Cantidad", "PrecioUnitario", "Tipo_Ticket")
                     SELECT $1, $2, $3, 'Válido', NOW(), "Id_Evento", 1, "Precio", "Nom_Categoria" FROM "Categorías de entradas" WHERE "Id_Categoria" = $1`,
                    [ticketInfo.categoriaId, newCompraId, codigoTicket]
                );
            }
        }
        
        // 4. Actualizar puntos del usuario y marcar primera compra si aplica
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

        await client.query('COMMIT'); // Confirmar transacción

        res.status(201).json({ message: 'Compra realizada y puntos asignados exitosamente.', compraId: newCompraId, puntosAsignados: puntosGanados });

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK'); // Revertir transacción en caso de error
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