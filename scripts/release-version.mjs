const RELEASE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseReleaseVersion(value) {
  if (typeof value !== "string") {
    throw new Error("Release version must be semantic version text.");
  }

  const match = RELEASE_VERSION_PATTERN.exec(value);
  if (match === null) {
    throw new Error("Release version must be an exact stable or prerelease semantic version.");
  }

  const prereleaseText = match[4];
  if (prereleaseText !== undefined) {
    for (const identifier of prereleaseText.split(".")) {
      if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")) {
        throw new Error("Numeric prerelease identifiers must not contain leading zeroes.");
      }
    }
  }

  return {
    version: value,
    prerelease: prereleaseText !== undefined,
    npmTag: prereleaseText === undefined ? "latest" : "next"
  };
}
