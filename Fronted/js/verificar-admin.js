// verificar-admin.js

(function () {
    const token = localStorage.getItem('jwtToken');
    const userRole = localStorage.getItem('userRole');

    if (!token || userRole !== 'admin') {
        alert('Acceso denegado. Solo administradores pueden ingresar.');
        window.location.replace('../login.html');
    }
})();
