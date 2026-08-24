export type NavigationItem = {
  group: string;
  href: string;
  icon: string;
  label: string;
};

export const workspaceNavigation: NavigationItem[] = [
  { href: "/v2", icon: "今", label: "今日", group: "今日" },
  { href: "/v2/modules/students?view=lessons", icon: "课", label: "课时", group: "教学" },
  { href: "/v2/modules/assignments", icon: "业", label: "作业中心", group: "教学" },
  { href: "/v2/modules/learning?view=feedback", icon: "馈", label: "课程反馈", group: "教学" },
  { href: "/v2/operations?tab=imports", icon: "析", label: "反馈反向解析", group: "教学" },
  { href: "/v2/schedule-imports", icon: "表", label: "课表导入", group: "教学" },
  { href: "/v2/operations?tab=calendar", icon: "历", label: "Apple 日历", group: "教学" },
  { href: "/v2/questions", icon: "题", label: "题库", group: "题库" },
  { href: "/v2/modules/papers", icon: "卷", label: "组卷", group: "题库" },
  { href: "/v2/modules/students", icon: "生", label: "学生", group: "学情" },
  { href: "/v2/operations?tab=assessments", icon: "测", label: "测验与成绩", group: "学情" },
  { href: "/v2/operations?tab=exams", icon: "考", label: "考试项目", group: "学情" },
  { href: "/v2/operations?tab=recognition", icon: "校", label: "答题卡校对", group: "学情" },
  { href: "/v2/operations?tab=academic", icon: "升", label: "学年晋升", group: "学情" },
  { href: "/v2/modules/learning?view=reflections", icon: "思", label: "教学反思", group: "教研与运营" },
  { href: "/v2/modules/learning?view=analytics", icon: "数", label: "数据中心", group: "教研与运营" },
  { href: "/v2/modules/resources", icon: "资", label: "资源中心", group: "教研与运营" },
  { href: "/v2/modules/finance", icon: "账", label: "课时结算", group: "教研与运营" },
];

export const utilityNavigation: NavigationItem[] = [
  { href: "/v2/settings", icon: "设", label: "设置", group: "账户" },
];

export const mobilePrimaryNavigation = [
  { href: "/v2", icon: "今", label: "今日" },
  { href: "/v2/modules/students?view=lessons", icon: "课", label: "课时" },
  { href: "/v2/questions", icon: "题", label: "题库" },
  { href: "/v2/modules/students", icon: "生", label: "学生" },
] satisfies Array<Pick<NavigationItem, "href" | "icon" | "label">>;

export function navigationForRole(role?: string) {
  if (role === "assistant") {
    return workspaceNavigation.filter(
      (item) =>
        ![
          "/v2/modules/learning?view=reflections",
          "/v2/modules/learning?view=analytics",
          "/v2/operations?tab=imports",
          "/v2/operations?tab=calendar",
          "/v2/operations?tab=assessments",
          "/v2/operations?tab=exams",
          "/v2/operations?tab=recognition",
          "/v2/operations?tab=academic",
          "/v2/modules/finance",
        ].includes(item.href),
    );
  }
  return workspaceNavigation;
}

export function utilitiesForRole(role?: string) {
  if (role === "student" || role === "parent") return [];
  if (role === "assistant") {
    return utilityNavigation.filter((item) => item.href !== "/v2/settings");
  }
  return utilityNavigation;
}
