"use client";

import { useEffect, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Panel, StatusBadge } from "../components/ui/Primitives";
import { HttpError, requestJson } from "../lib/http-client";
import { BRAND_NAME, TEACHER_DISPLAY_NAME } from "../lib/brand";

type CalendarSubscription = {
  id?: number;
  label?: string;
  reminderMinutes?: number;
  createdAt?: string;
};
type BusyAction = "" | "load" | "create" | "copy";

const errorMessage = (reason: unknown, fallback: string) =>
  reason instanceof HttpError ? reason.message : fallback;

const displayDate = (value?: string) => {
  if (!value) return "时间待确认";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export default function CalendarPage() {
  const [url, setUrl] = useState("");
  const [subscription, setSubscription] = useState<CalendarSubscription | null>(null);
  const [message, setMessage] = useState("");
  const [subscriptionLoadError, setSubscriptionLoadError] = useState("");
  const [busyAction, setBusyAction] = useState<BusyAction>("load");
  const [reloadKey, setReloadKey] = useState(0);
  const [addressSaved, setAddressSaved] = useState(false);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const busy = Boolean(busyAction);
  const hasActiveSubscription = Boolean(subscription || url);
  const webcalUrl = url ? url.replace(/^https:/, "webcal:") : "";

  useEffect(() => {
    const controller = new AbortController();
    setBusyAction("load");
    setSubscriptionLoadError("");
    void requestJson<{ subscription?: CalendarSubscription | null }>(
      "/api/calendar/subscription",
      { signal: controller.signal },
    ).then((data) => {
      if (!data) throw new HttpError(200, "订阅状态响应为空，请重试");
      setSubscription(data.subscription || null);
    }).catch((reason) => {
      if (!controller.signal.aborted) {
        setSubscriptionLoadError(errorMessage(reason, "暂时无法读取订阅状态"));
      }
    }).finally(() => {
      if (!controller.signal.aborted) setBusyAction("");
    });
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    const protectPrivateAddress = (event: BeforeUnloadEvent) => {
      if (!url || addressSaved) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectPrivateAddress);
    return () => window.removeEventListener("beforeunload", protectPrivateAddress);
  }, [addressSaved, url]);

  const create = async () => {
    if (busy) return;
    if (
      hasActiveSubscription &&
      !window.confirm("重新生成会立即使旧日历订阅地址失效。请先确认所有设备都可以改用新地址，是否继续？")
    ) {
      return;
    }

    setBusyAction("create");
    setMessage("");
    try {
      const data = await requestJson<{
        path?: string;
        subscription?: CalendarSubscription;
      }>("/api/calendar/subscription", { method: "POST" });
      if (!data?.path) {
        throw new HttpError(200, "订阅地址响应不完整，请检查订阅状态");
      }
      const full = new URL(data.path, window.location.origin).toString();
      setUrl(full);
      setSubscription(data.subscription || {
        label: "Apple 日历",
        reminderMinutes: 30,
        createdAt: new Date().toISOString(),
      });
      setAddressSaved(false);
      setMessage("新的私人订阅地址已生成。请立即复制或添加到 Apple 日历，离开后无法再次查看完整地址。");
      window.requestAnimationFrame(() => copyButtonRef.current?.focus());
    } catch (reason) {
      setMessage(errorMessage(reason, "生成订阅地址失败，原订阅不会因本次失败而失效"));
    } finally {
      setBusyAction("");
    }
  };

  const copy = async () => {
    if (!url || busy) return;
    setBusyAction("copy");
    try {
      await navigator.clipboard.writeText(url);
      setAddressSaved(true);
      setMessage("订阅地址已复制。请粘贴到自己的 Apple 日历，勿转发给他人。");
    } catch {
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
      setMessage("浏览器未能写入剪贴板，请手动选择并复制完整地址。");
    } finally {
      setBusyAction("");
    }
  };

  const markAddressSaved = () => {
    setAddressSaved(true);
    setMessage("已打开添加或下载操作。该地址仍是私人凭据，请勿转发。");
  };

  return (
    <AppShell
      title="Apple 日历"
      subtitle="把已确认课时单向同步到个人日历，默认提前 30 分钟提醒"
    >
      <div className="calendarPage">
        {subscriptionLoadError && (
          <div className="calendarLoadError" role="alert">
            <div>
              <strong>订阅状态读取失败</strong>
              <p>{subscriptionLoadError}</p>
            </div>
            <button
              className="secondaryButton"
              disabled={busy}
              onClick={() => setReloadKey((value) => value + 1)}
            >
              重新读取订阅状态
            </button>
          </div>
        )}

        {message && <div className="calendarNotice" role="status">{message}</div>}

        <Panel
          className="calendarSubscriptionPanel"
          eyebrow="私人只读订阅"
          title="课程日历地址"
          description="日历只从网站同步到 Apple 设备；在日历中修改事件不会反向改动课时。"
          actions={(
            <StatusBadge tone={hasActiveSubscription ? "success" : "neutral"}>
              {busyAction === "load"
                ? "正在检查"
                : hasActiveSubscription
                  ? "订阅已启用"
                  : "尚未启用"}
            </StatusBadge>
          )}
        >
          <div className="calendarPrivacy">
            <span aria-hidden="true">私</span>
            <div>
              <b>地址本身就是访问凭据</b>
              <p>事件会显示学生姓名（无姓名时显示课程类型）、课程、时间和地点；不包含课时费、联系方式、反馈或作业。请只添加到{TEACHER_DISPLAY_NAME}自己的设备。</p>
            </div>
          </div>

          {subscription && !url && (
            <div className="calendarActiveSummary">
              <div>
                <span>当前状态</span>
                <b>{subscription.label || "Apple 日历"}正在同步</b>
              </div>
              <div>
                <span>提醒</span>
                <b>提前 {subscription.reminderMinutes ?? 30} 分钟</b>
              </div>
              <div>
                <span>启用时间</span>
                <b>{displayDate(subscription.createdAt)}</b>
              </div>
              <p>为保护私人教学安排，完整地址只在生成当次显示。如果没有保存，请重新生成并替换所有设备上的旧地址。</p>
            </div>
          )}

          {url && (
            <div className="calendarAddress">
              <label htmlFor="calendar-private-address">新生成的私人订阅地址</label>
              <div>
                <input
                  id="calendar-private-address"
                  readOnly
                  ref={addressInputRef}
                  value={url}
                />
                <button
                  className="primaryButton"
                  disabled={busy}
                  onClick={() => void copy()}
                  ref={copyButtonRef}
                >
                  {busyAction === "copy" ? "正在复制…" : "复制地址"}
                </button>
              </div>
              <div className="calendarAddressActions">
                <a href={webcalUrl} onClick={markAddressSaved}>
                  在 Apple 日历中打开
                </a>
                <a
                  download={`${BRAND_NAME}课程日历.ics`}
                  href={url}
                  onClick={markAddressSaved}
                >
                  下载当前日历文件
                </a>
              </div>
              <p>“添加订阅”会持续同步；下载的是当前快照，之后的课时调整不会自动更新。</p>
            </div>
          )}

          <div className="calendarPrimaryAction">
            <button
              className={hasActiveSubscription ? "secondaryButton" : "primaryButton"}
              disabled={busy}
              onClick={() => void create()}
            >
              {busyAction === "create"
                ? "正在安全生成…"
                : hasActiveSubscription
                  ? "重新生成并撤销旧地址"
                  : "生成私人订阅地址"}
            </button>
            {hasActiveSubscription && (
              <p>重新生成后，所有使用旧地址的设备会停止更新。</p>
            )}
          </div>
        </Panel>

        <Panel
          className="calendarGuide"
          eyebrow="添加步骤"
          title="在 iPhone 或 Mac 上订阅"
          description="推荐使用“在 Apple 日历中打开”；如果设备没有响应，再手动复制地址。"
        >
          <ol>
            <li>
              <span>1</span>
              <div><b>生成并保存地址</b><p>复制到安全位置，或直接点击“在 Apple 日历中打开”。</p></div>
            </li>
            <li>
              <span>2</span>
              <div><b>添加订阅账户</b><p>iPhone：设置 → App → 日历 → 日历账户 → 添加账户 → 其他 → 添加已订阅的日历。</p></div>
            </li>
            <li>
              <span>3</span>
              <div><b>确认同步</b><p>粘贴地址并保存。课程调整会更新同一事件，不会重复创建。</p></div>
            </li>
          </ol>
        </Panel>
      </div>
    </AppShell>
  );
}
