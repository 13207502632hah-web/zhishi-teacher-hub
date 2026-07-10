"use client";

import { useState } from "react";

const courses = [
  ["初中·道德与法治", "九年级上册｜第五课 守望精神家园", "12 个素材包", "绿色"],
  ["高中·思想政治", "必修三｜全过程人民民主", "8 个题组", "蓝色"],
  ["初中·语文", "八年级下册｜演讲稿表达训练", "6 份教案", "橙色"],
];

export default function Home() {
  const [saved, setSaved] = useState(false);
  return (
    <main>
      <section className="hero">
        <nav><div className="brand"><span>知</span>师研室</div><div className="navlinks"><a href="#tools">教学工具</a><a href="#courses">课程资源</a><a href="#community">教研社群</a></div><button className="ghost">登录</button></nav>
        <div className="heroGrid">
          <div className="heroCopy"><p className="eyebrow">为每一堂好课，留出更多创造力</p><h1>让教学准备<br/><i>更从容一点</i></h1><p className="intro">面向初高中教师的一站式教学工作台。备课、组卷、班级管理与教研灵感，都在这里有条不紊地发生。</p><div className="actions"><a className="primary" href="#tools">开始今天的教学</a><button className="textButton" onClick={() => setSaved(true)}>{saved ? "已加入我的工作台" : "收藏我的常用工具"}</button></div><div className="trust"><b>12,800+</b> 位一线教师正在使用　 <b>4.9 / 5</b> 教师推荐</div></div>
          <div className="heroPanel"><div className="panelTop"><span>今天 · 星期五</span><b>教学安排</b><span className="dot"></span></div><div className="agenda"><div className="time">08:20</div><div className="agendaCard green"><b>九年级 · 道德与法治</b><small>《守望精神家园》公开课</small></div><div className="time">14:00</div><div className="agendaCard blue"><b>教研组备课会</b><small>期末复习单元设计</small></div></div><div className="panelFoot"><span>本周完成度</span><strong>72%</strong><div><i></i></div></div></div>
        </div>
      </section>
      <section id="tools" className="tools"><div className="sectionHead"><p className="eyebrow">TEACH SMARTER</p><h2>把时间还给真正重要的事</h2><p>从课前准备到课后反馈，围绕真实教学节奏设计。</p></div><div className="toolGrid"><article><em>01</em><h3>备课灵感库</h3><p>按学段、学科与课标检索。把优质案例变成自己的课堂设计。</p><a href="#courses">浏览资源 →</a></article><article className="featured"><em>02</em><h3>轻量组卷</h3><p>题型、难度、知识点一键筛选，支持生成课堂练习与周测。</p><a href="#courses">去组一份卷 →</a></article><article><em>03</em><h3>学情记录</h3><p>留住每个学生的课堂表现，让反馈更具体，成长看得见。</p><a href="#community">查看班级 →</a></article></div></section>
      <section id="courses" className="courses"><div className="courseIntro"><p className="eyebrow">本周精选</p><h2>从一份好资源，<br/>开始一节好课。</h2><p>贴近教材、对应课标、方便二次编辑。<br/>每一份内容，都为课堂而生。</p><button className="outline">查看全部资源</button></div><div className="courseList">{courses.map(([tag, title, meta, color]) => <article className="course" key={title}><span className={`courseTag ${color}`}>{tag}</span><h3>{title}</h3><p>{meta}<span>　·　可编辑</span></p><button aria-label={`打开${title}`}>↗</button></article>)}</div></section>
      <section id="community" className="community"><div><p className="eyebrow">同路者的力量</p><h2>不止一个人的<br/>教学现场。</h2></div><div className="quote"><p>“以前备课总是一个人反复琢磨。现在我能更快找到合适的切入点，把精力放在和学生真实的互动上。”</p><div><span>林老师</span>　高中政治教师 · 天津</div></div><div className="numbers"><div><b>36</b><span>个学科教研圈</span></div><div><b>2.4k</b><span>本周新分享</span></div><div><b>89%</b><span>教师每周回访</span></div></div></section>
      <footer><div className="brand"><span>知</span>师研室</div><p>为认真教学的人，做一点有温度的工具。</p><a href="#tools">回到顶部 ↑</a></footer>
    </main>
  );
}
