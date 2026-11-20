import postgres from "postgres";

/** Open a bounded Control or tenant pool, using TLS for hosted connections. */
export function connectWaybookPostgres(connectionUrl: string) {
  const { hostname } = new URL(connectionUrl);
  const localWithoutTls = hostname === "localhost" || hostname === "127.0.0.1";

  return postgres(connectionUrl, {
    max: 5,
    ssl: localWithoutTls ? false : "require",
  });
}
