import type { AnchorHTMLAttributes, ReactNode } from "react";

type HardNavigationLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  children: ReactNode;
  href: string;
  prefetch?: boolean;
};

export default function HardNavigationLink({ href, prefetch, ...props }: HardNavigationLinkProps) {
  void prefetch;
  return <a href={href} {...props} />;
}
