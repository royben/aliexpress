"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive, Boxes, Camera, ChevronRight, CircleHelp, FolderTree, ImagePlus,
  CheckCircle2, ExternalLink, Globe2, LayoutDashboard, LoaderCircle, Menu, MoreHorizontal, RefreshCw, Search, Settings,
  Sparkles, Square, Upload
} from "lucide-react";

type CameraDevice = { deviceId:string; label:string };
type Selection = {x:number;y:number;width:number;height:number};
type DragMode = "move"|"nw"|"ne"|"sw"|"se";
type VisualAnalysis = {likely_name:string;category:string;description:string;visible_text:string[];markings:string[];visual_features:string[];search_terms:string[];marketplace_search_query:string;confidence:number};
type Match = {item_id:number;confidence:number;reason:string;similarities:string[];differences:string[];item:{id:number;serial:string;title:string;category:string;image:string;source:string}};
type WebResult = {provider:string;text:string};

function normalizeWebResult(value:unknown):WebResult|null{
  if(!value||typeof value!=="object")return null;
  const result=value as Partial<WebResult>;
  return {provider:String(result.provider||"AI product analysis"),text:String(result.text||"")};
}

export default function IdentifyPage(){
  const videoRef=useRef<HTMLVideoElement>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const uploadRef=useRef<HTMLInputElement>(null);
  const[cameras,setCameras]=useState<CameraDevice[]>([]);
  const[selectedCamera,setSelectedCamera]=useState("");
  const[running,setRunning]=useState(false);
  const[captured,setCaptured]=useState<string|null>(null);
  const[scanned,setScanned]=useState(false);
  const[error,setError]=useState("");
  const[identifying,setIdentifying]=useState(false);
  const[analysis,setAnalysis]=useState<VisualAnalysis|null>(null);
  const[matches,setMatches]=useState<Match[]>([]);
  const[noMatchReason,setNoMatchReason]=useState("");
  const[marketplaceQuery,setMarketplaceQuery]=useState("");
  const[webResult,setWebResult]=useState<WebResult|null>(null);
  const[searchingWeb,setSearchingWeb]=useState(false);
  const[confirmedId,setConfirmedId]=useState<number|null>(null);
  const[addingCapturedImage,setAddingCapturedImage]=useState(false);
  const[capturedImageAdded,setCapturedImageAdded]=useState(false);
  const[capturedImageMessage,setCapturedImageMessage]=useState("");
  const[selection,setSelection]=useState<Selection>({x:.18,y:.14,width:.64,height:.72});
  const dragRef=useRef<{mode:DragMode;startX:number;startY:number;initial:Selection}|null>(null);

  const stopCamera=useCallback(()=>{
    streamRef.current?.getTracks().forEach(track=>track.stop());
    streamRef.current=null;
    if(videoRef.current)videoRef.current.srcObject=null;
    setRunning(false);
  },[]);

  const loadCameras=useCallback(async()=>{
    if(!navigator.mediaDevices?.enumerateDevices)return;
    const devices=await navigator.mediaDevices.enumerateDevices();
    const found=devices.filter(device=>device.kind==="videoinput").map((device,index)=>({deviceId:device.deviceId,label:device.label||`Camera ${index+1}`}));
    setCameras(found);
    const remembered=localStorage.getItem("partsatlas-preferred-camera")||"";
    setSelectedCamera(current=>{const preferred=current||remembered;return preferred&&found.some(camera=>camera.deviceId===preferred)?preferred:(found[0]?.deviceId||"")});
  },[]);

  const startCamera=useCallback(async(deviceId?:string)=>{
    setError("");
    stopCamera();
    try{
      const remembered=localStorage.getItem("partsatlas-preferred-camera")||"";const preferred=deviceId||remembered;
      let stream:MediaStream;
      try{stream=await navigator.mediaDevices.getUserMedia({video:preferred?{deviceId:{exact:preferred}}:{facingMode:{ideal:"environment"}},audio:false})}
      catch(problem){if(!preferred)throw problem;stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false})}
      streamRef.current=stream;
      if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play()}
      const activeId=stream.getVideoTracks()[0]?.getSettings().deviceId;
      await loadCameras();
      if(activeId){setSelectedCamera(activeId);localStorage.setItem("partsatlas-preferred-camera",activeId)}
      setCaptured(null);setScanned(false);setAnalysis(null);setMatches([]);setMarketplaceQuery("");setWebResult(null);setConfirmedId(null);setRunning(true);
    }catch{
      setError("Camera access was not available. Check the browser permission and try again.");
    }
  },[loadCameras,stopCamera]);

  useEffect(()=>{
    loadCameras();
    const changed=()=>loadCameras();
    navigator.mediaDevices?.addEventListener?.("devicechange",changed);
    return()=>{navigator.mediaDevices?.removeEventListener?.("devicechange",changed);stopCamera()};
  },[loadCameras,stopCamera]);

  useEffect(()=>{sessionStorage.removeItem("partsatlas-identification-results")},[]);

  useEffect(()=>{
    if(!captured&&running&&videoRef.current&&streamRef.current){videoRef.current.srcObject=streamRef.current;void videoRef.current.play()}
  },[captured,running]);

  useEffect(()=>{
    function move(event:PointerEvent){
      const drag=dragRef.current;if(!drag)return;
      const preview=videoRef.current?.parentElement?.getBoundingClientRect();if(!preview)return;
      const dx=(event.clientX-drag.startX)/preview.width;
      const dy=(event.clientY-drag.startY)/preview.height;
      const min=.12;const initial=drag.initial;
      let next={...initial};
      if(drag.mode==="move"){
        next.x=Math.max(0,Math.min(1-initial.width,initial.x+dx));
        next.y=Math.max(0,Math.min(1-initial.height,initial.y+dy));
      }else{
        if(drag.mode.includes("w")){const right=initial.x+initial.width;next.x=Math.max(0,Math.min(right-min,initial.x+dx));next.width=right-next.x}
        if(drag.mode.includes("e"))next.width=Math.max(min,Math.min(1-initial.x,initial.width+dx));
        if(drag.mode.includes("n")){const bottom=initial.y+initial.height;next.y=Math.max(0,Math.min(bottom-min,initial.y+dy));next.height=bottom-next.y}
        if(drag.mode.includes("s"))next.height=Math.max(min,Math.min(1-initial.y,initial.height+dy));
      }
      setSelection(next);
    }
    function end(){dragRef.current=null}
    window.addEventListener("pointermove",move);window.addEventListener("pointerup",end);window.addEventListener("pointercancel",end);
    return()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",end);window.removeEventListener("pointercancel",end)};
  },[]);

  async function changeCamera(deviceId:string){
    setSelectedCamera(deviceId);if(deviceId)localStorage.setItem("partsatlas-preferred-camera",deviceId);
    if(running)await startCamera(deviceId);
  }

  function beginSelection(event:React.PointerEvent,mode:DragMode){
    event.preventDefault();event.stopPropagation();
    dragRef.current={mode,startX:event.clientX,startY:event.clientY,initial:selection};
  }

  async function identifyImage(image:string){
    setIdentifying(true);setScanned(true);setError("");setAnalysis(null);setMatches([]);setNoMatchReason("");setMarketplaceQuery("");setWebResult(null);setConfirmedId(null);setCapturedImageAdded(false);setCapturedImageMessage("");
    try{
      const response=await fetch("/api/identify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({image})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||"Identification failed");
      setAnalysis(data.analysis);setMatches(data.matches||[]);setNoMatchReason(data.noMatchReason||"");setMarketplaceQuery(data.analysis?.marketplace_search_query||data.analysis?.likely_name||"");
    }catch(problem){setError(problem instanceof Error?problem.message:"Identification failed")}
    finally{setIdentifying(false)}
  }

  async function searchWeb(){
    if(!captured)return;setSearchingWeb(true);setError("");
    try{const response=await fetch("/api/identify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({image:captured,webSearch:true,analysis})});const data=await response.json();if(!response.ok)throw new Error(data.error||"AI analysis failed");setWebResult(normalizeWebResult(data.web))}
    catch(problem){setError(problem instanceof Error?problem.message:"AI analysis failed")}
    finally{setSearchingWeb(false)}
  }

  async function addCapturedImage(){
    if(!captured||!confirmedId||addingCapturedImage)return;
    setAddingCapturedImage(true);setCapturedImageMessage("");
    try{
      const imagesResponse=await fetch(`/api/uploads?itemId=${confirmedId}`);const imagesData=await imagesResponse.json();
      if(!imagesResponse.ok)throw new Error(imagesData.error||"Could not read the product images");
      const blob=await fetch(captured).then(response=>response.blob());
      const confirmed=matches.find(match=>match.item_id===confirmedId);
      const file=new File([blob],`identified-${confirmed?.item.serial||confirmedId}-${Date.now()}.jpg`,{type:blob.type||"image/jpeg"});
      const form=new FormData();form.append("itemId",String(confirmedId));form.append("order",String(Array.isArray(imagesData.images)?imagesData.images.length:0));form.append("sourcePath","Identification capture");form.append("file",file);
      const uploadResponse=await fetch("/api/uploads",{method:"POST",body:form});const result=await uploadResponse.json();
      if(!uploadResponse.ok)throw new Error(result.error||"Could not add the captured image");
      setCapturedImageAdded(true);setCapturedImageMessage("Image added to the product gallery");
    }catch(problem){setCapturedImageMessage(problem instanceof Error?problem.message:"Image upload failed")}
    finally{setAddingCapturedImage(false)}
  }

  async function capture(){
    const video=videoRef.current;if(!video||!video.videoWidth)return;
    const preview=video.parentElement?.getBoundingClientRect();const rendered=video.getBoundingClientRect();if(!preview)return;
    const selectedLeft=preview.left+selection.x*preview.width;
    const selectedTop=preview.top+selection.y*preview.height;
    const selectedRight=selectedLeft+selection.width*preview.width;
    const selectedBottom=selectedTop+selection.height*preview.height;
    const visibleLeft=Math.max(selectedLeft,rendered.left);const visibleTop=Math.max(selectedTop,rendered.top);
    const visibleRight=Math.min(selectedRight,rendered.right);const visibleBottom=Math.min(selectedBottom,rendered.bottom);
    if(visibleRight<=visibleLeft||visibleBottom<=visibleTop){setError("Move the capture rectangle over the camera image.");return}
    const scaleX=video.videoWidth/rendered.width;const scaleY=video.videoHeight/rendered.height;
    const sx=(visibleLeft-rendered.left)*scaleX;const sy=(visibleTop-rendered.top)*scaleY;
    const sw=(visibleRight-visibleLeft)*scaleX;const sh=(visibleBottom-visibleTop)*scaleY;
    const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(sw));canvas.height=Math.max(1,Math.round(sh));
    canvas.getContext("2d")?.drawImage(video,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
    const image=canvas.toDataURL("image/jpeg",.88);setCaptured(image);await identifyImage(image);
  }

  function usePhoto(file?:File){
    if(!file)return;const reader=new FileReader();reader.onload=()=>{const image=String(reader.result);setCaptured(image);void identifyImage(image)};reader.readAsDataURL(file);
  }

  function retake(){setCaptured(null);setScanned(false);setAnalysis(null);setMatches([]);setNoMatchReason("");setMarketplaceQuery("");setWebResult(null);setConfirmedId(null);setCapturedImageAdded(false);setCapturedImageMessage("");setError("")}

  const marketplaceSearchLinks=[
    {name:"AliExpress",url:marketplaceQuery.trim()?`https://www.google.com/search?q=${encodeURIComponent(`site:aliexpress.com ${marketplaceQuery.trim()}`)}`:"#"},
    {name:"Temu",url:marketplaceQuery.trim()?`https://www.google.com/search?q=${encodeURIComponent(`site:temu.com ${marketplaceQuery.trim()}`)}`:"#"},
    {name:"Amazon",url:marketplaceQuery.trim()?`https://www.google.com/search?q=${encodeURIComponent(`site:amazon.com ${marketplaceQuery.trim()}`)}`:"#"},
  ];

  return <main className="app-shell identify-shell">
    <aside className="sidebar">
      <Link className="brand" href="/"><div className="brand-mark"><Boxes size={20}/></div><span>Parts<span>Atlas</span></span></Link>
      <button className="mobile-menu" aria-label="Menu"><Menu/></button>
      <nav><p>Workspace</p><Link className="sidebar-link" href="/?view=Overview"><LayoutDashboard/>Overview</Link><Link className="sidebar-link" href="/?view=Inventory"><Archive/>Inventory</Link><Link className="sidebar-link" href="/?view=Locations"><FolderTree/>Locations</Link><Link className="sidebar-link active" href="/identify"><Camera/>Identify</Link>
      <p>Intelligence</p><Link className="sidebar-link" href="/assistant"><Sparkles/>Lab assistant<span className="beta">AI</span></Link>
      <p>System</p><Link className="sidebar-link" href="/?view=Settings"><Settings/>Settings</Link><Link className="sidebar-link" href="/?view=Help%20%26%20feedback"><CircleHelp/>Help & feedback</Link></nav>
      <div className="storage-card"><div><span>Managed storage</span><b>Product media</b></div><div className="meter"><i/></div><small>Photos and attachments</small></div>
      <div className="profile"><div>RL</div><span><b>Roy&apos;s Lab</b><small>Personal workspace</small></span><MoreHorizontal/></div>
    </aside>

    <section className="content"><header className="topbar"><div className="crumb"><Link href="/">Home lab</Link><ChevronRight/><b>Identify</b></div></header>
      <div className="identify-page">
        <header className="identify-heading"><div><p className="eyebrow">Visual inventory search</p><h1>Identify an unknown item</h1><p>Place one component in view, choose the camera you want, and compare it with your inventory.</p></div></header>

        <section className="identify-workspace">
          <div className="identify-camera-card">
            <div className="camera-toolbar"><label><span>Camera</span><select value={selectedCamera} onChange={event=>changeCamera(event.target.value)} aria-label="Select camera"><option value="">Default camera</option>{cameras.map(camera=><option key={camera.deviceId} value={camera.deviceId}>{camera.label}</option>)}</select></label><button type="button" onClick={loadCameras} title="Refresh camera list" aria-label="Refresh camera list"><RefreshCw/></button></div>
            <div className="identify-camera-view">{captured?<img src={captured} alt="Captured item"/>:<video ref={videoRef} muted playsInline/>}{running&&!captured&&<div className="capture-selection" style={{left:`${selection.x*100}%`,top:`${selection.y*100}%`,width:`${selection.width*100}%`,height:`${selection.height*100}%`}} onPointerDown={event=>beginSelection(event,"move")}><span>Capture area</span>{(["nw","ne","sw","se"] as DragMode[]).map(handle=><i key={handle} className={handle} onPointerDown={event=>beginSelection(event,handle)} />)}</div>}{!running&&!captured&&<div className="camera-empty"><Camera/><b>Start the camera when you are ready</b><span>Your camera selection is always available above.</span></div>}</div>
            {error&&<p className="camera-error">{error}</p>}
            <div className="identify-actions">{running?<><button className="primary" onClick={capture} disabled={identifying}><Camera/>Capture and identify</button><button onClick={()=>setSelection({x:.18,y:.14,width:.64,height:.72})}><RefreshCw/>Reset selection</button><button onClick={stopCamera}><Square/>Stop camera</button></>:<button className="primary" onClick={()=>startCamera(selectedCamera)}><Camera/>Start camera</button>}<button onClick={()=>uploadRef.current?.click()} disabled={identifying}><Upload/>Upload photo</button><input ref={uploadRef} hidden type="file" accept="image/*" onChange={event=>usePhoto(event.target.files?.[0])}/>{captured&&<button onClick={retake} disabled={identifying}><RefreshCw/>Retake</button>}</div>
            <p className="privacy">The selected crop is sent to OpenAI for inventory identification and to suggest a marketplace search phrase. PartsAtlas does not save it unless you later attach it.</p>
          </div>

          <aside className="identify-results"><div className="results-heading"><span><Sparkles/></span><div><h2>{identifying?"Analyzing the selected item…":scanned?"Inventory identification":"Matches will appear here"}</h2><p>{identifying?"Reading markings, narrowing the catalog, and comparing product photos.":scanned?"These results come from real visual and inventory analysis.":"Capture an item or upload a clear photo to begin."}</p></div></div>
            {identifying?<div className="identify-loading"><LoaderCircle/><b>Identifying your item</b><p>This normally takes a few moments.</p></div>:scanned?<div className="identification-output">{confirmedId&&<div className="confirmed-match"><CheckCircle2/><span><b>Product confirmed</b><small>{matches.find(match=>match.item_id===confirmedId)?.item.title}</small>{capturedImageMessage&&<em>{capturedImageMessage}</em>}</span><button onClick={addCapturedImage} disabled={addingCapturedImage||capturedImageAdded}>{addingCapturedImage?<LoaderCircle/>:capturedImageAdded?<CheckCircle2/>:<ImagePlus/>}{addingCapturedImage?"Adding image…":capturedImageAdded?"Image added":"Add captured image"}</button></div>}{analysis&&<section className="visual-analysis"><span>AI sees</span><h3>{analysis.likely_name||"Unknown component"}</h3><p>{analysis.description}</p>{[...analysis.visible_text,...analysis.markings].length>0&&<div>{[...analysis.visible_text,...analysis.markings].slice(0,6).map(value=><i key={value}>{value}</i>)}</div>}</section>}{matches.length>0?<div className="identify-match-list">{matches.map(match=><article key={match.item_id} className={confirmedId===match.item_id?"confirmed":""}><Link href={`/items/${match.item_id}`} target="_blank" title="Open this product in a new tab"><div>{match.item.image?<img src={match.item.image} alt=""/>:<ImagePlus/>}</div><span><b>{match.item.title}</b><small>{match.item.serial} · {match.item.category}</small><em>{match.reason}</em></span><strong>{match.confidence}%</strong><ExternalLink/></Link><button onClick={()=>{setConfirmedId(match.item_id);setCapturedImageAdded(false);setCapturedImageMessage("")}} disabled={confirmedId===match.item_id}>{confirmedId===match.item_id?<><CheckCircle2/>Confirmed</>:"This is the product"}</button></article>)}</div>:<div className="no-inventory-match"><Search/><b>No confident inventory match</b><p>{noMatchReason||"The photographed item did not closely match the available candidates."}</p></div>}{marketplaceQuery&&<section className="marketplace-search"><div><Globe2/><span><b>Search marketplaces with Google</b><small>AI suggested the most useful product phrase. You can edit it before searching.</small></span></div><label htmlFor="marketplace-query">Search phrase</label><input id="marketplace-query" value={marketplaceQuery} onChange={event=>setMarketplaceQuery(event.target.value)} placeholder="AI search phrase"/><div className="marketplace-links">{marketplaceSearchLinks.map(marketplace=><a key={marketplace.name} href={marketplace.url} target="_blank" rel="noreferrer" aria-disabled={!marketplaceQuery.trim()} onClick={event=>{if(!marketplaceQuery.trim())event.preventDefault()}}><Search/>Search {marketplace.name}<ExternalLink/></a>)}</div></section>}<div className="web-fallback"><button onClick={searchWeb} disabled={searchingWeb||!captured}>{searchingWeb?<LoaderCircle/>:<Globe2/>}{searchingWeb?"Analyzing the web…":"Analyze this item using the web"}</button><p>{captured?"Use the photo, visible markings, and AI description for a more detailed product analysis.":"Retake or upload the photo to run the analysis."}</p></div>{webResult&&<section className="web-identification"><span>{webResult.provider}</span><div className="web-answer-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{webResult.text}</ReactMarkdown></div></section>}</div>:<div className="identify-results-empty"><Search/><p>The system will show several candidates so you can confirm the correct product.</p></div>}
          </aside>
        </section>
      </div>
    </section>
  </main>
}
