"use client";

import Link from "@/app/components/HardNavigationLink";
import { useEffect, useRef, useState } from "react";
import type { Session } from "./SessionProvider";
import {
  mobilePrimaryNavigation,
  type NavigationItem,
} from "./navigation";
import { BRAND_MARK, BRAND_NAME, WORKSPACE_TITLE } from "@/app/lib/brand";

type WorkspaceNavigationProps = {
  items: NavigationItem[];
  pathname: string;
  session: Session;
  utilityItems: NavigationItem[];
};

const primaryHrefs = new Set(mobilePrimaryNavigation.map((item) => item.href));

const isActivePath = (pathname: string, href: string) =>
  pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

const grouped = (items: NavigationItem[]) =>
  [...new Set(items.map((item) => item.group))].map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  }));

export function WorkspaceNavigation({
  items,
  pathname,
  session,
  utilityItems,
}: WorkspaceNavigationProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const learner = session.role === "student" || session.role === "parent";
  const primaryItems = learner
    ? items
    : mobilePrimaryNavigation.filter((primary) =>
        items.some((item) => item.href === primary.href),
      );
  const drawerItems = learner
    ? utilityItems
    : [...items.filter((item) => !primaryHrefs.has(item.href)), ...utilityItems];
  const drawerGroups = grouped(drawerItems);
  const drawerActive = drawerItems.some((item) => isActivePath(pathname, item.href));

  useEffect(() => {
    if (!drawerOpen) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    const inertRegions = [
      document.querySelector<HTMLElement>(".appMain"),
      document.querySelector<HTMLElement>(".mobileTabBar"),
    ].filter((region): region is HTMLElement => Boolean(region));
    const previousInertValues = inertRegions.map((region) => region.inert);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawerOpen(false);
      }
    };
    inertRegions.forEach((region) => {
      region.inert = true;
    });
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      inertRegions.forEach((region, index) => {
        region.inert = previousInertValues[index];
      });
      trigger?.focus();
    };
  }, [drawerOpen]);

  return (
    <>
      <aside className="workspaceSidebar">
        <Link href="/" className="workspaceBrand">
          <span>{BRAND_MARK}</span>
          <div>
            <b>{BRAND_NAME}</b>
            <small>{WORKSPACE_TITLE}</small>
          </div>
        </Link>

        <nav className="workspaceSidebar__nav" aria-label="主导航">
          {grouped(items).map(({ group, items: groupItems }) => (
            <section className="workspaceNavGroup" key={group}>
              <b>{group}</b>
              {groupItems.map((item) => (
                <NavigationLink item={item} pathname={pathname} key={item.href} />
              ))}
            </section>
          ))}
        </nav>

        {utilityItems.length > 0 && (
          <nav className="workspaceSidebar__utilities" aria-label="工作台辅助导航">
            {utilityItems.map((item) => (
              <NavigationLink item={item} pathname={pathname} key={item.href} />
            ))}
          </nav>
        )}

        <div className="workspaceProfile">
          <span>{session.user?.name?.slice(0, 1) || "访"}</span>
          <div>
            <b>{session.user?.name || "公开访客"}</b>
            <small>{session.roleName || "公开资源"} · 个人工作区</small>
          </div>
          {session.authenticated && (
            <Link aria-label="退出登录" href="/api/auth/logout?return_to=%2Fresources">
              退出
            </Link>
          )}
        </div>
      </aside>

      <nav
        className={learner ? "mobileTabBar mobileTabBar--learner" : "mobileTabBar"}
        aria-label="移动端主导航"
      >
        {primaryItems.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={active ? "active" : undefined}
              href={item.href}
              key={item.href}
            >
              <NavigationIcon value={item.icon} />
              <span>{item.label}</span>
            </Link>
          );
        })}
        {!learner && (
          <button
            aria-controls="mobile-more-drawer"
            aria-expanded={drawerOpen}
            className={drawerActive ? "active" : undefined}
            onClick={() => setDrawerOpen(true)}
            ref={triggerRef}
            type="button"
          >
            <NavigationIcon value="••" />
            <span>更多</span>
          </button>
        )}
      </nav>

      {drawerOpen && (
        <div
          className="mobileNavBackdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDrawerOpen(false);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="mobile-more-title"
            aria-modal="true"
            className="mobileNavDrawer"
            id="mobile-more-drawer"
            role="dialog"
          >
            <header>
              <div>
                <p>{BRAND_NAME}</p>
                <h2 id="mobile-more-title">更多功能</h2>
              </div>
              <button
                aria-label="关闭更多功能"
                autoFocus
                onClick={() => setDrawerOpen(false)}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="mobileNavDrawer__groups">
              {drawerGroups.map(({ group, items: groupItems }) => (
                <section key={group}>
                  <h3>{group}</h3>
                  <div>
                    {groupItems.map((item) => (
                      <NavigationLink
                        item={item}
                        pathname={pathname}
                        key={item.href}
                        onNavigate={() => setDrawerOpen(false)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function NavigationLink({
  item,
  onNavigate,
  pathname,
}: {
  item: NavigationItem;
  onNavigate?: () => void;
  pathname: string;
}) {
  const active = isActivePath(pathname, item.href);
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={active ? "active" : undefined}
      href={item.href}
      onClick={onNavigate}
    >
      <NavigationIcon value={item.icon} />
      <span>{item.label}</span>
    </Link>
  );
}

export function NavigationIcon({ value }: { value: string }) {
  return (
    <i className="workspaceNavIcon" aria-hidden="true">
      {value}
    </i>
  );
}
