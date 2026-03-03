import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export const config = {
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  slackBotToken: required("SLACK_BOT_TOKEN"),
  slackAppToken: required("SLACK_APP_TOKEN"),
  asanaPat: required("ASANA_PAT"),
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  googleCalendarSaKeyBase64: process.env.GOOGLE_CALENDAR_SA_KEY_BASE64 ?? "",

  slackChannelId: process.env.SLACK_CHANNEL_ID ?? "D0AD2PW9GAX",
  asanaProjectGid: process.env.ASANA_PROJECT_GID ?? "1212738213310157",
  asanaBacklogSectionGid: process.env.ASANA_BACKLOG_SECTION_GID ?? "1213139850291370",
  granolaSourceUuid: process.env.GRANOLA_SOURCE_UUID ?? "6d5dd263-00df-49f9-a9ea-5319cbe204d4",
  timezone: process.env.TIMEZONE ?? "America/New_York",
  businessHoursStart: process.env.BUSINESS_HOURS_START ?? "09:00",
  businessHoursEnd: process.env.BUSINESS_HOURS_END ?? "18:00",
  todSlackUserId: process.env.TOD_SLACK_USER_ID ?? "U07GQ171UTZ",
  todAsanaEmail: process.env.TOD_ASANA_EMAIL ?? "tod.ellington@whitestonebranding.com",
} as const;
