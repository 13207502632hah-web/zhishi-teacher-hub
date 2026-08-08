import Link from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";

type HardNavigationLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  children: ReactNode;
  href: string;
  prefetch?: boolean;
};

export default function HardNavigationLink({ href, prefetch, ...props }: HardNavigationLinkProps) {
  return <Link href={href} prefetch={prefetch} {...props} />;
}
