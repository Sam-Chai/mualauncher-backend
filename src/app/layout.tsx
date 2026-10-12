import type { Metadata } from "next";
import { AppThemeProvider } from "@/components/preferences";
import "./globals.css";

export const metadata: Metadata = {
  title: "MUA Platform",
  description: "MUA 高校联盟服务器与客户端管理面板",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: 'document.documentElement.lang=document.cookie.split("; ").includes("mua-locale=en-US")?"en-US":"zh-CN";try{if(localStorage.getItem("mua-theme")==="dark")document.documentElement.classList.add("dark")}catch{}' }} /></head>
      <body><AppThemeProvider>{children}</AppThemeProvider></body>
    </html>
  );
}
