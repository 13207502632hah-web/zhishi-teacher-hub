"use client";
import { useEffect, useState } from "react";
import { AppShell, EmptyState } from "../components/AppShell";

type Lesson={id:number;date:string;startTime:string;endTime:string;courseName:string;stage:string;grade:string;topic:string;mode:string;location:string;status:string};
const initial={date:new Date().toISOString().slice(0,10),startTime:"",endTime:"",courseName:"思想政治辅导",stage:"高中",grade:"高一",mode:"offline",location:"",textbookVersion:"统编版",volume:"必修三",unit:"",topic:"",teachingGoals:"",keyPoints:"",difficultPoints:"",status:"draft"};
export default function LessonsPage(){
 const [items,setItems]=useState<Lesson[]>([]),[form,setForm]=useState(initial),[open,setOpen]=useState(false),[q,setQ]=useState(""),[error,setError]=useState("");
 const load=async()=>{try{const r=await fetch(`/api/lessons?q=${encodeURIComponent(q)}`);const d=await r.json();setItems(d.lessons||[])}catch{setError("暂时无法读取课时，请稍后重试")}};
 useEffect(()=>{load()},[]);
 const save=async(status:string)=>{setError("");const r=await fetch("/api/lessons",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...form,status})});if(!r.ok){setError((await r.json()).error||"保存失败");return}setOpen(false);setForm(initial);load()};
 const remove=async(id:number)=>{if(!confirm("确认删除这条课时记录？删除后不可恢复。"))return;await fetch(`/api/lessons/${id}`,{method:"DELETE"});load()};
 return <AppShell title="课时记录" subtitle="课程—课时—学生表现—反馈闭环" actions={<button className="primaryButton" onClick={()=>setOpen(true)}>＋ 新建课时</button>}>
  <div className="toolbar"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="搜索课程或课题"/><button onClick={load}>搜索</button><select><option>全部状态</option><option>草稿</option><option>已完成</option></select><select><option>全部学段</option><option>初中</option><option>高中</option></select></div>
  {error&&<p className="formError">{error}</p>}
  <section className="panel tablePanel">{items.length===0?<EmptyState title="还没有课时记录" description="先创建一节真实课程，工作台会自动更新今日课程与待补记录。" action={<button className="secondaryButton" onClick={()=>setOpen(true)}>新建第一节课</button>}/>:<div className="recordList">{items.map(x=><article key={x.id}><div className="dateBlock"><b>{x.date.slice(8)}</b><span>{x.date.slice(0,7)}</span></div><div className="recordInfo"><span className={`statusBadge ${x.status}`}>{x.status==="completed"?"已完成":"草稿"}</span><h3>{x.courseName} · {x.topic||"未填写课题"}</h3><p>{x.startTime||"待定"}–{x.endTime||"待定"}　{x.grade}　{x.mode==="online"?"线上":x.location||"线下"}</p></div><div className="rowActions"><button onClick={()=>window.print()}>打印</button><button onClick={()=>remove(x.id)}>删除</button></div></article>)}</div>}</section>
  {open&&<div className="modalBackdrop"><div className="lessonModal"><div className="modalTitle"><div><p>新建课时</p><h2>记录一节政治课</h2></div><button onClick={()=>setOpen(false)}>×</button></div><div className="formGrid">
   <label>日期<input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label><label>课程名称<input value={form.courseName} onChange={e=>setForm({...form,courseName:e.target.value})}/></label>
   <label>开始时间<input type="time" value={form.startTime} onChange={e=>setForm({...form,startTime:e.target.value})}/></label><label>结束时间<input type="time" value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})}/></label>
   <label>学段<select value={form.stage} onChange={e=>setForm({...form,stage:e.target.value})}><option>初中</option><option>高中</option></select></label><label>年级<select value={form.grade} onChange={e=>setForm({...form,grade:e.target.value})}><option>七年级</option><option>八年级</option><option>九年级</option><option>高一</option><option>高二</option><option>高三</option></select></label>
   <label>教材版本<input value={form.textbookVersion} onChange={e=>setForm({...form,textbookVersion:e.target.value})}/></label><label>册别/模块<input value={form.volume} onChange={e=>setForm({...form,volume:e.target.value})}/></label>
   <label>单元<input value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})}/></label><label>课题<input value={form.topic} onChange={e=>setForm({...form,topic:e.target.value})}/></label>
   <label>授课方式<select value={form.mode} onChange={e=>setForm({...form,mode:e.target.value})}><option value="offline">线下</option><option value="online">线上</option></select></label><label>地点/线上链接<input value={form.location} onChange={e=>setForm({...form,location:e.target.value})}/></label>
   <label className="wide">教学目标<textarea value={form.teachingGoals} onChange={e=>setForm({...form,teachingGoals:e.target.value})}/></label><label>教学重点<textarea value={form.keyPoints} onChange={e=>setForm({...form,keyPoints:e.target.value})}/></label><label>教学难点<textarea value={form.difficultPoints} onChange={e=>setForm({...form,difficultPoints:e.target.value})}/></label>
  </div><div className="modalActions"><button onClick={()=>save("draft")}>保存草稿</button><button className="primaryButton" onClick={()=>save("completed")}>完成课时</button></div></div></div>}
 </AppShell>
}
