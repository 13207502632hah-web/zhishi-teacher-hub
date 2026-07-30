export type NavigationItem = {
  group: string;
  href: string;
  icon: string;
  label: string;
};

export const workspaceNavigation: NavigationItem[] = [
  { href: "/workspace", icon: "今", label: "今日", group: "今日" },
  { href: "/lessons", icon: "课", label: "课时", group: "教学" },
  { href: "/assignments", icon: "业", label: "作业中心", group: "教学" },
  { href: "/feedback", icon: "馈", label: "课程反馈", group: "教学" },
  { href: "/feedback-imports", icon: "析", label: "反馈反向解析", group: "教学" },
  { href: "/schedule-imports", icon: "表", label: "课表导入", group: "教学" },
  { href: "/calendar", icon: "历", label: "Apple 日历", group: "教学" },
  { href: "/questions", icon: "题", label: "题库", group: "题库" },
  { href: "/papers", icon: "卷", label: "组卷", group: "题库" },
  { href: "/classes", icon: "生", label: "学生", group: "学情" },
  { href: "/assessments", icon: "测", label: "测验与成绩", group: "学情" },
  { href: "/exam-projects", icon: "考", label: "考试项目", group: "学情" },
  { href: "/recognition", icon: "校", label: "答题卡校对", group: "学情" },
  { href: "/academic-years", icon: "升", label: "学年晋升", group: "学情" },
  { href: "/reflections", icon: "思", label: "教学反思", group: "教研与运营" },
  { href: "/analytics", icon: "数", label: "数据中心", group: "教研与运营" },
  { href: "/resources", icon: "资", label: "资源中心", group: "教研与运营" },
  { href: "/finance", icon: "账", label: "课时结算", group: "教研与运营" },
];

export const utilityNavigation: NavigationItem[] = [
  { href: "/settings", icon: "设", label: "设置", group: "账户" },
  { href: "/mini-settings", icon: "微", label: "微信小程序（暂停）", group: "账户" },
];

export const mobilePrimaryNavigation = [
  { href: "/workspace", icon: "今", label: "今日" },
  { href: "/lessons", icon: "课", label: "课时" },
  { href: "/questions", icon: "题", label: "题库" },
  { href: "/classes", icon: "生", label: "学生" },
] satisfies Array<Pick<NavigationItem, "href" | "icon" | "label">>;

const learnerNavigation: NavigationItem[] = [
  { href: "/portal", icon: "学", label: "我的学习", group: "学习" },
  { href: "/resources", icon: "资", label: "资源中心", group: "学习" },
];

export function navigationForRole(role?: string) {
  if (role === "student" || role === "parent") return learnerNavigation;
  if (role === "assistant") {
    return workspaceNavigation.filter(
      (item) => !["/reflections", "/analytics"].includes(item.href),
    );
  }
  return workspaceNavigation;
}

export function utilitiesForRole(role?: string) {
  if (role === "student" || role === "parent") return [];
  if (role === "assistant") {
    return utilityNavigation.filter((item) => item.href !== "/settings");
  }
  return utilityNavigation;
}
