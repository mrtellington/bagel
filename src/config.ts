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

  slackChannelId: required("SLACK_CHANNEL_ID"),
  asanaWorkspaceGid: required("ASANA_WORKSPACE_GID"),
  asanaProjectGid: required("ASANA_PROJECT_GID"),
  asanaBacklogSectionGid: required("ASANA_BACKLOG_SECTION_GID"),
  granolaSourceUuid: required("GRANOLA_SOURCE_UUID"),
  timezone: process.env.TIMEZONE ?? "America/New_York",
  businessHoursStart: process.env.BUSINESS_HOURS_START ?? "09:00",
  businessHoursEnd: process.env.BUSINESS_HOURS_END ?? "18:00",
  ownerSlackUserId: required("OWNER_SLACK_USER_ID"),
  ownerAsanaEmail: required("OWNER_ASANA_EMAIL"),
  ownerName: process.env.OWNER_NAME ?? "Owner",
  ownerTitle: process.env.OWNER_TITLE ?? "",
  orgName: process.env.ORG_NAME ?? "",
} as const;
