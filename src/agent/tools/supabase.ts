import { createClient } from "@supabase/supabase-js";
import { config } from "../../config.js";

export const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

// --- Query helpers used by agent tools ---

export async function getUnprocessedMeetings() {
  const { data, error } = await supabase
    .from("meetings")
    .select("*")
    .eq("processed", false)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function markMeetingProcessed(meetingId: string) {
  const { error } = await supabase
    .from("meetings")
    .update({ processed: true })
    .eq("id", meetingId);
  if (error) throw error;
}

export async function createActionItem(item: {
  meeting_id: string;
  description: string;
  name?: string;
  responsible_party?: string;
  responsible_email?: string;
  suggested_due_date?: string;
  priority?: string;
  context?: string;
  suggested_action?: string;
}) {
  const { data, error } = await supabase
    .from("action_items")
    .insert({ ...item, status: "pending_review" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getActionItemsForMeeting(meetingId: string) {
  const { data, error } = await supabase
    .from("action_items")
    .select("*")
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function updateActionItem(
  itemId: string,
  updates: Record<string, unknown>
) {
  const { error } = await supabase
    .from("action_items")
    .update(updates)
    .eq("id", itemId);
  if (error) throw error;
}

export async function getPendingActionItems() {
  const { data, error } = await supabase
    .from("action_items")
    .select("*, meetings(title, event_datetime, slack_message_ts, slack_channel_id)")
    .eq("status", "pending_review")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function isThreadReplyProcessed(threadTs: string, replyTs: string) {
  const { data } = await supabase
    .from("thread_replies")
    .select("id")
    .eq("slack_thread_ts", threadTs)
    .eq("slack_reply_ts", replyTs)
    .maybeSingle();
  return !!data;
}

export async function markThreadReplyProcessed(
  meetingId: string,
  threadTs: string,
  replyTs: string
) {
  const { error } = await supabase
    .from("thread_replies")
    .upsert({
      meeting_id: meetingId,
      slack_thread_ts: threadTs,
      slack_reply_ts: replyTs,
      processed: true,
    });
  if (error) throw error;
}

export async function searchMeetings(titleQuery: string, daysBack: number = 7, limit: number = 10) {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);

  const { data, error } = await supabase
    .from("meetings")
    .select("id, title, event_datetime, attendees, enhanced_notes")
    .ilike("title", `%${titleQuery}%`)
    .gte("event_datetime", since.toISOString())
    .order("event_datetime", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
