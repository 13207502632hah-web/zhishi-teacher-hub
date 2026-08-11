"use client";

import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function InstallGuide() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null), [standalone, setStandalone] = useState(false);
  useEffect(() => {
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const listener = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    window.addEventListener("beforeinstallprompt", listener); return () => window.removeEventListener("beforeinstallprompt", listener);
  }, []);
  async function install() { if (!prompt) return; await prompt.prompt(); await prompt.userChoice; setPrompt(null); }
  return <main className="install-page"><section className="install-intro"><span>知</span><p>PHONE READY · PWA</p><h1>把知师研室放到手机主屏幕。</h1><b>不经过应用商店，点开就能记课、查题、看待确认事项；网页端保存的数据会立即进入同一工作室。</b>{standalone ? <div className="install-ok">已从主屏幕模式打开</div> : prompt ? <button onClick={install}>安装到这台设备</button> : <a href="/v2/record">先打开手机记录页</a>}</section><section className="install-steps"><article><i>1</i><h2>iPhone / iPad</h2><p>用 Safari 打开本站，点底部“分享”，选择“添加到主屏幕”，名称保留“知师研室”。</p></article><article><i>2</i><h2>Android</h2><p>用 Chrome 或系统浏览器打开，选择“安装应用”或“添加到主屏幕”。</p></article><article><i>3</i><h2>微信里收到网址</h2><p>先点右上角菜单，选择“在浏览器打开”；iPhone 必须再切到 Safari 才能添加主屏幕。</p></article></section><section className="install-note"><h2>弱网也不会丢记录</h2><p>手机记录页会暂存尚未同步的草稿；断网时还会进入独立离线记录页。联网后再次打开工作台即可自动同步。</p><a href="/teacher-login?return_to=%2Fv2%2Frecord">登录并开始记录 →</a></section></main>;
}
