// src/publish-service.js

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function createPublishService({ fetchImpl, twitterClientFactory, repository, clock }) {
  const resolveTwitterClient = twitterClientFactory ?? (() => null);

  return {
    async publishStory(story, audienceConfig) {
      const botToken = String(audienceConfig?.telegram_bot_token ?? "").trim();
      const chatId = String(audienceConfig?.telegram_chat_id ?? "").trim();
      const twitterClient = resolveTwitterClient(audienceConfig ?? {});

      try {
        if (twitterClient) {
          const tweetText = await twitterClient.generateTweet(story);
          await twitterClient.postTweet(tweetText);
        }

        const message = [
          `<b>${escapeHtml(story.title)}</b>`,
          story.story_text ? escapeHtml(story.story_text.slice(0, 800)) : "",
          story.primary_source_url ? `<a href="${story.primary_source_url}">Read more</a>` : ""
        ].filter(Boolean).join("\n\n");

        const sendRes = await fetchImpl(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" })
          }
        );

        if (!sendRes.ok) {
          const errText = await sendRes.text().catch(() => "");
          throw new Error(`Telegram sendMessage failed: ${sendRes.status} ${errText.slice(0, 100)}`);
        }

        await repository.transitionStoryStatus(story.id, "published", {
          actorId: "system",
          timestamp: clock()
        });
        await repository.updateStory(story.id, {
          metadata: { ...story.metadata, published_at: clock() }
        }, { actorId: "system", timestamp: clock() });
      } catch (err) {
        try {
          await repository.transitionStoryStatus(story.id, "failed", {
            actorId: "system",
            timestamp: clock()
          });
        } catch {}
        throw err;
      }
    }
  };
}
