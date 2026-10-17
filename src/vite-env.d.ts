/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_ENABLE_EVEN_REALITIES?: string;
  readonly VITE_STEPFUN_KEYFRAME_INTERVAL_S?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
