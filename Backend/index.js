const express = require('express');
const cors = require('cors');
const app = express();
const eventosRoutes = require('./routes/eventos');

app.use(cors());
app.use(express.json());

app.use('/api/eventos', eventosRoutes);

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

const usuariosRoutes = require('./routes/usuarios');
app.use('/api/usuarios', usuariosRoutes);
