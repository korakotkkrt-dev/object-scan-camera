export function mayStart({stream,capturing,count,loading,opening,source,ready}){return !!stream&&!capturing&&count<32&&!loading&&!opening&&ready&&(count===0||source==='camera');}
export function shouldRun({busy,loading,count,lastAttempt,force=false,min=8,step=4}){return !busy&&!loading&&count>=min&&count!==lastAttempt&&(force||lastAttempt===0||count-lastAttempt>=step);}
export function currentResult(token,epoch){return token===epoch;}
