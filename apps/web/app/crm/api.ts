import { create } from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUIStore } from "./store";
import type {
  ActivityItem,
  Cycle,
  Issue,
  Member,
  NotificationItem,
  Project,
  ProjectState,
  Status,
  Workspace,
} from "./types";

const origin = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/api\/v1\/?$/, "").replace(/\/$/, "");
const api = create({ baseURL: origin, timeout: 20000, withCredentials: true });
let csrfToken: string | undefined;

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const storedToken =
    localStorage.getItem("api_key") || localStorage.getItem("access_token") || localStorage.getItem("accessToken");
  if (storedToken) {
    config.headers["X-Api-Key"] = storedToken;
    config.headers.Authorization = `Bearer ${storedToken}`;
  }
  if (config.method && !["get", "head", "options"].includes(config.method)) {
    if (!csrfToken) csrfToken = (await api.get<{ csrf_token: string }>("/auth/get-csrf-token/")).data.csrf_token;
    config.headers["X-CSRFTOKEN"] = csrfToken;
  }
  return config;
});

const unwrap = <T>(payload: T | { results?: T; data?: T }): T => {
  if (payload && typeof payload === "object" && "results" in payload && payload.results) return payload.results;
  if (payload && typeof payload === "object" && "data" in payload && payload.data) return payload.data;
  return payload as T;
};
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join(" ");
const roleName = (role: unknown): Member["role"] => (Number(role) >= 20 ? "مدیر" : "عضو");
const mapMember = (row: Record<string, unknown>, index = 0): Member => {
  const person = (row.member ?? row) as Record<string, unknown>;
  const name = String(person.display_name ?? `${person.first_name ?? ""} ${person.last_name ?? ""}`).trim() || "کاربر";
  return {
    id: String(person.id),
    membershipId: row.id ? String(row.id) : undefined,
    displayName: name,
    email: String(person.email ?? ""),
    initials: initials(name),
    avatarUrl: person.avatar_url ? String(person.avatar_url) : person.avatar ? String(person.avatar) : undefined,
    role: roleName(row.role),
    avatarColor: ["#4f46e5", "#ec4899", "#0ea5e9", "#f59e0b"][index % 4],
  };
};
const stateStatus = (group: unknown, name: unknown): Status => {
  const value = `${group ?? ""} ${name ?? ""}`;
  if (/review|بازبینی/i.test(value)) return "Review";
  if (/started|progress|فعال|جریان/i.test(value)) return "In Progress";
  if (/completed|done|تمام|تکمیل/i.test(value)) return "Done";
  if (/cancelled|blocked|مسدود|لغو/i.test(value)) return "Blocked";
  return "Todo";
};
const mapState = (item: Record<string, unknown>): ProjectState => ({
  id: String(item.id),
  name: String(item.name ?? "بدون وضعیت"),
  group: String(item.group ?? "unstarted"),
  color: String(item.color ?? "#9ca3af"),
  status: stateStatus(item.group, item.name),
});
const mapProject = (item: Record<string, unknown>): Project => {
  const lead =
    item.project_lead && typeof item.project_lead === "object"
      ? mapMember(item.project_lead as Record<string, unknown>)
      : undefined;
  const done = Number(item.completed_issue_count ?? 0),
    total = Number(item.total_issue_count ?? 0);
  return {
    id: String(item.id),
    name: String(item.name ?? "پروژه بدون نام"),
    identifier: String(item.identifier ?? "PRJ"),
    description:
      typeof item.description === "string"
        ? item.description
        : typeof item.description_text === "string"
          ? item.description_text
          : "",
    color: String(
      (item.logo_props as { icon?: { color?: string } } | undefined)?.icon?.color ?? item.color ?? "#4f46e5"
    ),
    progress: total ? Math.round((done / total) * 100) : 0,
    totalIssues: total,
    completedIssues: done,
    targetDate: item.target_date ? String(item.target_date) : undefined,
    archivedAt: item.archived_at ? String(item.archived_at) : undefined,
    createdAt: item.created_at ? String(item.created_at) : undefined,
    updatedAt: item.updated_at ? String(item.updated_at) : undefined,
    projectLead: lead,
    projectLeadId: lead?.id ?? (item.project_lead ? String(item.project_lead) : undefined),
    memberIds: Array.isArray(item.members) ? item.members.map(String) : [],
  };
};
const mapIssue = (
  item: Record<string, unknown>,
  projectId: string,
  states: ProjectState[] = [],
  members: Member[] = [],
  projectIdentifier?: string
): Issue => {
  const stateRaw = (item.state_detail ?? item.state) as Record<string, unknown> | string | undefined;
  const stateId =
    typeof stateRaw === "string"
      ? stateRaw
      : stateRaw?.id
        ? String(stateRaw.id)
        : item.state_id
          ? String(item.state_id)
          : undefined;
  const knownState = states.find((state) => state.id === stateId);
  const assigneeRaw = Array.isArray(item.assignees)
    ? item.assignees[0]
    : Array.isArray(item.assignee_details)
      ? item.assignee_details[0]
      : undefined;
  const assigneeId =
    Array.isArray(item.assignee_ids) && item.assignee_ids[0] ? String(item.assignee_ids[0]) : undefined;
  const rawPriority = String(item.priority ?? "none").toLowerCase();
  return {
    id: String(item.id),
    sequenceId: Number(item.sequence_id ?? 0),
    name: String(item.name ?? "کار بدون عنوان"),
    scope: "project",
    projectId,
    projectIdentifier: String(
      item.project_identifier ??
        (item.project_detail as { identifier?: string } | undefined)?.identifier ??
        projectIdentifier ??
        "PRJ"
    ),
    status:
      knownState?.status ??
      stateStatus(
        typeof stateRaw === "object" ? stateRaw?.group : "",
        typeof stateRaw === "object" ? stateRaw?.name : ""
      ),
    stateId,
    priority: (["urgent", "high", "medium", "low", "none"].includes(rawPriority)
      ? `${rawPriority[0].toUpperCase()}${rawPriority.slice(1)}`
      : "None") as Issue["priority"],
    assignee:
      assigneeRaw && typeof assigneeRaw === "object"
        ? mapMember(assigneeRaw as Record<string, unknown>)
        : members.find((member) => member.id === assigneeId),
    dueDate: item.target_date ? String(item.target_date) : undefined,
    completedAt: item.completed_at ? String(item.completed_at) : undefined,
    createdAt: item.created_at ? String(item.created_at) : undefined,
    updatedAt: item.updated_at ? String(item.updated_at) : undefined,
    labels: Array.isArray(item.label_details)
      ? item.label_details.map((label) => String((label as { name?: string }).name ?? "")).filter(Boolean)
      : [],
  };
};
const workspaceTaskStatus: Record<string, Status> = {
  todo: "Todo",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
};
const mapWorkspaceTask = (item: Record<string, unknown>, members: Member[]): Issue => {
  const assigneeRaw = item.assignee_detail;
  const assigneeId = item.assignee_id ? String(item.assignee_id) : undefined;
  const rawPriority = String(item.priority ?? "none").toLowerCase();
  return {
    id: String(item.id),
    sequenceId: Number(item.sequence_id ?? 0),
    name: String(item.name ?? "کار بدون عنوان"),
    scope: "workspace",
    projectIdentifier: "TEAM",
    status: workspaceTaskStatus[String(item.status)] ?? "Todo",
    priority: (["urgent", "high", "medium", "low", "none"].includes(rawPriority)
      ? `${rawPriority[0].toUpperCase()}${rawPriority.slice(1)}`
      : "None") as Issue["priority"],
    assignee:
      assigneeRaw && typeof assigneeRaw === "object"
        ? mapMember(assigneeRaw as Record<string, unknown>)
        : members.find((member) => member.id === assigneeId),
    dueDate: item.target_date ? String(item.target_date) : undefined,
    completedAt: item.completed_at ? String(item.completed_at) : undefined,
    createdAt: item.created_at ? String(item.created_at) : undefined,
    updatedAt: item.updated_at ? String(item.updated_at) : undefined,
    labels: [],
  };
};
const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && !(error as AxiosError).response) return error.message || fallback;
  const data = (error as AxiosError<Record<string, unknown>>)?.response?.data;
  const value = data?.error ?? data?.detail ?? (data ? Object.values(data)[0] : undefined);
  return Array.isArray(value) ? String(value[0]) : String(value ?? fallback);
};
const useSlug = (provided?: string) => useUIStore((state) => provided || state.workspaceSlug);

