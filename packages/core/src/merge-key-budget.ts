import type { ConfigPath, ConfigValue } from "./types.js";

/** Count the projected tree before setConfigValueAtPath can allocate its copy. */
export function projectedMergeKeyCount(
  config: Record<string, ConfigValue>, path: ConfigPath, value: ConfigValue, currentCount: number
): number {
  let parent = config;
  for (let index = 0; index < path.length; index++) {
    const key = path[index]!;
    if (!Object.hasOwn(parent, key)) return currentCount + path.length - index + nestedKeyCount(value);
    const previous = parent[key as string]!;
    if (index === path.length - 1) return currentCount + nestedKeyCount(value) - nestedKeyCount(previous);
    if (previous === null || typeof previous !== "object" || Array.isArray(previous)) {
      return currentCount + path.length - index - 1 + nestedKeyCount(value) - nestedKeyCount(previous);
    }
    parent = previous as Record<string, ConfigValue>;
  }
  return currentCount;
}

function nestedKeyCount(value: ConfigValue): number {
  let count = 0;
  const stack: Iterator<ConfigValue>[] = [];
  function enter(child: ConfigValue) {
    if (child === null || typeof child !== "object") return;
    const values = Array.isArray(child) ? child : Object.values(child);
    count += values.length;
    stack.push(values.values());
  }
  enter(value);
  while (stack.length > 0) {
    const next = stack[stack.length - 1]!.next();
    if (next.done) stack.pop();
    else enter(next.value);
  }
  return count;
}
