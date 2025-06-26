        // Backend/middleware/authMiddleware.js
        // Este archivo contiene los middlewares para la autenticación y autorización por roles.

        const jwt = require('jsonwebtoken');
        const path = require('path');
        // Carga las variables de entorno desde el archivo .env ubicado en la raíz del proyecto (un nivel arriba de 'Backend')
        require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

        // Obtiene el secreto JWT de las variables de entorno o usa un valor por defecto seguro.
        // ¡ES CRÍTICO QUE ESTE SECRETO SEA EL MISMO EN TODO TU PROYECTO!
        const JWT_SECRET = process.env.JWT_SECRET || 'tu_secreto_jwt_super_seguro_y_largo_aqui_cambialo_en_produccion_1234567890ABCDEF';

        /**
         * Middleware para autenticar el token JWT presente en el encabezado de autorización.
         * Si el token es válido, decodifica la información del usuario y la adjunta a `req.user`.
         */
        function authenticateToken(req, res, next) {
            const authHeader = req.headers['authorization'];
            // Espera un formato "Bearer TOKEN" y extrae solo el TOKEN.
            const token = authHeader && authHeader.split(' ')[1];

            if (token == null) {
                // Si no hay token, el acceso es denegado.
                return res.status(401).json({ message: 'Acceso denegado. Se requiere autenticación.' });
            }

            // Verifica el token usando el secreto JWT.
            jwt.verify(token, JWT_SECRET, (err, user) => {
                if (err) {
                    // Si hay un error (token inválido o expirado), el acceso es prohibido.
                    console.error('Error de verificación de JWT:', err.message);
                    return res.status(403).json({ message: 'Token inválido o expirado.' });
                }
                // Adjunta la información decodificada del usuario a la solicitud para uso posterior.
                req.user = user;
                next(); // Continúa con el siguiente middleware o la ruta.
            });
        }

        /**
         * Middleware genérico para autorizar el acceso basado en roles.
         * Retorna una función de middleware que verifica si el rol del usuario
         * (obtenido de `req.user.rol`) está incluido en el array de roles permitidos.
         * @param {Array<string>} roles - Un array de roles permitidos para acceder a la ruta (ej. ['admin', 'organizador']).
         */
        function authorizeRole(roles) {
            return (req, res, next) => {
                // Si no hay información de usuario o no tiene un rol definido en el token.
                if (!req.user || !req.user.rol) {
                    return res.status(403).json({ message: 'Acceso denegado. Rol de usuario no definido en el token.' });
                }
                // Verifica si el rol del usuario NO está en la lista de roles permitidos.
                if (!roles.includes(req.user.rol)) {
                    return res.status(403).json({ message: `Acceso denegado. Requiere uno de los roles: ${roles.join(', ')}.` });
                }
                next(); // El usuario tiene un rol permitido, continúa.
            };
        }

        // Exporta las funciones de middleware para que puedan ser utilizadas en otras partes de la aplicación.
        module.exports = {
            authenticateToken,
            authorizeRole
        };
        