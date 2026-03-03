export interface Participant {
  name: string;
  email: string;
  organization?: string;
  isExternal?: boolean;
}

export interface SourceContent {
  id: string;
  source: string;
  title: string;
  date: Date;
  participants: Participant[];
  body: string;
  transcript?: string;
  metadata: Record<string, unknown>;
}

export interface Source {
  name: string;
  pollInterval: number; // minutes

  poll(): Promise<SourceContent[]>;
  getContent(id: string): Promise<SourceContent>;
}
