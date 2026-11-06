import {
  StreamLineBuffer,
  type BufferedLine,
  type ProcessStream,
} from "./logBuffer";

export type LaunchEvent =
  | { kind: "diagnostic"; data: string }
  | { kind: "event"; data: Record<string, unknown> };

export type LaunchEventHandler = (
  event: LaunchEvent,
  buffer: StreamLineBuffer,
) => void;

type RuntimeInstallEvent = {
  event: "stage" | "file" | "retry" | "progress";
  data: Record<string, unknown>;
};

/**
 * Normalize managed-Java install events sent while launching. Current core
 * writes the install event directly (`event: "stage"`, etc.); accept the
 * `event: "runtime"` envelope too for compatible endpoints.
 */
export function runtimeInstallEvent(event: LaunchEvent): RuntimeInstallEvent | null {
  if (event.kind !== "event") return null;
  const direct = event.data.event;
  if (
    direct === "stage" ||
    direct === "file" ||
    direct === "retry" ||
    direct === "progress"
  ) {
    return { event: direct, data: event.data };
  }
  if (direct !== "runtime") return null;
  const runtime = event.data.runtime;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) return null;
  const data = runtime as Record<string, unknown>;
  const nested = data.event;
  const inferred = ["stage", "file", "retry", "progress"].find((name) => name in data);
  const name = typeof nested === "string" ? nested : inferred;
  return name === "stage" || name === "file" || name === "retry" || name === "progress"
    ? { event: name, data }
    : null;
}

// A buffer belongs to one launch. Keep decoder state alongside it so UTF-8
// sequences can span transport records without mixing launches or streams.
const outputDecoders = new WeakMap<
  StreamLineBuffer,
  Record<ProcessStream, TextDecoder>
>();

function decodersFor(buffer: StreamLineBuffer) {
  let decoders = outputDecoders.get(buffer);
  if (!decoders) {
    decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
    outputDecoders.set(buffer, decoders);
  }
  return decoders;
}

/** Always flushes both stream tails, including when the RPC rejects. */
export async function runLaunchRequest<T>(
  request: (onEvent: (event: LaunchEvent) => void) => Promise<T>,
  handleEvent: LaunchEventHandler,
  appendLine: (line: BufferedLine) => void,
): Promise<T> {
  const buffer = new StreamLineBuffer();
  let active = true;
  try {
    return await request((event) => {
      if (active) handleEvent(event, buffer);
    });
  } finally {
    active = false;
    const decoders = outputDecoders.get(buffer);
    if (decoders) {
      for (const stream of ["stdout", "stderr"] as const) {
        for (const line of buffer.push(stream, decoders[stream].decode(), "more")) {
          appendLine(line);
        }
      }
      outputDecoders.delete(buffer);
    }
    for (const line of buffer.flush()) appendLine(line);
  }
}

export function appendLaunchOutput(
  event: LaunchEvent,
  buffer: StreamLineBuffer,
  appendLine: (line: BufferedLine) => void,
): void {
  if (
    event.kind !== "event" ||
    (event.data.event !== "stdout" && event.data.event !== "stderr")
  )
    return;

  const stream = event.data.event as ProcessStream;
  const record = event.data[stream] as
    | { encoding?: string; end?: string; data?: string }
    | undefined;
  if (record?.encoding !== "base64" || typeof record.data !== "string") return;

  const binary = atob(record.data);
  // Newline/EOF are byte boundaries too: emit a replacement for any truncated
  // sequence there, and reset the decoder before another line starts.
  const complete = record.end === "newline" || record.end === "eof";
  const text = decodersFor(buffer)[stream].decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    { stream: !complete },
  );
  for (const line of buffer.push(
    stream,
    text,
    complete ? "newline" : "more",
  )) {
    appendLine(line);
  }
}
