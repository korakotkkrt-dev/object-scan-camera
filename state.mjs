export function mayStart({stream,capturing,count,loading,opening,source,ready}){return !!stream&&!capturing&&count<32&&!loading&&!opening&&ready&&(count===0||source==='camera');}
export function shouldRun({busy,loading,count,lastAttempt,force=false}){return !busy&&!loading&&count>=8&&count!==lastAttempt&&(force||lastAttempt===0||count-lastAttempt>=4);}
export function currentResult(token,epoch){return token===epoch;}
