export const PS5_IP = import.meta.env.VITE_PS5_IP || window.location.hostname;
export const MAIN_PORT = import.meta.env.VITE_MAIN_PORT || 6701;
export const DAEMON_PORT = import.meta.env.VITE_DAEMON_PORT || 6701;

// Helper to get absolute URLs for API endpoints
// We now bypass the Vite proxy and hit the PS5 directly even in dev environment
// because the backend supports global CORS.
export const getDaemonUrl = (path) => `http://${PS5_IP}:${DAEMON_PORT}${path}`;
export const getMainUrl = (path) => `http://${PS5_IP}:${MAIN_PORT}${path}`;
export const getDirectMainUrl = (path) => `http://${PS5_IP}:${MAIN_PORT}${path}`;
export const getDirectDaemonUrl = (path) => `http://${PS5_IP}:${DAEMON_PORT}${path}`;

