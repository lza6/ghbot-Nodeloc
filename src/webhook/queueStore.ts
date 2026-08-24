/**
 * QueueStore — 可选 webhook 队列持久化层。
 * 任务序列化到 `.ghbot-webhook-queue/` 目录，进程重启后恢复。
 * 默认关闭（webhookQueueDurable = false），开启后保留 delivery 去重能力。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { tempRootDirectory } from "../runtimePaths.js";

export type QueueTask = {
  deliveryId: string;
  eventName: string;
  payload: unknown;
  enqueuedAt: number;
};

export class QueueStore {
  private readonly dir: string;

  constructor(baseDir?: string) {
    this.dir = path.join(baseDir ?? tempRootDirectory(), ".ghbot-webhook-queue");
  }

  async write(task: QueueTask): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(
      path.join(this.dir, `${task.deliveryId}.json`),
      JSON.stringify(task, null, 2),
      "utf8"
    );
  }

  async remove(deliveryId: string): Promise<void> {
    await fs.rm(path.join(this.dir, `${deliveryId}.json`), { force: true });
  }

  async restore(): Promise<QueueTask[]> {
    try {
      const entries = await fs.readdir(this.dir);
      const tasks: QueueTask[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        try {
          const content = await fs.readFile(path.join(this.dir, entry), "utf8");
          tasks.push(JSON.parse(content) as QueueTask);
        } catch {
          // Skip corrupted entries
          continue;
        }
      }
      return tasks;
    } catch {
      return [];
    }
  }

  async exists(deliveryId: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.dir, `${deliveryId}.json`));
      return true;
    } catch {
      return false;
    }
  }
}
