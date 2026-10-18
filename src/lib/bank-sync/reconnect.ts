import type { ConnectionHealth } from "./health";

/** Where "Reconnect" goes for a connection (the connect route with `reconnect=<id>`); null unless its health asks for it. */
export function reconnectHref(connection: { id: string; aspspName: string; aspspCountry: string; health: ConnectionHealth }): string | null {
  if (connection.health.kind !== "reconnect") return null;
  return `/api/bank-sync/connect?${new URLSearchParams({ aspsp: connection.aspspName, country: connection.aspspCountry, reconnect: connection.id })}`;
}
