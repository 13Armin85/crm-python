import { useMemo, useState } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { GripVertical, LayoutDashboard, List, Plus, SlidersHorizontal } from "lucide-react";
import { Navigate } from "react-router";
import { useIssues, useUpdateIssueStatus, useWorkspaceAccess } from "../api";
import { Avatar, Button, EmptyState, IssueRow, PageHeader, PriorityBadge, SearchBox, Skeleton } from "../components";
import { useUIStore } from "../store";
import type { Issue, Status } from "../types";
import { statusFa, toFa } from "../utils";

const columns: { id: Status; color: string }[] = [
  { id: "Todo", color: "#9ca3af" },
  { id: "In Progress", color: "#3b82f6" },
  { id: "Review", color: "#8b5cf6" },
  { id: "Done", color: "#10b981" },
  { id: "Blocked", color: "#ef4444" },
];

function KanbanCard({ issue }: { issue: Issue }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: issue.id, data: { issue } });
  return (
    <article
      ref={setNodeRef}
      className={`kanban-card ${isDragging ? "dragging" : ""}`}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
      {...listeners}
      {...attributes}
    >
      <div className="kanban-card-top">
        <span dir="ltr">
          {issue.projectIdentifier}-{toFa(issue.sequenceId)}
        </span>
        <GripVertical size={16} />
      </div>
      <h3>{issue.name}</h3>
      <div className="label-row">
        {issue.labels?.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <footer>
        <PriorityBadge priority={issue.priority} />
        <Avatar member={issue.assignee} size="sm" />
      </footer>
    </article>
  );
}
function KanbanColumn({
  id,
  color,
  issues,
  onCreate,
}: {
  id: Status;
  color: string;
  issues: Issue[];
  onCreate: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} className={`kanban-column ${isOver ? "is-over" : ""}`}>
      <header>
        <span>
          <i style={{ background: color }} />
          {statusFa[id]} <b>{toFa(issues.length)}</b>
        </span>
        <button onClick={onCreate} aria-label={`افزودن کار به ${statusFa[id]}`}>
          <Plus size={16} />
        </button>
      </header>
      <div>
        {issues.map((issue) => (
          <KanbanCard key={issue.id} issue={issue} />
        ))}
        {!issues.length && <p className="column-empty">کار را اینجا رها کنید</p>}
      </div>
    </section>
  );
}

export default function IssuesPage() {
  const [view, setView] = useState<"list" | "board">("list");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status | "all">("all");
  const { data: issues = [], isLoading } = useIssues();
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const updateStatus = useUpdateIssueStatus(slug);
  const setCreate = useUIStore((state) => state.setCreateOpen);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const filtered = useMemo(
    () =>
      issues.filter(
        (issue) =>
          (status === "all" || issue.status === status) &&
          (issue.name.includes(query) || issue.projectIdentifier.toLowerCase().includes(query.toLowerCase()))
      ),
    [issues, query, status]
  );
  const dragEnd = ({ active, over }: DragEndEvent) => {
    const issue = active.data.current?.issue as Issue | undefined;
    if (issue && over && columns.some((column) => column.id === over.id) && issue.status !== over.id)
      updateStatus.mutate({ issue, status: over.id as Status });
  };
  if (accessLoading) return <Skeleton rows={7} />;
  if (!access?.isAdmin) return <Navigate to="/my-work" replace />;
  return (
    <div>
      <PageHeader
        eyebrow="مرکز کارها"
        title="همه کارها"
        description="تمام کارهای فضای کاری را یکجا ببینید و مدیریت کنید"
        actions={
          <Button icon={Plus} onClick={() => setCreate(true, "issue")}>
            کار جدید
          </Button>
        }
      />
      <div className="content-toolbar issues-toolbar">
        <div className="view-switcher">
          <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
            <List size={17} /> لیست
          </button>
          <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>
            <LayoutDashboard size={17} /> برد کانبان
          </button>
        </div>
        <div className="toolbar-actions">
          <SearchBox value={query} onChange={setQuery} placeholder="جستجو در کارها..." />
          <select
            className="select-filter"
            value={status}
            onChange={(event) => setStatus(event.target.value as Status | "all")}
          >
            <option value="all">همه وضعیت‌ها</option>
            {columns.map((column) => (
              <option key={column.id} value={column.id}>
                {statusFa[column.id]}
              </option>
            ))}
          </select>
          <button
            className="filter-button"
            onClick={() => {
              setQuery("");
              setStatus("all");
            }}
          >
            <SlidersHorizontal size={16} /> پاک‌کردن فیلترها
          </button>
        </div>
      </div>
      {isLoading ? (
        <Skeleton rows={7} />
      ) : !filtered.length ? (
        <EmptyState
          title="کاری پیدا نشد"
          description="فیلترها را پاک کنید یا یک کار تازه بسازید."
          action={
            <Button icon={Plus} onClick={() => setCreate(true, "issue")}>
              کار جدید
            </Button>
          }
        />
      ) : view === "list" ? (
        <div className="table-card issue-list-card">
          <div className="issue-list-head">
            <span />
            <span>عنوان کار</span>
            <span>شناسه</span>
            <span>وضعیت</span>
            <span>اولویت</span>
            <span>موعد</span>
            <span>مسئول</span>
          </div>
          {filtered.map((issue) => (
            <IssueRow key={issue.id} issue={issue} table />
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={dragEnd}>
          <div className="kanban-board">
            {columns.map((column) => (
              <KanbanColumn
                key={column.id}
                {...column}
                issues={filtered.filter((issue) => issue.status === column.id)}
                onCreate={() => setCreate(true, "issue")}
              />
            ))}
          </div>
        </DndContext>
      )}
    </div>
  );
}
