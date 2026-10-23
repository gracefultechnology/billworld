// Derive scheme from the connection, never untrusted proxy headers.
export const requestOrigin = req => `${req.socket?.encrypted ? 'https' : 'http'}://${req.headers.host}`;
