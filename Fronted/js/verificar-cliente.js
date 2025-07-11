// verificar-cliente.js
(function () {
    const token = localStorage.getItem('jwtToken');
    const userRole = localStorage.getItem('userRole');
    if (!token || userRole !== 'cliente') {
        alert('Acceso denegado. Solo clientes pueden ingresar.');
        window.location.replace('../login.html');
    }
})();
