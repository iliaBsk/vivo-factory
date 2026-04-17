import test from "node:test";
import assert from "node:assert/strict";
import { createFileRepository, createSQLiteRepository } from "../src/repository.js";

function makeFileRepo() {
  return createFileRepository(new URL(`file:///tmp/test-conv-${Date.now()}.json`));
}

function makeSQLiteRepo() {
  return createSQLiteRepository(`/tmp/test-conv-${Date.now()}.db`);
}

for (const [label, makeRepo] of [["file", makeFileRepo], ["sqlite", makeSQLiteRepo]]) {
  test(`${label}: getOrCreateConversation creates a conversation`, async () => {
    const repo = makeRepo();
    const conv = await repo.getOrCreateConversation("fitness-fans", "operator_console");
    assert.equal(conv.audienceId, "fitness-fans");
    assert.equal(conv.channel, "operator_console");
    assert.ok(conv.id, "should have id");
    assert.ok(conv.createdAt, "should have createdAt");
  });

  test(`${label}: getOrCreateConversation is idempotent`, async () => {
    const repo = makeRepo();
    const a = await repo.getOrCreateConversation("fitness-fans", "operator_console");
    const b = await repo.getOrCreateConversation("fitness-fans", "operator_console");
    assert.equal(a.id, b.id);
  });

  test(`${label}: getOrCreateConversation creates separate entries per channel`, async () => {
    const repo = makeRepo();
    const op = await repo.getOrCreateConversation("fitness-fans", "operator_console");
    const tg = await repo.getOrCreateConversation("fitness-fans", "telegram_channel");
    assert.notEqual(op.id, tg.id);
  });

  test(`${label}: appendChatMessage adds a message`, async () => {
    const repo = makeRepo();
    const conv = await repo.getOrCreateConversation("fitness-fans", "operator_console");
    const msg = await repo.appendChatMessage(conv.id, {
      audienceId: "fitness-fans",
      role: "user",
      content: "Hello!",
      senderId: "op@example.com",
      senderName: "Operator",
      metadata: {}
    });
    assert.ok(msg.id);
    assert.equal(msg.role, "user");
    assert.equal(msg.content, "Hello!");
    assert.equal(msg.conversationId, conv.id);
  });

  test(`${label}: getConversationMessages returns messages in insertion order`, async () => {
    const repo = makeRepo();
    const conv = await repo.getOrCreateConversation("fitness-fans", "operator_console");
    await repo.appendChatMessage(conv.id, { audienceId: "fitness-fans", role: "user", content: "Hi", senderId: "op@example.com", senderName: "Op", metadata: {} });
    await repo.appendChatMessage(conv.id, { audienceId: "fitness-fans", role: "assistant", content: "Hello!", senderId: "bot", senderName: "AI", metadata: {} });
    const msgs = await repo.getConversationMessages(conv.id);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, "user");
    assert.equal(msgs[1].role, "assistant");
  });

  test(`${label}: getConversationMessages returns [] for new conversation`, async () => {
    const repo = makeRepo();
    const conv = await repo.getOrCreateConversation("fitness-fans", "operator_console");
    const msgs = await repo.getConversationMessages(conv.id);
    assert.deepEqual(msgs, []);
  });
}