export const useWorkspaces = () =>
  useQuery({
    queryKey: ["workspaces"],
    queryFn: async (): Promise<Workspace[]> =>
      unwrap<Record<string, unknown>[]>((await api.get("/api/users/me/workspaces/")).data).map((item) => ({
        id: String(item.id),
        name: String(item.name),
        slug: String(item.slug),
        logo: item.logo_url ? String(item.logo_url) : undefined,
      })),
    retry: false,
  });
export const useCurrentUser = () =>
  useQuery({
    queryKey: ["current-user"],
    queryFn: async (): Promise<Member> => mapMember((await api.get("/api/users/me/")).data),
    retry: false,
  });

export const useWorkspaceAccess = (providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["workspace-access", slug],
    enabled: Boolean(slug),
    retry: false,
    queryFn: async (): Promise<{ role: number; isAdmin: boolean }> => {
      const data = (await api.get(`/api/workspaces/${slug}/workspace-members/me/`)).data as { role?: number };
      const role = Number(data.role ?? 0);
      return { role, isAdmin: role === 20 };
    },
  });
};

export const useSignOut = () =>
  useMutation({
    mutationFn: () => api.post("/auth/sign-out/", {}),
    onSuccess: () => {
      localStorage.removeItem("api_key");
      localStorage.removeItem("access_token");
      localStorage.removeItem("accessToken");
      window.location.assign("/login");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "خروج از حساب انجام نشد"), "error"),
  });

