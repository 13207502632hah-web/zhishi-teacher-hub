const api = require("../../utils/api");

Page({
  data: {
    role: "student",
    applicantName: "",
    studentName: "",
    classOrGrade: "",
    relationship: "",
    busy: false,
    message: "",
    error: "",
  },
  chooseRole(event) {
    this.setData({ role: event.currentTarget.dataset.role, message: "", error: "" });
  },
  input(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },
  async submit() {
    if (this.data.busy) return;
    const role = this.data.role;
    const studentName = this.data.studentName.trim();
    const classOrGrade = this.data.classOrGrade.trim();
    const applicantName = role === "student" ? studentName : this.data.applicantName.trim();
    const relationship = role === "parent" ? this.data.relationship.trim() : "";
    if (!studentName || !classOrGrade || !applicantName || (role === "parent" && !relationship)) {
      this.setData({ error: role === "parent" ? "请完整填写家长称呼、孩子姓名、班级或年级和关系" : "请填写学生姓名和班级或年级" });
      return;
    }
    this.setData({ busy: true, message: "", error: "" });
    try {
      await api.request("/api/v2/mini/registrations", {
        method: "POST",
        data: { role, applicantName, studentName, classOrGrade, relationship },
      });
      this.setData({ message: "注册申请已提交，教师批准后即可使用" });
      setTimeout(() => wx.navigateBack(), 1200);
    } catch (error) {
      this.setData({ error: error.error || "注册申请提交失败" });
    } finally {
      this.setData({ busy: false });
    }
  },
});
