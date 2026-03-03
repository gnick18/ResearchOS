declare module "frappe-gantt" {
  interface FrappeTask {
    id: string;
    name: string;
    start: string;
    end: string;
    progress: number;
    dependencies: string;
    custom_class?: string;
  }

  interface FrappeGanttOptions {
    on_click?: (task: FrappeTask) => void;
    on_date_change?: (task: FrappeTask, start: Date, end: Date) => void;
    on_progress_change?: (task: FrappeTask, progress: number) => void;
    on_view_change?: (mode: string) => void;
    view_mode?: string;
    view_modes?: Array<{
      name: string;
      padding: string;
      step: string;
      lower_text: string;
      upper_text: string;
    }>;
    bar_height?: number;
    bar_corner_radius?: number;
    arrow_curve?: number;
    padding?: number;
    column_width?: number;
    date_format?: string;
    move_dependencies?: boolean;
    readonly_progress?: boolean;
    readonly_dates?: boolean;
    snap_at?: string;
    infinite_padding?: boolean;
    holidays?: Record<string, unknown>;
    lines?: string;
    auto_move_label?: boolean;
    scroll_to?: string;
  }

  class Gantt {
    constructor(
      wrapper: string | HTMLElement,
      tasks: FrappeTask[],
      options?: FrappeGanttOptions
    );
    change_view_mode(mode: string): void;
    refresh(tasks: FrappeTask[]): void;
    tasks: {
      append(task: FrappeTask): void;
      refresh(): void;
    };
  }

  export default Gantt;
}