export const useUpdateUserProfile = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { display_name: string; first_name?: string; last_name?: string }) =>
      api.patch("/api/users/me/", payload),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["current-user"] });
      client.invalidateQueries({ queryKey: ["members"] });
      useUIStore.getState().toast("پروفایل ذخیره شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "ذخیره پروفایل انجام نشد"), "error"),
  });
};

export const useUploadAvatar = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      if (!file.type.startsWith("image/")) throw new Error("فقط فایل تصویری مجاز است");
      if (file.size > 5 * 1024 * 1024) throw new Error("حجم تصویر نباید بیشتر از ۵ مگابایت باشد");
      const response = await api.post<{
        asset_id: string;
        asset_url: string;
        upload_data: { url: string; fields: Record<string, string> };
      }>("/api/assets/v2/user-assets/", {
        name: file.name,
        type: file.type,
        size: file.size,
        entity_type: "USER_AVATAR",
      });
      const formData = new FormData();
      Object.entries(response.data.upload_data.fields).forEach(([key, value]) => formData.append(key, value));
      formData.append("file", file);
      const uploaded = await fetch(response.data.upload_data.url, { method: "POST", body: formData });
      if (!uploaded.ok) {
        await api.delete(`/api/assets/v2/user-assets/${response.data.asset_id}/`);
        throw new Error("بارگذاری تصویر در فضای ذخیره‌سازی انجام نشد");
      }
      await api.patch(`/api/assets/v2/user-assets/${response.data.asset_id}/`, {});
      return response.data.asset_url;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["current-user"] });
      client.invalidateQueries({ queryKey: ["members"] });
      useUIStore.getState().toast("تصویر پروفایل ذخیره شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "بارگذاری تصویر انجام نشد"), "error"),
  });
};

