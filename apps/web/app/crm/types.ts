export type Status = "Todo" | "In Progress" | "Review" | "Done" | "Blocked";
export type Priority = "Urgent" | "High" | "Medium" | "Low" | "None";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  logo?: string;
}
export interface Member {
  id: string;
  membershipId?: string;
  displayName: string;
  email: string;
  initials: string;
  avatarUrl?: string;
  role: "مدیر" | "عضو" | "مهمان";
  avatarColor: string;
  online?: boolean;
}
export interface Project {
  id: string;
  name: string;
  identifier: string;
  description?: string;
  color?: string;
  progress?: number;
  totalIssues?: number;
  completedIssues?: number;
  members?: Member[];
  memberIds?: string[];
  targetDate?: string;
  updatedAt?: string;
  archivedAt?: string;
  projectLead?: Member;
  projectLeadId?: string;
  createdAt?: string;
}
export interface Issue {
  id: string;
  sequenceId: number;
  name: string;
  scope: "project" | "workspace";
  projectId?: string;
  projectName?: string;
  projectIdentifier: string;
  status: Status;
  stateId?: string;
  priority: Priority;
  assignee?: Member;
  dueDate?: string;
  completedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  labels?: string[];
}
export interface NotificationItem {
  id: string;
  title: string;
  description: string;
  time: string;
  read: boolean;
  type: "mention" | "assignment" | "update" | "comment";
}

export interface ProjectState {
  id: string;
  name: string;
  group: string;
  color: string;
  status: Status;
}

export interface Cycle {
  id: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  progress?: number;
}

export interface ActivityItem {
  id: string;
  message: string;
  actor?: string;
  createdAt?: string;
}
