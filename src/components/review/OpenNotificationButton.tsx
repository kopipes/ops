"use client";
import {useState} from "react";
import {openNotificationAction} from "@/app/notifications/actions";
export function OpenNotificationButton({id,kind="point"}:{id:string;kind?:"point"|"photo"}) {
  const [pending,setPending]=useState(false),[error,setError]=useState("");
  return <form className="mt-3" action={async data=>{
    setPending(true);setError("");try{const result=await openNotificationAction(data);if(result.href){window.location.assign(result.href);return;}setError(result.error??"Notifikasi tidak tersedia.");}
    catch{setError("Tidak dapat membuka notifikasi. Coba lagi.");}setPending(false);
  }}><input type="hidden" name="notificationId" value={id}/><input type="hidden" name="kind" value={kind}/><button disabled={pending} className="btn-secondary text-xs">{pending?"Membuka…":kind==="photo"?"Buka foto →":"Buka poin checklist →"}</button>{error?<p role="alert" className="mt-2 text-xs text-red-700">{error}</p>:null}</form>;
}
