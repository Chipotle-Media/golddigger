/* Cliente de la API de Golddigger. Todas las llamadas usan la cookie de sesión del mismo origen. */
(() => {
  class ApiError extends Error {
    constructor(status, data) {
      super(data?.message || 'No se pudo completar la operación.');
      this.status = status;
      this.field = data?.field;
      this.data = data || {};
    }
  }

  async function request(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch {
      throw new ApiError(0, { message: 'Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.' });
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new ApiError(res.status, data);
      // Sesión vencida o cerrada en otro lugar: la app vuelve a la pantalla de inicio de sesión.
      if (res.status === 401 && path !== '/api/auth/login') window.dispatchEvent(new CustomEvent('gd:unauthorized'));
      throw err;
    }
    return data;
  }

  window.gdApi = {
    ApiError,
    get: (path) => request('GET', path),
    post: (path, body = {}) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    put: (path, body) => request('PUT', path, body)
  };
})();