export interface AppearancePreferences {
  theme: "light" | "dark" | "system";
  accent: string;
  density: "comfortable" | "compact";
  lastWorkspaceId?: string;
}
export const useAppearance = () =>
  useQuery({
    queryKey: ["appearance"],
    queryFn: async (): Promise<AppearancePreferences> => {
      const data = (await api.get("/api/users/me/profile/")).data as {
        theme?: Record<string, unknown>;
        last_workspace_id?: string;
      };
      const value = data.theme ?? {};
      const selectedTheme = String(value.theme ?? "system");
      return {
        theme: (["light", "dark", "system"].includes(selectedTheme)
          ? selectedTheme
          : "system") as AppearancePreferences["theme"],
        accent: String(value.hamkar_accent ?? "#4F46E5"),
        density: value.hamkar_density === "compact" ? "compact" : "comfortable",
        lastWorkspaceId: data.last_workspace_id ? String(data.last_workspace_id) : undefined,
      };
    },
  });

export const useUpdateAppearance = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<AppearancePreferences>) => {
      const current = (await api.get("/api/users/me/profile/")).data as { theme?: Record<string, unknown> };
      const theme = { ...current.theme };
      if (payload.theme) theme.theme = payload.theme;
      if (payload.accent) theme.hamkar_accent = payload.accent;
      if (payload.density) theme.hamkar_density = payload.density;
      await api.patch("/api/users/me/profile/", { theme });
      return payload;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["appearance"] });
      useUIStore.getState().toast("ترجیحات در پایگاه داده ذخیره شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "ذخیره ترجیحات انجام نشد"), "error"),
  });
};

export const useUserActivities = () =>
  useQuery({
    queryKey: ["user-activities"],
    queryFn: async (): Promise<ActivityItem[]> =>
      unwrap<Record<string, unknown>[]>((await api.get("/api/users/me/activities/")).data).map((item) => ({
        id: String(item.id),
        message: String(item.verb ?? item.field ?? "به‌روزرسانی کار"),
        actor: String((item.actor_detail as { display_name?: string } | undefined)?.display_name ?? "عضو تیم"),
        createdAt: item.created_at ? String(item.created_at) : undefined,
      })),
  });

export const useWorkspaceInvites = (providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["workspace-invites", slug],
    enabled: Boolean(slug),
    retry: false,
    queryFn: async (): Promise<Record<string, unknown>[]> =>
      unwrap<Record<string, unknown>[]>((await api.get(`/api/workspaces/${slug}/invitations/`)).data),
  });
};

export const useProjectMemberCounts = (providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["project-member-counts", slug],
    enabled: Boolean(slug),
    queryFn: async (): Promise<Record<string, number>> => {
      const data = (await api.get(`/api/workspaces/${slug}/project-members/`)).data as Record<
        string,
        Record<string, unknown>[]
      >;
      const counts: Record<string, number> = {};
      Object.values(data)
        .flat()
        .forEach((membership) => {
          const memberId = String(membership.member ?? "");
          counts[memberId] = (counts[memberId] ?? 0) + 1;
        });
      return counts;
    },
  });
};

export interface NotificationPreferences {
  property_change: boolean;
  state_change: boolean;
  comment: boolean;
  mention: boolean;
  issue_completed: boolean;
}
export const useNotificationPreferences = () =>
  useQuery({
    queryKey: ["notification-preferences"],
    queryFn: async (): Promise<NotificationPreferences> =>
      (await api.get("/api/users/me/notification-preferences/")).data,
  });
export const useUpdateNotificationPreferences = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<NotificationPreferences>) =>
      api.patch("/api/users/me/notification-preferences/", payload),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["notification-preferences"] });
      useUIStore.getState().toast("تنظیمات اعلان ذخیره شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "ذخیره اعلان‌ها انجام نشد"), "error"),
  });
};
export const useChangePassword = () =>
  useMutation({
    mutationFn: (payload: { old_password: string; new_password: string }) =>
      api.post("/auth/change-password/", payload),
    onSuccess: () => useUIStore.getState().toast("رمز عبور تغییر کرد"),
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "تغییر رمز عبور انجام نشد"), "error"),
  });

