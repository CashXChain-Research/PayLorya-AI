import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { saveOutputFiles } from "../src/cfo/chat.js";
import type { Store } from "../src/cfo/store.js";

describe("AI CFO chat: files from code execution", () => {
  it("downloads every file the sandbox returned and keeps it as a processed document", async () => {
    const added: Array<{ filename: string; mimeType: string; size: number }> = [];
    const store = {
      addDocument: async (_ws: string, d: { filename: string; mimeType: string; data: Uint8Array }) => (added.push({ filename: d.filename, mimeType: d.mimeType, size: d.data.length }), { id: `doc${added.length}` }),
      completeDocument: async () => undefined,
      log: async () => undefined,
    } as unknown as Store;
    const client = {
      messages: {},
      files: {
        retrieveMetadata: async (id: string) => ({ filename: id === "file_a" ? "Cash_Forecast.xlsx" : "chart.png", mime_type: "application/octet-stream" }),
        download: async () => new Response(new Uint8Array([1, 2, 3])),
      },
    } as unknown as Pick<Anthropic, "messages" | "files">;
    const content = [
      { type: "text", text: "Done" },
      {
        type: "bash_code_execution_tool_result",
        tool_use_id: "srvtoolu_1",
        content: { type: "bash_code_execution_result", stdout: "", stderr: "", return_code: 0, content: [{ type: "bash_code_execution_output", file_id: "file_a" }, { type: "bash_code_execution_output", file_id: "file_b" }] },
      },
    ] as unknown as Anthropic.ContentBlock[];
    const saved = await saveOutputFiles(client, store, "ws", content);
    expect(saved).toEqual([
      { documentId: "doc1", filename: "Cash_Forecast.xlsx" },
      { documentId: "doc2", filename: "chart.png" },
    ]);
    expect(added[0]).toEqual({ filename: "Cash_Forecast.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 3 });
    expect(added[1]!.mimeType).toBe("image/png");
  });
});
