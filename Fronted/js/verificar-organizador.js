// verificar-organizador.js

(function () {
    const token = localStorage.getItem('jwtToken');
    const userRole = localStorage.getItem('userRole');

    if (!token || userRole !== 'organizador') {
        alert('Acceso denegado. Solo organizadores pueden ingresar.');
        window.location.replace('../login.html');
    }
})();
