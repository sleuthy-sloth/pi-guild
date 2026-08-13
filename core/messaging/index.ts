import type { Message, MessageStatus, MessageType, NewMessage } from "../types.ts";
import type { GuildRepository } from "../repository.ts";
import { bus as defaultBus, GuildEvents } from "../events.ts";
import type { EventBus } from "../events.ts";

export type { Message, MessageStatus, MessageType, NewMessage } from "../types.ts";

/**
 * MessagingService — inter-agent (and human) messaging with threads (spec §18).
 */
export class MessagingService {
  constructor(
    private readonly repo: GuildRepository,
    private readonly bus: EventBus = defaultBus,
  ) {}

  send(input: NewMessage): Message {
    const message = this.repo.createMessage(input);
    const actor = input.senderId ?? input.senderName;
    this.repo.audit({
      actor,
      action: "message.send",
      entityType: "message",
      entityId: message.id,
      details: { recipientId: message.recipientId, messageType: message.messageType },
    });
    this.repo.recordEvent(GuildEvents.messageSent, { messageId: message.id });
    this.bus.emit(GuildEvents.messageSent, { messageId: message.id });
    return message;
  }

  reply(parentMessageId: string, content: string, senderName: string, senderId?: string): Message {
    const parent = this.repo.getMessage(parentMessageId);
    if (!parent) throw new Error(`message not found: ${parentMessageId}`);

    const message = this.repo.createMessage({
      parentMessageId,
      content,
      senderName,
      senderId,
      projectId: parent.projectId,
      taskId: parent.taskId,
      messageType: "STATUS",
      recipientId: parent.senderId ?? parent.recipientId,
      priority: parent.priority,
    });

    const actor = senderId ?? senderName;
    this.repo.audit({
      actor,
      action: "message.reply",
      entityType: "message",
      entityId: message.id,
      details: { parentMessageId, recipientId: message.recipientId },
    });
    this.repo.recordEvent(GuildEvents.messageSent, { messageId: message.id });
    this.bus.emit(GuildEvents.messageSent, { messageId: message.id });
    return message;
  }

  get(id: string): Message | undefined {
    return this.repo.getMessage(id);
  }

  list(filter?: { recipientId?: string; senderId?: string; projectId?: string; taskId?: string }): Message[] {
    return this.repo.listMessages(filter);
  }

  thread(rootId: string): Message[] {
    return this.repo.listThread(rootId);
  }

  search(query: string): Message[] {
    return this.repo.searchMessages(query);
  }

  markStatus(id: string, status: MessageStatus): void {
    this.repo.markMessageStatus(id, status);
    this.repo.audit({
      actor: "system",
      action: "message.markStatus",
      entityType: "message",
      entityId: id,
      details: { status },
    });
    this.repo.recordEvent("message.status_changed", { messageId: id, status });
  }
}
