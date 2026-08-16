import target from "../../release-target.json";

function configuredOrigin(value: string) {
  if (!target.rootDomain || value.endsWith(".invalid")) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value ? url : undefined;
  } catch {
    return undefined;
  }
}

export const RELEASE_METADATA_BASE = process.env.NODE_ENV === "production" ? configuredOrigin(target.webOrigin) : undefined;
export const RELEASE_API_ORIGIN = configuredOrigin(target.apiOrigin)?.origin;