export const useProjects = (providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["projects", slug],
    enabled: Boolean(slug),
    queryFn: async (): Promise<Project[]> =>
      unwrap<Record<string, unknown>[]>((await api.get(`/api/workspaces/${slug}/projects/details/`)).data).map(
        mapProject
      ),
  });
};
export const useProject = (projectId: string, providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["project", slug, projectId],
    enabled: Boolean(slug && projectId),
    queryFn: async () => mapProject((await api.get(`/api/workspaces/${slug}/projects/${projectId}/`)).data),
  });
};
export const useStates = (projectId?: string, providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["states", slug, projectId],
    enabled: Boolean(slug && projectId),
    queryFn: async (): Promise<ProjectState[]> =>
      unwrap<Record<string, unknown>[]>(
        (await api.get(`/api/workspaces/${slug}/projects/${projectId}/states/`)).data
      ).map(mapState),
  });
};
export const useIssues = (providedSlug?: string, projectId?: string) => {
  const slug = useSlug(providedSlug),
    projectsQuery = useProjects(slug);
  return useQuery({
    queryKey: ["issues", slug, projectId ?? "all", projectsQuery.data?.map((p) => p.id).join(",")],
    enabled: Boolean(slug && (projectId || projectsQuery.data)),
    queryFn: async (): Promise<Issue[]> => {
      const [memberResponse, workspaceTaskResponse] = await Promise.all([
        api.get(`/api/workspaces/${slug}/members/`),
        projectId ? Promise.resolve({ data: [] }) : api.get(`/api/workspaces/${slug}/tasks/`),
      ]);
      const members = unwrap<Record<string, unknown>[]>(memberResponse.data).map(mapMember);
      const projectIssues = (
        await Promise.all(
          (projectId ? [projectId] : (projectsQuery.data ?? []).map((p) => p.id)).map(async (id) => {
            const [issueResponse, stateResponse] = await Promise.all([
              api.get(`/api/workspaces/${slug}/projects/${id}/issues/?expand=state,assignees,labels,project`),
              api.get(`/api/workspaces/${slug}/projects/${id}/states/`),
            ]);
            const states = unwrap<Record<string, unknown>[]>(stateResponse.data).map(mapState);
            const identifier = projectsQuery.data?.find((project) => project.id === id)?.identifier;
            return unwrap<Record<string, unknown>[]>(issueResponse.data).map((item) =>
              mapIssue(item, id, states, members, identifier)
            );
          })
        )
      ).flat();
      const workspaceTasks = unwrap<Record<string, unknown>[]>(workspaceTaskResponse.data).map((item) =>
        mapWorkspaceTask(item, members)
      );
      return [...projectIssues, ...workspaceTasks];
    },
  });
};
export const useMembers = (providedSlug?: string, projectId?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["members", slug, projectId ?? "workspace"],
    enabled: Boolean(slug),
    queryFn: async (): Promise<Member[]> => {
      const workspaceRows = unwrap<Record<string, unknown>[]>((await api.get(`/api/workspaces/${slug}/members/`)).data);
      if (!projectId) return workspaceRows.map(mapMember);

      const workspaceMembers = workspaceRows.map(mapMember);
      const projectRows = unwrap<Record<string, unknown>[]>(
        (await api.get(`/api/workspaces/${slug}/projects/${projectId}/members/`)).data
      );
      return projectRows.flatMap((membership) => {
        const memberId = String(membership.member ?? "");
        const member = workspaceMembers.find((candidate) => candidate.id === memberId);
        if (!member) return [];
        return [{ ...member, membershipId: String(membership.id), role: roleName(membership.role) }];
      });
    },
  });
};
export const useNotifications = (providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["notifications", slug],
    enabled: Boolean(slug),
    queryFn: async (): Promise<NotificationItem[]> =>
      unwrap<Record<string, unknown>[]>((await api.get(`/api/workspaces/${slug}/users/notifications/`)).data).map(
        (item) => ({
          id: String(item.id),
          title: String(item.title ?? item.entity_name ?? "اعلان جدید"),
          description: String(item.message_stripped ?? item.title ?? ""),
          time: item.created_at ? String(item.created_at) : "",
          read: Boolean(item.read_at),
          type: item.is_mentioned_notification ? "mention" : "update",
        })
      ),
  });
};
export const useCycles = (projectId: string, providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["cycles", slug, projectId],
    enabled: Boolean(slug && projectId),
    queryFn: async (): Promise<Cycle[]> =>
      unwrap<Record<string, unknown>[]>(
        (await api.get(`/api/workspaces/${slug}/projects/${projectId}/cycles/`)).data
      ).map((item) => ({
        id: String(item.id),
        name: String(item.name),
        description: String(item.description ?? ""),
        startDate: item.start_date ? String(item.start_date) : undefined,
        endDate: item.end_date ? String(item.end_date) : undefined,
        progress: Number(item.progress ?? 0),
      })),
  });
};
export const useActivities = (projectId: string, issues: Issue[], providedSlug?: string) => {
  const slug = useSlug(providedSlug);
  return useQuery({
    queryKey: ["activities", slug, projectId, issues.map((i) => i.id).join(",")],
    enabled: Boolean(slug && issues.length),
    queryFn: async (): Promise<ActivityItem[]> => {
      const rows = (
        await Promise.all(
          issues
            .slice(0, 8)
            .map((issue) =>
              api
                .get(`/api/workspaces/${slug}/projects/${projectId}/issues/${issue.id}/history/`)
                .then(({ data }) => unwrap<Record<string, unknown>[]>(data))
            )
        )
      ).flat();
      return rows.map((item) => ({
        id: String(item.id),
        message: String(item.verb ?? item.field ?? "به‌روزرسانی کار"),
        actor: String((item.actor_detail as { display_name?: string } | undefined)?.display_name ?? "عضو تیم"),
        createdAt: item.created_at ? String(item.created_at) : undefined,
      }));
    },
  });
};

