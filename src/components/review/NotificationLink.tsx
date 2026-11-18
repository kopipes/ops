"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {usePathname} from "next/navigation";
export function NotificationLink({initialCount}:{initialCount:number}) {
  const [unread,setUnread]=useState(initialCount);const pathname=usePathname();
  useEffect(()=>setUnread(initialCount),[initialCount]);
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    const check=async()=>{
      if(document.visibilityState!=="visible")return;
      try{const response=await fetch('/api/notifications',{cache:'no-store',signal:controller.signal});if(response.ok){const data=await response.json();if(active)setUnread(data.unread);}}
      catch{/* Keep the last known count while offline. */}
    };
    const interval=setInterval(()=>void check(),30000);window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);void check();
    return()=>{active=false;controller.abort();clearInterval(interval);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);};
  },[pathname]);
  return <Link href="/notifications" aria-label={`Notifikasi${unread?`, ${unread} belum dibaca`:""}`} className="inline-flex min-h-tap items-center gap-2 rounded-lg px-2 text-xs font-medium text-[var(--accent)]">Notifikasi{unread?<span className="inline-flex min-w-5 justify-center rounded-full bg-[var(--accent-solid)] px-1.5 py-0.5 text-[10px] text-white">{unread>99?"99+":unread}</span>:null}</Link>;
}
