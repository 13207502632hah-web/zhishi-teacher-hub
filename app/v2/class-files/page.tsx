import { ClassFilesWorkspace } from "./ClassFilesWorkspace";

export default function ClassFilesPage() {
  return <><section className="v2-hero"><div><p className="v2-eyebrow">PRIVATE CLASS DRIVE · AUTHENTICATED DELIVERY</p><h2>班级网盘</h2><p>课件、讲义、表格与示范音频保存在私有文件桶；发布前是教师草稿，批准后仅当前班级的学生和家长可以下载。</p></div><div className="v2-hero-actions"><a className="v2-primary" href="#upload-class-file">上传班级资料</a><a className="v2-secondary" href="/v2/approvals">查看待确认</a></div></section><ClassFilesWorkspace/></>;
}
