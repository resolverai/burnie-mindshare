/**
 * Build-time env injected by webpack DefinePlugin (from .env or CLI).
 * Not present at runtime in the extension; values are inlined in the bundle.
 */
declare const process: {
  env: {
    DVYB_API_BASE?: string;
    DVYB_FRONTEND_URL?: string;
  };
};
