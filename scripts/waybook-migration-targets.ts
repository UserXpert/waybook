export type MigrationTarget = { label: string; kind: "control" | "tenant"; url: string };

/** Validate the entire target set before connecting to or changing a database. */
export function migrationTargets(env: NodeJS.ProcessEnv, local: boolean): MigrationTarget[] {
  const definitions = [
    { label: "Control", kind: "control" as const, key: "WAYBOOK_CONTROL_DATABASE_URL", localName: "waybook_control" },
    { label: "Nordic Studio", kind: "tenant" as const, key: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL", localName: "waybook_nordic_studio" },
    { label: "Copenhagen Physio", kind: "tenant" as const, key: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL", localName: "waybook_copenhagen_physio" },
  ];
  if (local && definitions.some(({ key }) => Boolean(env[key]))) throw new Error("--local cannot be combined with configured Waybook database URLs.");
  const missing = local ? [] : definitions.filter(({ key }) => !env[key]?.trim()).map(({ key }) => key);
  if (missing.length) throw new Error(`Missing database URLs: ${missing.join(", ")}. Set all targets, or use --local for the local databases.`);
  const seen = new Set<string>();
  return definitions.map(({ label, kind, key, localName }) => {
    const url = local ? `postgresql://waybook@127.0.0.1:5440/${localName}` : env[key]!.trim();
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error(`Invalid database URL for ${label}.`); }
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) throw new Error(`Invalid database URL for ${label}.`);
    const destination = `${parsed.hostname.toLowerCase()}:${parsed.port || "5432"}/${parsed.pathname.slice(1)}`;
    if (seen.has(destination)) throw new Error(`Duplicate database target for ${label}. Each target must be distinct.`);
    seen.add(destination);
    return { label, kind, url };
  });
}
