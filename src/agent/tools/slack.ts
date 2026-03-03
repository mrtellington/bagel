import { WebClient } from "@slack/web-api";
import { config } from "../../config.js";

const slack = new WebClient(config.slackBotToken);

export async function postMessage(text: string, threadTs?: string) {
  const result = await slack.chat.postMessage({
    channel: config.slackChannelId,
    text,
    thread_ts: threadTs,
  });
  return { ts: result.ts, channel: result.channel };
}

export async function updateMessage(ts: string, text: string) {
  await slack.chat.update({
    channel: config.slackChannelId,
    ts,
    text,
  });
}

export async function getThreadReplies(threadTs: string) {
  const result = await slack.conversations.replies({
    channel: config.slackChannelId,
    ts: threadTs,
  });
  // Filter out the parent message — only return replies
  const messages = result.messages ?? [];
  return messages.filter((m) => m.ts !== threadTs);
}

export async function getUserInfo(userId: string) {
  const result = await slack.users.info({ user: userId });
  return result.user;
}
