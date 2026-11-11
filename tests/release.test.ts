import { describe, expect, it } from "vitest";
import { MemoryKV } from "@/lib/store";
import { createJob, approve, release, spentToday, saveJob, getJob } from "@/lib/jobs";

describe("release of an unsettled reservation", () => {
  it("gives the reserved amount back once, only for failed jobs", async () => {
    process.env.DAILY_CAP_USD = "2";
    const kv = new MemoryKV();
    const made = await createJob(kv, { prompt: "a quiet pond at dawn", duration: 5, resolution: "720p", preset: "static", ipHash: "ip" });
    const id = made.id;
    expect((await release(kv, id)).ok).toBe(false);                 // still pending
    expect((await approve(kv, id)).ok).toBe(true);
    expect(await spentToday(kv)).toBeCloseTo(1.16, 2);
    const j = (await getJob(kv, id))!; j.status = "failed"; await saveJob(kv, j);
    expect((await release(kv, id)).ok).toBe(true);
    expect(await spentToday(kv)).toBeCloseTo(0, 5);
    expect((await release(kv, id)).ok).toBe(false);                 // not twice
  });
});
