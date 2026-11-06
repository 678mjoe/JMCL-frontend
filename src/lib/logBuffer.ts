export type ProcessStream = "stdout" | "stderr";

export interface BufferedLine {
  stream: ProcessStream;
  text: string;
}

/** Reassembles protocol chunks while keeping stdout and stderr independent. */
export class StreamLineBuffer {
  private readonly pending: Record<ProcessStream, string> = { stdout: "", stderr: "" };

  push(stream: ProcessStream, data: string, end: "newline" | "eof" | "more"): BufferedLine[] {
    this.pending[stream] += data;
    const parts = this.pending[stream].replaceAll("\r\n", "\n").split("\n");
    const lines: BufferedLine[] = [];
    const complete = end !== "more" || parts.length > 1;
    if (!complete) return lines;
    const tail = parts.pop() ?? "";
    for (const text of parts) lines.push({ stream, text });
    if (end !== "more") {
      // Core strips the newline from its payload, so an empty newline record
      // is still a real line. EOF is only a flush. Older/mock payloads may
      // contain their own newline; do not append a second ending for those.
      if (tail || (end === "newline" && parts.length === 0)) {
        lines.push({ stream, text: tail });
      }
      this.pending[stream] = "";
    } else {
      this.pending[stream] = tail;
    }
    return lines;
  }

  flush(): BufferedLine[] {
    const lines: BufferedLine[] = [];
    for (const stream of ["stdout", "stderr"] as const) {
      if (this.pending[stream]) {
        lines.push({ stream, text: this.pending[stream] });
        this.pending[stream] = "";
      }
    }
    return lines;
  }
}
