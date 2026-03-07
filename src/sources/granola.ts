import { Source, SourceContent, Participant } from "./source.js";
import { getUnprocessedMeetings, supabase } from "../agent/tools/supabase.js";
import { config } from "../config.js";

export class GranolaSource implements Source {
  name = "granola";
  pollInterval = 5;

  async poll(): Promise<SourceContent[]> {
    const meetings = await getUnprocessedMeetings();
    return meetings.map((m) => this.toSourceContent(m));
  }

  async getContent(id: string): Promise<SourceContent> {
    const { data, error } = await supabase
      .from("meetings")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) throw new Error(`Meeting not found: ${id}`);
    return this.toSourceContent(data);
  }

  private getOrgDomain(): string | undefined {
    const email = config.ownerAsanaEmail;
    const atIndex = email.indexOf("@");
    return atIndex >= 0 ? email.slice(atIndex + 1) : undefined;
  }

  private toSourceContent(meeting: Record<string, any>): SourceContent {
    const orgDomain = this.getOrgDomain();
    const attendees: Participant[] = Array.isArray(meeting.attendees)
      ? meeting.attendees.map((a: any) => ({
          name: a.name ?? "Unknown",
          email: a.email ?? "",
          organization: a.organization,
          isExternal: a.email && orgDomain
            ? !a.email.endsWith(`@${orgDomain}`)
            : undefined,
        }))
      : [];

    return {
      id: meeting.id,
      source: "granola",
      title: meeting.title,
      date: new Date(meeting.event_datetime),
      participants: attendees,
      body: meeting.enhanced_notes ?? "",
      transcript: meeting.transcript,
      metadata: {
        external_id: meeting.external_id,
        raw_payload: meeting.raw_payload,
      },
    };
  }
}
