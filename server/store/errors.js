export class ConflictError extends Error {
  constructor(message, extra = {}) { super(message); this.status = 409; Object.assign(this, extra); }
}
export class NotFoundError extends Error {
  constructor(message = 'No encontrado.') { super(message); this.status = 404; }
}
