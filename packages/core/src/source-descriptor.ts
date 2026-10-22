import type { ConfigSourceDescriptor } from "./types.js";

/** Own mutable policy arrays without copying source config values. */
export function copySourceDescriptor(source: ConfigSourceDescriptor): ConfigSourceDescriptor {
  const redaction = source.redaction;
  return {
    ...source,
    ...(redaction === undefined ? {} : { redaction: {
      ...redaction,
      ...(redaction.secretPaths === undefined ? {} : { secretPaths: redaction.secretPaths.map(path => [...path]) }),
      ...(redaction.secretNamePatterns === undefined ? {} : { secretNamePatterns: [...redaction.secretNamePatterns] })
    } })
  };
}
