import { beforeEach, describe, expect, it } from "vitest";
import { MessagingService } from "../../core/messaging/index.ts";
import { StudioRepository } from "../../core/repository.ts";
import { newTestRepo } from "../helpers.ts";

describe("MessagingService", () => {
  let repo: StudioRepository;
  let messaging: MessagingService;

  beforeEach(() => {
    repo = newTestRepo();
    messaging = new MessagingService(repo);
  });

  it("sends, replies, threads, searches, and updates status", () => {
    const msg = messaging.send({
      senderName: "ceo",
      senderId: "ceo-1",
      recipientId: "manager-1",
      messageType: "TASK",
      content: "build the calculator",
      projectId: "p1",
    });
    expect(msg.status).toBe("UNREAD");

    const reply = messaging.reply(msg.id, "on it", "manager", "manager-1");
    expect(reply.parentMessageId).toBe(msg.id);
    // Replies are routed back to the original sender.
    expect(reply.recipientId).toBe("ceo-1");

    const thread = messaging.thread(msg.id);
    expect(thread.map((m) => m.id)).toEqual([msg.id, reply.id]);

    expect(messaging.search("calculator").map((m) => m.id)).toContain(msg.id);
    expect(messaging.search("does-not-match")).toHaveLength(0);

    messaging.markStatus(reply.id, "READ");
    expect(messaging.get(reply.id)?.status).toBe("READ");
  });
});
