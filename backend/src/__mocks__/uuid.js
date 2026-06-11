// CJS shim for Jest: uuid v14 is pure ESM, which Jest (CommonJS mode) can't
// parse. Node 18+ crypto.randomUUID() is spec-identical to uuid.v4().
module.exports = { v4: () => require('crypto').randomUUID() };
