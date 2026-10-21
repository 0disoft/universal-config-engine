import type { ConfigSourceDescriptor, LoadedSource } from "@0disoft/universal-config-engine-core";
import { collectJsonLocations } from "./json-locations.js";
import type { FileReadPolicy } from "./file.js";
import { loadTextFileSource } from "./file-source.js";
import { positiveSafeIntegerLimit } from "./limits.js";

const DEFAULT_MAX_LOCATION_BYTES = 4 * 1024 * 1024;

export interface LoadJsonFileSourceInput extends FileReadPolicy {
  readonly descriptor: ConfigSourceDescriptor;
  readonly filePath: string;
  /** Compact UTF-8 location-record budget; defaults to 4 MiB. */
  readonly maxLocationBytes?: number;
}

export async function loadJsonFileSource(input: LoadJsonFileSourceInput): Promise<LoadedSource> {
  return loadTextFileSource(input, {
    readFailure: {
      category: "source-load",
      code: "json_read_failed",
      message: "Failed to read JSON source. Exception details were omitted from diagnostics."
    },
    parseFailure: {
      category: "parse",
      code: "json_parse_failed",
      message: "Failed to parse JSON source. Exception details were omitted from diagnostics."
    },
    parse: (raw, canonicalPath) => ({
      descriptor: input.descriptor,
      value: JSON.parse(raw) as unknown,
      ...collectJsonLocations(input.descriptor.id, canonicalPath, raw,
        positiveSafeIntegerLimit(input.maxLocationBytes, DEFAULT_MAX_LOCATION_BYTES))
    })
  });
}