export const useCreateProject = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Pick<Project, "name" | "identifier" | "description">) =>
      mapProject((await api.post(`/api/workspaces/${slug}/projects/`, payload)).data),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["projects", slug] });
      useUIStore.getState().toast("پروژه با موفقیت ساخته شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "ساخت پروژه انجام نشد"), "error"),
  });
};
export const useUpdateProject = (slug: string, projectId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (
      payload: Partial<Pick<Project, "name" | "identifier" | "description" | "targetDate" | "projectLeadId">>
    ) =>
      mapProject(
        (
          await api.patch(`/api/workspaces/${slug}/projects/${projectId}/`, {
            name: payload.name,
            identifier: payload.identifier,
            description: payload.description,
            target_date: payload.targetDate || null,
            project_lead: payload.projectLeadId || null,
          })
        ).data
      ),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["project", slug, projectId] });
      client.invalidateQueries({ queryKey: ["projects", slug] });
      useUIStore.getState().toast("تغییرات پروژه ذخیره شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "ذخیره پروژه انجام نشد"), "error"),
  });
};
export const useArchiveProject = (slug: string, projectId: string, archived = false) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      archived
        ? api.delete(`/api/workspaces/${slug}/projects/${projectId}/archive/`)
        : api.post(`/api/workspaces/${slug}/projects/${projectId}/archive/`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["projects", slug] });
      client.invalidateQueries({ queryKey: ["project", slug, projectId] });
      useUIStore.getState().toast(archived ? "پروژه از بایگانی خارج شد" : "پروژه بایگانی شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "بایگانی پروژه انجام نشد"), "error"),
  });
};
export const useCreateIssue = (slug: string, projectId?: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Pick<Issue, "name" | "priority"> & { targetDate?: string; assigneeId?: string }) => {
      const requestPayload = {
        name: payload.name,
        priority: payload.priority.toLowerCase(),
        target_date: payload.targetDate || null,
      };
      if (!projectId) {
        const response = await api.post(`/api/workspaces/${slug}/tasks/`, {
          ...requestPayload,
          assignee_id: payload.assigneeId,
        });
        return mapWorkspaceTask(response.data, []);
      }
      return mapIssue(
        (
          await api.post(`/api/workspaces/${slug}/projects/${projectId}/issues/`, {
            ...requestPayload,
            assignee_ids: payload.assigneeId ? [payload.assigneeId] : [],
          })
        ).data,
        projectId
      );
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["issues", slug] });
      useUIStore.getState().toast("کار جدید در بک‌اند ذخیره شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "ساخت کار انجام نشد"), "error"),
  });
};
export const useUpdateIssueStatus = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ issue, status }: { issue: Issue; status: Status }) => {
      if (issue.scope === "workspace") {
        const rawStatus = {
          Todo: "todo",
          "In Progress": "in_progress",
          Review: "review",
          Done: "done",
          Blocked: "blocked",
        }[status];
        await api.patch(`/api/workspaces/${slug}/tasks/${issue.id}/`, { status: rawStatus });
        return { issue, status };
      }
      const states = unwrap<Record<string, unknown>[]>(
        (await api.get(`/api/workspaces/${slug}/projects/${issue.projectId}/states/`)).data
      ).map(mapState);
      const target = states.find((state) => state.status === status);
      if (!target) throw new Error("وضعیت متناظر در این پروژه تعریف نشده است");
      await api.patch(`/api/workspaces/${slug}/projects/${issue.projectId}/issues/${issue.id}/`, {
        state_id: target.id,
      });
      return { issue, status };
    },
    onMutate: async ({ issue, status }) => {
      await client.cancelQueries({ queryKey: ["issues", slug] });
      const snapshots = client.getQueriesData<Issue[]>({ queryKey: ["issues", slug] });
      client.setQueriesData<Issue[]>({ queryKey: ["issues", slug] }, (old = []) =>
        old.map((item) => (item.id === issue.id ? { ...item, status } : item))
      );
      return { snapshots };
    },
    onError: (error, _variables, context) => {
      context?.snapshots.forEach(([key, value]) => client.setQueryData(key, value));
      useUIStore.getState().toast(errorMessage(error, "تغییر وضعیت ذخیره نشد"), "error");
    },
    onSuccess: () => useUIStore.getState().toast("وضعیت کار در بک‌اند به‌روزرسانی شد"),
    onSettled: () => client.invalidateQueries({ queryKey: ["issues", slug] }),
  });
};
export const useDeleteIssue = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (issue: Issue) =>
      issue.scope === "workspace"
        ? api.delete(`/api/workspaces/${slug}/tasks/${issue.id}/`)
        : api.delete(`/api/workspaces/${slug}/projects/${issue.projectId}/issues/${issue.id}/`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["issues", slug] });
      useUIStore.getState().toast("کار حذف شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "حذف کار انجام نشد"), "error"),
  });
};
export const useReassignIssue = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ issue, assigneeId }: { issue: Issue; assigneeId: string }) =>
      issue.scope === "workspace"
        ? api.patch(`/api/workspaces/${slug}/tasks/${issue.id}/`, { assignee_id: assigneeId })
        : api.patch(`/api/workspaces/${slug}/projects/${issue.projectId}/issues/${issue.id}/`, {
            assignee_ids: [assigneeId],
          }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["issues", slug] });
      useUIStore.getState().toast("مسئول کار تغییر کرد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "انتقال کار انجام نشد"), "error"),
  });
};
export const useCreateCycle = (slug: string, projectId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; start_date?: string; end_date?: string }) =>
      api.post(`/api/workspaces/${slug}/projects/${projectId}/cycles/`, payload),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["cycles", slug, projectId] });
      useUIStore.getState().toast("چرخه ساخته شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "ساخت چرخه انجام نشد"), "error"),
  });
};
export const useUpdateWorkspace = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string }) => api.patch(`/api/workspaces/${slug}/`, payload),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["workspaces"] });
      useUIStore.getState().toast("مشخصات شرکت ذخیره شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "ذخیره مشخصات شرکت انجام نشد"), "error"),
  });
};
export const useSelectWorkspace = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) => api.patch("/api/users/me/profile/", { last_workspace_id: workspaceId }),
    onMutate: (workspaceId) => {
      const previous = client.getQueryData<AppearancePreferences>(["appearance"]);
      client.setQueryData<AppearancePreferences>(["appearance"], (current) =>
        current ? { ...current, lastWorkspaceId: workspaceId } : current
      );
      return { previous };
    },
    onSuccess: () => useUIStore.getState().toast("فضای کاری فعال ذخیره شد"),
    onError: (error, _workspaceId, context) => {
      client.setQueryData(["appearance"], context?.previous);
      useUIStore.getState().toast(errorMessage(error, "ذخیره شرکت انتخاب‌شده انجام نشد"), "error");
    },
  });
};
export const useInviteMember = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => api.post(`/api/workspaces/${slug}/invitations/`, { emails: [{ email, role: 15 }] }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["workspace-invites", slug] });
      useUIStore.getState().toast("دعوت‌نامه ارسال شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "ارسال دعوت‌نامه انجام نشد"), "error"),
  });
};
export const useCreateWorkspaceUser = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      email: string;
      username: string;
      password?: string;
      display_name: string;
      role: 15 | 20;
    }) => api.post(`/api/workspaces/${slug}/members/`, payload),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["members", slug] });
      client.invalidateQueries({ queryKey: ["project-member-counts", slug] });
      useUIStore.getState().toast("حساب کاربر ساخته و به فضای کاری اضافه شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "ساخت حساب کاربر انجام نشد"), "error"),
  });
};
export const useUpdateMemberRole = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ membershipId, role }: { membershipId: string; role: number }) =>
      api.patch(`/api/workspaces/${slug}/members/${membershipId}/`, { role }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["members", slug] });
      useUIStore.getState().toast("نقش عضو ذخیره شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "تغییر نقش انجام نشد"), "error"),
  });
};
export const useRemoveMember = (slug: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) => api.delete(`/api/workspaces/${slug}/members/${membershipId}/`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["members", slug] });
      useUIStore.getState().toast("عضو از فضای کاری حذف شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "حذف عضو انجام نشد"), "error"),
  });
};
export const useAddProjectMember = (slug: string, projectId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      api.post(`/api/workspaces/${slug}/projects/${projectId}/members/`, {
        members: [{ member_id: memberId, role: 15 }],
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["members", slug, projectId] });
      client.invalidateQueries({ queryKey: ["projects", slug] });
      useUIStore.getState().toast("عضو به پروژه اضافه شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "افزودن عضو به پروژه انجام نشد"), "error"),
  });
};
export const useRemoveProjectMember = (slug: string, projectId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) =>
      api.delete(`/api/workspaces/${slug}/projects/${projectId}/members/${membershipId}/`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["members", slug, projectId] });
      client.invalidateQueries({ queryKey: ["projects", slug] });
      useUIStore.getState().toast("عضو از پروژه حذف شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "حذف عضو پروژه انجام نشد"), "error"),
  });
};
export const useMarkNotificationRead = (providedSlug?: string) => {
  const slug = useSlug(providedSlug),
    client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/workspaces/${slug}/users/notifications/${id}/read/`),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["notifications", slug] });
      useUIStore.getState().toast("اعلان خوانده شد");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "به‌روزرسانی اعلان انجام نشد"), "error"),
  });
};
export const useMarkAllNotificationsRead = (providedSlug?: string) => {
  const slug = useSlug(providedSlug),
    client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/api/workspaces/${slug}/users/notifications/mark-all-read/`, {}),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["notifications", slug] });
      useUIStore.getState().toast("همه اعلان‌ها خوانده شدند");
    },
    onError: (error) => useUIStore.getState().toast(errorMessage(error, "خواندن اعلان‌ها انجام نشد"), "error"),
  });
};
