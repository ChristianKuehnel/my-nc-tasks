/**
 * Shared types for the Nextcloud protocol layer.
 *
 * The protocol layer (services/nextcloud, services/caldav) speaks Nextcloud
 * endpoints and WebDAV XML only. It does not know about React or SQLite.
 */

/** Credentials returned by the Login Flow v2 poll endpoint when done. */
export interface LoginFlowCredentials {
  server: string;
  loginName: string;
  appPassword: string;
}

/** Response body of `POST {server}/login/v2` (Login Flow v2 init). */
export interface LoginFlowInitResponse {
  poll: {
    token: string;
    endpoint: string;
  };
  login: string;
}

/**
 * A persisted Nextcloud session, stored exclusively in `expo-secure-store`
 * (device keychain). The `appPassword` is an app-specific password issued by
 * the server during Login Flow v2 — never a user password.
 */
export interface AuthSession {
  /** Normalized server base URL (no trailing slash). */
  serverUrl: string;
  /** Login name used for WebDAV basic auth. */
  loginName: string;
  /** App-specific password issued by the server. */
  appPassword: string;
}
