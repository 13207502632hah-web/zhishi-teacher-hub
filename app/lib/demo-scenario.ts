export const DEMO_SCENARIO_VERSION = "demo-comprehensive-v2";

export const demoLessonScenarios = [
  { offsetDays: -28, status: "completed", mode: "offline", location: "和平校区 A201", startTime: "09:00", endTime: "11:00", topic: "坚持宪法至上", unit: "第一单元", knowledge: "宪法的地位与作用" },
  { offsetDays: -21, status: "completed", mode: "online", location: "腾讯会议（演示）", startTime: "19:00", endTime: "20:30", topic: "依法行使权利", unit: "第二单元", knowledge: "权利与义务" },
  { offsetDays: -14, status: "completed", mode: "offline", location: "河西校区 B305", startTime: "14:00", endTime: "16:00", topic: "全过程人民民主", unit: "第二单元", knowledge: "人民当家作主" },
  { offsetDays: -10, status: "completed", mode: "offline", location: "和平校区 A201", startTime: "09:00", endTime: "11:00", topic: "法治政府建设", unit: "第四单元", knowledge: "依法行政" },
  { offsetDays: -7, status: "completed", mode: "online", location: "腾讯会议（演示）", startTime: "19:00", endTime: "20:30", topic: "人民代表大会制度", unit: "第二单元", knowledge: "我国的根本政治制度" },
  { offsetDays: -3, status: "completed", mode: "offline", location: "南开校区 C102", startTime: "18:30", endTime: "20:30", topic: "公民参与民主生活", unit: "第三单元", knowledge: "民主决策与民主监督" },
  { offsetDays: -1, status: "completed", mode: "offline", location: "河西校区 B305", startTime: "14:00", endTime: "16:00", topic: "坚持党的领导", unit: "第一单元", knowledge: "党的领导地位" },
  { offsetDays: 0, status: "scheduled", mode: "offline", location: "和平校区 A201", startTime: "18:30", endTime: "20:30", topic: "凝聚法治共识", unit: "第四单元", knowledge: "厉行法治" },
  { offsetDays: 2, status: "scheduled", mode: "online", location: "腾讯会议（演示）", startTime: "19:00", endTime: "20:30", topic: "民族区域自治制度", unit: "第二单元", knowledge: "基本政治制度" },
  { offsetDays: 4, status: "rescheduled", mode: "offline", location: "南开校区 C102", startTime: "09:00", endTime: "11:00", topic: "共同富裕", unit: "第一单元", knowledge: "共享发展成果" },
  { offsetDays: 6, status: "cancelled", mode: "offline", location: "河西校区 B305", startTime: "14:00", endTime: "16:00", topic: "基层群众自治制度", unit: "第二单元", knowledge: "基层民主" },
  { offsetDays: 8, status: "makeup", mode: "online", location: "腾讯会议（演示）", startTime: "19:00", endTime: "20:30", topic: "材料分析答题训练", unit: "综合复习", knowledge: "材料信息提取与规范表述" },
] as const;

export const demoAttendanceStatuses = ["present", "present", "late", "leave", "absent"] as const;
export const demoSubmissionStatuses = ["completed", "submitted", "revision", "pending", "completed"] as const;
export const demoFeedbackStatuses = ["draft", "confirmed", "sent"] as const;

export const demoQuestionScenarios = [
  { type: "单选题", stage: "初中", grade: "九年级", topic: "坚持宪法至上", knowledge: "宪法的地位", score: 3 },
  { type: "多选题", stage: "高中", grade: "高一", topic: "全过程人民民主", knowledge: "人民民主的特点", score: 4 },
  { type: "判断题", stage: "初中", grade: "九年级", topic: "权利与义务", knowledge: "权利义务相统一", score: 2 },
  { type: "填空题", stage: "高中", grade: "高一", topic: "党的领导", knowledge: "党的领导地位", score: 2 },
  { type: "简答题", stage: "初中", grade: "九年级", topic: "厉行法治", knowledge: "全面依法治国", score: 6 },
  { type: "材料题", stage: "高中", grade: "高一", topic: "人民代表大会制度", knowledge: "根本政治制度", score: 10 },
  { type: "辨析题", stage: "初中", grade: "九年级", topic: "民主生活", knowledge: "民主决策与监督", score: 8 },
  { type: "论述题", stage: "高中", grade: "高一", topic: "法治中国", knowledge: "党的领导人民当家作主依法治国", score: 12 },
  { type: "探究实践题", stage: "初中", grade: "九年级", topic: "社会生活", knowledge: "公共参与", score: 10 },
] as const;

export const demoResourceScenarios = [
  { title: "【演示】材料分析题四步法", type: "教学策略", tags: "演示数据,材料分析,规范答题", content: "读设问、圈材料、联教材、分层作答。课堂上先示范一次，再让学生用同一框架独立完成。" },
  { title: "【演示】课后反馈核对清单", type: "规范话术", tags: "演示数据,课程反馈", content: "只写课堂记录能够支持的事实；不确定处写“信息不足”；作业建议必须可执行、可检查。" },
  { title: "【演示】错题复盘卡", type: "备课素材", tags: "演示数据,错题,学情", content: "记录原答案、错误原因、对应知识点、正确思路和一周后的再测结果。" },
] as const;

export function demoIsoDate(offsetDays: number, base = new Date()) {
  const value = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + offsetDays, 12));
  return value.toISOString().slice(0, 10);
}
