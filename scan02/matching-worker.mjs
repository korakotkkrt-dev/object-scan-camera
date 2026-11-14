import {matchPair} from './matching.mjs';
self.onmessage=({data:{descriptors,pairs}})=>{try{const matches=[];for(const [a,b] of pairs){matches.push({a,b,...matchPair(descriptors[a],descriptors[b])});self.postMessage({kind:'progress',done:matches.length,total:pairs.length});}self.postMessage({kind:'done',matches});}catch(e){self.postMessage({kind:'error',message:e.message});}};
